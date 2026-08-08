import { useRef } from 'react';
import { type TriangulatedPose, LANDMARK_KEYS } from './useTriangulation';
import { type PoseLandmarks } from './useMediaPipePose';

// ── Failure taxonomy ──────────────────────────────────────────────────────────
export type FailureType =
  | 'none'
  | 'light_jitter'
  | 'heavy_jitter'
  | 'occlusion'
  | 'anatomical_violation'
  | 'depth_instability'
  | 'limb_swap';

export interface JointFailureStatus {
  joint: keyof PoseLandmarks;
  failureType: FailureType;
  reliable: boolean;
  correctionMethod: 'none' | 'light_smoothing' | 'heavy_smoothing' | 'imu';
  requiresIMU: boolean;
}

// ── Configuration ─────────────────────────────────────────────────────────────
export interface FailureCorrectionConfig {
  lightJitterThresholdMm: number;
  heavyJitterThresholdMm: number;
  /** EMA alpha for normal frames. 1 = raw passthrough, lower = more smoothing. */
  normalSmoothingAlpha: number;
  /** EMA alpha for light-jitter frames. */
  lightSmoothingAlpha: number;
  /** EMA alpha for heavy-jitter frames. Keep > 0 to avoid freezing. */
  heavySmoothingAlpha: number;
  /**
   * Number of clean frames required before jitter detection is enabled.
   * Also the length of the clean-history ring buffer used for the rolling mean.
   */
  historyWindowLength: number;
  /**
   * Displacement must exceed spikeFactor × rolling-mean-of-clean-frames to
   * be classified as jitter. Genuine sustained motion scales the threshold up
   * proportionally, so only isolated outliers are caught.
   */
  spikeFactor: number;
  /**
   * After this many consecutive jitter frames the detection reference is reset
   * to the current corrected output so a genuinely relocated joint can resync.
   * The EMA output itself continues smoothly — no snap.
   */
  maxJitterFrames: number;
}

export const DEFAULT_CONFIG: FailureCorrectionConfig = {
  lightJitterThresholdMm: 60,
  heavyJitterThresholdMm: 150,
  normalSmoothingAlpha: 0.9,
  lightSmoothingAlpha: 0.6,
  heavySmoothingAlpha: 0.3,
  historyWindowLength: 8,
  spikeFactor: 4.5,
  maxJitterFrames: 6,
};

// ── Internal ring buffer ──────────────────────────────────────────────────────
type Pt3 = { x: number; y: number; z: number };

interface JointHistory {
  /**
   * Ring buffer of RAW positions from frames classified as NORMAL.
   * Jitter-classified frames never enter this buffer, preventing contamination
   * of the rolling mean used for detection.
   */
  cleanPositions: Array<Pt3 | null>;
  cleanHead: number;
  cleanCount: number;

  /**
   * EMA output from the last normal frame — used as the displacement reference
   * when classifying the next incoming frame. Only updated on normal frames.
   */
  cleanRef: Pt3 | null;

  /**
   * Previous EMA output — always used as the blend base regardless of frame
   * classification. Ensures the corrected signal is continuous across all
   * state transitions (normal ↔ light ↔ heavy).
   */
  emaOutput: Pt3 | null;

  consecutiveJitter: number;
}

function makeHistory(windowLength: number): JointHistory {
  return {
    cleanPositions: Array(windowLength).fill(null),
    cleanHead: 0,
    cleanCount: 0,
    cleanRef: null,
    emaOutput: null,
    consecutiveJitter: 0,
  };
}

function pushClean(h: JointHistory, pt: Pt3, windowLength: number): void {
  h.cleanPositions[h.cleanHead] = pt;
  h.cleanHead = (h.cleanHead + 1) % windowLength;
  if (h.cleanCount < windowLength) h.cleanCount++;
}

function rollingMeanDisplacement(h: JointHistory, windowLength: number): number {
  const pts: Pt3[] = [];
  for (let i = 0; i < h.cleanCount; i++) {
    const idx = (h.cleanHead - 1 - i + windowLength) % windowLength;
    const pt = h.cleanPositions[idx];
    if (pt) pts.push(pt);
  }
  if (pts.length < 2) return 0;
  let sum = 0, n = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    sum += Math.sqrt(dx * dx + dy * dy + dz * dz);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

function ema(alpha: number, raw: Pt3, prev: Pt3): Pt3 {
  return {
    x: alpha * raw.x + (1 - alpha) * prev.x,
    y: alpha * raw.y + (1 - alpha) * prev.y,
    z: alpha * raw.z + (1 - alpha) * prev.z,
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export interface FailureCorrectionResult {
  correctedPose: TriangulatedPose;
  jointStatuses: JointFailureStatus[];
}

/**
 * Conservative jitter detection + continuous EMA correction.
 *
 * Key design principles:
 *
 * 1. EMA on every frame. Alpha depends on the frame's classification
 *    (normal / light_jitter / heavy_jitter), but the blend base is always the
 *    previous EMA output. Transitions between states are seamless — there are
 *    no abrupt returns to raw when a jitter run ends.
 *
 * 2. Clean history for detection. The rolling mean is computed only from raw
 *    positions of frames classified as normal. Jitter frames never enter the
 *    buffer, so contamination cannot inflate the mean and weaken detection.
 *
 * 3. Separate cleanRef from emaOutput. cleanRef (last-normal EMA) is the
 *    displacement reference for classification. emaOutput (previous corrected)
 *    is the EMA blend base. Keeping them separate prevents spike values from
 *    entering either baseline.
 *
 * 4. Recovery without snap. After maxJitterFrames consecutive jitter frames
 *    the cleanRef is reset to the current emaOutput so a genuinely relocated
 *    joint can resync. The corrected signal stays continuous.
 */
export function usePoseFailureCorrection(configOverrides?: Partial<FailureCorrectionConfig>) {
  const cfgRef = useRef<FailureCorrectionConfig>({ ...DEFAULT_CONFIG, ...configOverrides });
  cfgRef.current = { ...DEFAULT_CONFIG, ...configOverrides };

  const historyRef = useRef<Partial<Record<keyof PoseLandmarks, JointHistory>>>({});

  const reset = (): void => {
    historyRef.current = {};
  };

  const correct = (rawPose: TriangulatedPose): FailureCorrectionResult => {
    const cfg = cfgRef.current;
    const correctedPose = {} as TriangulatedPose;
    const jointStatuses: JointFailureStatus[] = [];

    for (const key of LANDMARK_KEYS) {
      const raw = rawPose[key];

      if (!historyRef.current[key]) {
        historyRef.current[key] = makeHistory(cfg.historyWindowLength);
      }
      const h = historyRef.current[key]!;

      // ── Missing joint ────────────────────────────────────────────────────
      if (raw === null) {
        correctedPose[key] = null;
        // Reset positioning state so the joint bootstraps cleanly on return.
        // Clean history count is preserved — movement speed knowledge is valid.
        h.cleanRef = null;
        h.emaOutput = null;
        h.consecutiveJitter = 0;
        jointStatuses.push({ joint: key, failureType: 'none', reliable: false, correctionMethod: 'none', requiresIMU: false });
        continue;
      }

      // ── Classify frame ───────────────────────────────────────────────────
      // Bootstrap: detection is skipped until the clean-history ring buffer
      // has enough entries to produce a stable rolling mean. During bootstrap
      // every frame is treated as normal (normalSmoothingAlpha applied).
      let failureType: FailureType = 'none';
      let alpha = cfg.normalSmoothingAlpha;

      if (h.cleanCount >= cfg.historyWindowLength) {
        const cleanPrev = h.cleanRef;
        let displacement = 0;
        if (cleanPrev) {
          const dx = raw.x - cleanPrev.x, dy = raw.y - cleanPrev.y, dz = raw.z - cleanPrev.z;
          displacement = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }

        const rollingMean = rollingMeanDisplacement(h, cfg.historyWindowLength);

        // Two-gate detection: relative AND absolute threshold must both fire.
        // The relative gate (spikeFactor × rollingMean) scales with movement
        // speed, so genuine fast motion is never misclassified.
        const isSpike = rollingMean > 0 && displacement > cfg.spikeFactor * rollingMean;

        if (isSpike && displacement > cfg.heavyJitterThresholdMm) {
          failureType = 'heavy_jitter';
          alpha = cfg.heavySmoothingAlpha;
        } else if (isSpike && displacement > cfg.lightJitterThresholdMm) {
          failureType = 'light_jitter';
          alpha = cfg.lightSmoothingAlpha;
        }
      }

      // ── Continuous EMA — always applied, alpha varies by state ───────────
      // Using emaOutput (not cleanRef) as blend base guarantees continuity
      // across all state transitions.
      const prevEma = h.emaOutput;
      const corrected: Pt3 = prevEma ? ema(alpha, raw, prevEma) : { x: raw.x, y: raw.y, z: raw.z };

      h.emaOutput = corrected;

      // ── Update clean history — normal frames only ────────────────────────
      if (failureType === 'none') {
        h.cleanRef = corrected;
        pushClean(h, raw, cfg.historyWindowLength); // raw for unbiased rolling mean
        h.consecutiveJitter = 0;
      } else {
        h.consecutiveJitter++;
      }

      // ── Recovery: resync detection reference after prolonged jitter ──────
      // Resets cleanRef to the current (smoothed) emaOutput — not to raw —
      // so the reference doesn't jump ahead of where the output currently is.
      if (h.consecutiveJitter >= cfg.maxJitterFrames) {
        h.cleanRef = corrected;
        h.consecutiveJitter = 0;
      }

      const correctionMethod: JointFailureStatus['correctionMethod'] =
        failureType === 'none' ? 'none' :
        failureType === 'light_jitter' ? 'light_smoothing' : 'heavy_smoothing';

      correctedPose[key] = corrected;
      jointStatuses.push({ joint: key, failureType, reliable: true, correctionMethod, requiresIMU: false });
    }

    return { correctedPose, jointStatuses };
  };

  return { correct, reset };
}
