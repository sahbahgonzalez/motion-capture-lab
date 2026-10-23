/**
 * useIMUFusionController
 *
 * Segment-level failure-triggered IMU fusion state machine for Pipeline 4.
 *
 * Manages two independent state machines (UA = shoulder→elbow, FA = elbow→wrist)
 * and a shoulder anchor, blending between stereo and IMU positions based on
 * per-segment reliability assessment from the jitter correction hook.
 *
 * The hook is designed to be called from inside a non-React hot-path callback
 * (onCorrectedPose). State is maintained in refs; the returned functions have
 * stable identities and can be safely stored in refs by callers.
 *
 * STATES per segment:
 *   STEREO          — stereo tracking is reliable; output matches Pipeline 3
 *   IMU_CORRECTION  — stereo failed; using IMU reconstruction
 *   RECOVERY        — stereo became reliable again; two-phase: confirm then blend
 *   UNAVAILABLE     — neither stereo nor IMU is available
 *
 * RECOVERY PHASES (within RECOVERY state):
 *   confirming — counting consecutive reliable stereo frames; output = IMU (unchanged)
 *   blending   — confirmed; linear blend from last IMU position to live stereo
 *   A single reliable stereo frame during occlusion never affects the fused output.
 *
 * SHOULDER ANCHOR:
 *   Single authoritative anchor managed by the fusion controller.
 *   Updated only when shoulder is reliably tracked (simulation-override-aware).
 *   Expires after shoulderAnchorMaxAgeMs. Callers obtain effectiveShoulder via
 *   getEffectiveShoulder() — a read-only query that does not advance state.
 *
 * FOREARM DEPENDENCY (Issue 1 fix):
 *   FA IMU target wrist = finalElbow + calibFaLengthMm * imuFADir
 *   Input is the normalized forearm direction (imuFADir), not a pre-computed
 *   wrist position anchored to the independently-reconstructed IMU elbow.
 *   This ensures the fused wrist stays attached to the correct (fused) elbow
 *   when UA and FA use different sources.
 *
 * SOURCE PRIORITY:
 *   Stereo > IMU. From UNAVAILABLE, stereo recovery is checked before IMU fallback.
 */
import { useRef } from 'react';
import type { JointFailureStatus } from './usePoseFailureCorrection';

// ── Public types ──────────────────────────────────────────────────────────────

export type SegmentState = 'STEREO' | 'IMU_CORRECTION' | 'RECOVERY' | 'UNAVAILABLE';
export type ShoulderAnchorState = 'live' | 'frozen' | 'expired';
export type RecoveryPhase = 'confirming' | 'blending' | null;

export interface FusionConfig {
  /**
   * Maximum age (ms) of a frozen shoulder anchor before it expires and the arm
   * position is considered UNAVAILABLE. 500ms ≈ 25 packets at 50 Hz IMU rate.
   */
  shoulderAnchorMaxAgeMs: number;
  /**
   * Consecutive reliable stereo frames required before beginning the blend back
   * to stereo. A single reliable frame during occlusion has no effect on output.
   */
  recoveryConfirmFrames: number;
  /**
   * Number of frames for linear blend transition when switching source.
   */
  blendFrames: number;
  /**
   * IMU freshness threshold for runtime fusion (ms). Stricter than calibration
   * (500ms) because stale orientation data causes visible drift during occlusion.
   */
  imuFreshnessMs: number;
  /**
   * Max allowed deviation of current stereo segment length from calibrated value
   * (fraction, e.g. 0.25 = 25%). Catches MediaPipe grabbing the wrong joint.
   */
  segLengthTolerance: number;
}

export const DEFAULT_FUSION_CONFIG: FusionConfig = {
  shoulderAnchorMaxAgeMs: 500,
  recoveryConfirmFrames: 5,
  blendFrames: 4,
  imuFreshnessMs: 150,
  segLengthTolerance: 0.25,
};

export interface SimulatedFailures {
  shoulder: boolean;
  elbow: boolean;
  wrist: boolean;
}

export const NO_SIMULATED_FAILURES: SimulatedFailures = {
  shoulder: false, elbow: false, wrist: false,
};

export interface FusionDiagnostics {
  uaState: SegmentState;
  faState: SegmentState;
  /** Sub-phase within RECOVERY: 'confirming' = counting frames; 'blending' = lerping back. */
  uaRecoveryPhase: RecoveryPhase;
  faRecoveryPhase: RecoveryPhase;
  shoulderAnchorState: ShoulderAnchorState;
  shoulderAnchorAgeMs: number;
  uaFailureReason: string | null;
  faFailureReason: string | null;
  uaCorrectionActiveMs: number;
  faCorrectionActiveMs: number;
  uaRecoveryFrame: number;
  faRecoveryFrame: number;
  imuCalibrationValid: boolean;
  imu01AgeMs: number;
  imu02AgeMs: number;
  blendAlphaUA: number;
  blendAlphaFA: number;
  fullyAvailable: boolean;
  simulated: SimulatedFailures;
}

type Pt3 = { x: number; y: number; z: number };

export interface FusionFrameInput {
  /** Corrected stereo position for right shoulder (null = missing/unreliable). */
  stereoShoulder: Pt3 | null;
  /** Corrected stereo position for right elbow. */
  stereoElbow: Pt3 | null;
  /** Corrected stereo position for right wrist. */
  stereoWrist: Pt3 | null;
  /**
   * IMU-reconstructed elbow position, anchored to the fusion controller's
   * effectiveShoulder (obtained via getEffectiveShoulder before the IMU
   * reconstruction step). null when calibration invalid or imu_01 stale.
   */
  imuElbow: Pt3 | null;
  /**
   * Normalized IMU forearm world direction in stereo coordinate frame.
   * The fusion controller computes:
   *   imuTargetWrist = finalElbow + calibFaLengthMm * imuFADir
   * ensuring wrist stays attached to the FUSED elbow, not the IMU-only elbow.
   * null when imu_02 stale, unavailable, or calibration invalid.
   */
  imuFADir: [number, number, number] | null;
  /** Per-joint failure statuses from jitter correction (reliable, failureType). */
  jointStatuses: JointFailureStatus[];
  /** Whether a valid (non-failed) calibration with positive lengths is present. */
  calibrationValid: boolean;
  /** Calibrated upper-arm length in mm (0 = invalid). */
  calibUaLengthMm: number;
  /** Calibrated forearm length in mm (0 = invalid). */
  calibFaLengthMm: number;
  /** Age of last imu_01 packet (ms). */
  imu01AgeMs: number;
  /** Age of last imu_02 packet (ms). */
  imu02AgeMs: number;
  /** Simulation overrides — treat the specified joints as missing from stereo. */
  simulated: SimulatedFailures;
  /** Current wall clock from performance.now(). */
  nowMs: number;
}

export interface FusionFrameResult {
  finalShoulder: Pt3 | null;
  finalElbow: Pt3 | null;
  finalWrist: Pt3 | null;
  /** The shoulder anchor position used this frame (live or frozen). null if expired. */
  effectiveShoulder: Pt3 | null;
  diagnostics: FusionDiagnostics;
}

// ── Internal ──────────────────────────────────────────────────────────────────

interface SegState {
  state: SegmentState;
  failureReason: string | null;
  correctionStartedAt: number | null;
  recoveryFrame: number;
  /** True after recoveryConfirmFrames consecutive reliable stereo frames. Blend begins only then. */
  recoveryConfirmed: boolean;
  transitionFrame: number;
  blendFrom: Pt3 | null;
  lastPos: Pt3 | null;
}

interface ShoulderAnchor {
  pos: Pt3;
  capturedAt: number;
}

interface FusionState {
  ua: SegState;
  fa: SegState;
  shoulder: ShoulderAnchor | null;
  config: FusionConfig;
}

function makeSeg(): SegState {
  return {
    state: 'STEREO',
    failureReason: null,
    correctionStartedAt: null,
    recoveryFrame: 0,
    recoveryConfirmed: false,
    transitionFrame: 0,
    blendFrom: null,
    lastPos: null,
  };
}

function lerp3(a: Pt3, b: Pt3, t: number): Pt3 {
  const tc = Math.max(0, Math.min(1, t));
  return {
    x: a.x + (b.x - a.x) * tc,
    y: a.y + (b.y - a.y) * tc,
    z: a.z + (b.z - a.z) * tc,
  };
}

function dist3d(a: Pt3, b: Pt3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/**
 * Blend from seg.blendFrom toward liveTarget using seg.transitionFrame.
 * When blendFrom is null, snaps to liveTarget (used after UNAVAILABLE).
 * When liveTarget is null, holds the last known position.
 */
function computeBlended(seg: SegState, liveTarget: Pt3 | null, blendFrames: number): Pt3 | null {
  if (!liveTarget) return seg.lastPos;
  if (!seg.blendFrom) return liveTarget;
  const alpha = Math.min(1, seg.transitionFrame / Math.max(1, blendFrames));
  return lerp3(seg.blendFrom, liveTarget, alpha);
}

/**
 * Evaluate whether a stereo segment is reliable enough for Pipeline 4 use.
 * Combines jitter status with anatomical segment length gate.
 */
function evalStereoReliable(
  proxJoint: Pt3 | null,
  distJoint: Pt3 | null,
  proxStatus: JointFailureStatus | undefined,
  distStatus: JointFailureStatus | undefined,
  calibLength: number,
  tolerance: number,
  simProx: boolean,
  simDist: boolean,
): { reliable: boolean; reason: string | null } {
  if (simProx) return { reliable: false, reason: 'Simulated proximal joint failure' };
  if (simDist) return { reliable: false, reason: 'Simulated distal joint failure' };
  if (!proxJoint) return { reliable: false, reason: 'Proximal joint missing' };
  if (!distJoint) return { reliable: false, reason: 'Distal joint missing' };
  if (!proxStatus?.reliable) return { reliable: false, reason: `Proximal joint unreliable (${proxStatus?.failureType ?? 'no data'})` };
  if (!distStatus?.reliable) return { reliable: false, reason: `Distal joint unreliable (${distStatus?.failureType ?? 'no data'})` };
  if (calibLength > 0) {
    const len = dist3d(proxJoint, distJoint);
    if (Math.abs(len - calibLength) / calibLength > tolerance) {
      return { reliable: false, reason: `Segment length ${len.toFixed(0)}mm vs calib ${calibLength.toFixed(0)}mm (>${(tolerance * 100).toFixed(0)}% deviation)` };
    }
  }
  return { reliable: true, reason: null };
}

/**
 * Advance one segment state machine frame.
 * Mutates seg in-place and returns the new output position.
 *
 * RECOVERY is split into two phases:
 *   Phase 1 (confirming): continue outputting IMU until recoveryConfirmFrames reached.
 *   Phase 2 (blending):   linearly blend from the captured IMU position toward stereo.
 * A single reliable stereo frame never influences the output (no premature blending).
 */
function advanceSeg(
  seg: SegState,
  stereoPos: Pt3 | null,
  imuPos: Pt3 | null,
  stereoReliable: boolean,
  stereoReason: string | null,
  imuAvailable: boolean,
  cfg: FusionConfig,
  nowMs: number,
): Pt3 | null {
  const prevState = seg.state;

  // ── State transitions ──────────────────────────────────────────────────────
  switch (seg.state) {
    case 'STEREO':
      if (!stereoReliable) {
        if (imuAvailable) {
          seg.state = 'IMU_CORRECTION';
          seg.failureReason = stereoReason;
          seg.correctionStartedAt = nowMs;
          seg.recoveryFrame = 0;
          seg.recoveryConfirmed = false;
          seg.transitionFrame = 0;
          seg.blendFrom = seg.lastPos ?? stereoPos;
        } else {
          seg.state = 'UNAVAILABLE';
          seg.failureReason = stereoReason ?? 'IMU also unavailable';
          seg.correctionStartedAt = null;
        }
      } else {
        seg.failureReason = null;
      }
      break;

    case 'IMU_CORRECTION':
      if (stereoReliable) {
        // Stereo returned — enter RECOVERY confirmation phase
        seg.state = 'RECOVERY';
        seg.recoveryFrame = 0;
        seg.recoveryConfirmed = false;
        seg.transitionFrame = 0;
        // blendFrom captured later when confirmation completes
      } else if (!imuAvailable) {
        seg.state = 'UNAVAILABLE';
        seg.correctionStartedAt = null;
      }
      break;

    case 'RECOVERY':
      if (!stereoReliable) {
        // Stereo lost during recovery — abort and revert
        seg.recoveryConfirmed = false;
        if (imuAvailable) {
          seg.state = 'IMU_CORRECTION';
          seg.failureReason = stereoReason;
          seg.correctionStartedAt = nowMs;
          seg.recoveryFrame = 0;
          seg.transitionFrame = 0;
          seg.blendFrom = seg.lastPos ?? imuPos;
        } else {
          seg.state = 'UNAVAILABLE';
          seg.failureReason = stereoReason ?? 'IMU also unavailable';
          seg.correctionStartedAt = null;
        }
      } else {
        // Stereo is reliable
        if (!seg.recoveryConfirmed) {
          // Phase 1: count confirmation frames — output remains IMU
          seg.recoveryFrame++;
          if (seg.recoveryFrame >= cfg.recoveryConfirmFrames) {
            seg.recoveryConfirmed = true;
            seg.transitionFrame = 0;
            // Capture current output as the blend start point
            seg.blendFrom = seg.lastPos ?? imuPos;
          }
        } else {
          // Phase 2: blend from captured IMU position toward live stereo
          seg.transitionFrame++;
          if (seg.transitionFrame >= cfg.blendFrames) {
            seg.state = 'STEREO';
            seg.failureReason = null;
            seg.correctionStartedAt = null;
            seg.recoveryFrame = 0;
            seg.recoveryConfirmed = false;
            seg.transitionFrame = 0;
            seg.blendFrom = null;
          }
        }
      }
      break;

    case 'UNAVAILABLE':
      // Stereo-first priority: if stereo is reliable, prefer recovery over IMU correction
      if (stereoReliable) {
        seg.state = 'RECOVERY';
        seg.recoveryFrame = 0;
        seg.recoveryConfirmed = false;
        seg.transitionFrame = 0;
        seg.blendFrom = null;
        seg.failureReason = null;
      } else if (imuAvailable) {
        seg.state = 'IMU_CORRECTION';
        seg.failureReason = stereoReason ?? 'Stereo unreliable';
        seg.correctionStartedAt = nowMs;
        seg.recoveryFrame = 0;
        seg.recoveryConfirmed = false;
        seg.transitionFrame = 0;
        seg.blendFrom = null;
      }
      break;
  }

  // Maintain correctionStartedAt across state changes
  if (seg.state !== 'IMU_CORRECTION' && prevState === 'IMU_CORRECTION') {
    seg.correctionStartedAt = null;
  }
  if (seg.state === 'IMU_CORRECTION' && seg.correctionStartedAt === null) {
    seg.correctionStartedAt = nowMs;
  }

  // Advance transitionFrame for IMU_CORRECTION only.
  // RECOVERY manages transitionFrame internally above (to separate confirm vs blend).
  // STEREO and UNAVAILABLE reset it.
  if (seg.state === 'IMU_CORRECTION') {
    seg.transitionFrame++;
  } else if (seg.state !== 'RECOVERY') {
    seg.transitionFrame = 0;
    seg.blendFrom = null;
  }

  // ── Compute output position ────────────────────────────────────────────────
  let output: Pt3 | null = null;

  switch (seg.state) {
    case 'STEREO':
      output = stereoPos;
      break;

    case 'IMU_CORRECTION':
      // Blend from last stereo position toward IMU over blendFrames frames
      output = computeBlended(seg, imuPos, cfg.blendFrames);
      break;

    case 'RECOVERY':
      if (!seg.recoveryConfirmed) {
        // Confirmation phase: keep outputting IMU (do not blend toward stereo yet)
        output = imuPos ?? seg.lastPos;
      } else {
        // Blend phase: lerp from captured IMU position toward live stereo
        output = computeBlended(seg, stereoPos, cfg.blendFrames);
      }
      break;

    case 'UNAVAILABLE':
      output = null;
      break;
  }

  seg.lastPos = output;
  return output;
}

// ── Core factory (no React dependency) ───────────────────────────────────────

/**
 * Creates a stateful fusion controller object with no React dependency.
 * Used by both the hook (via useRef) and deterministic unit tests.
 */
export function createFusionController(configOverrides?: Partial<FusionConfig>) {
  const state: FusionState = {
    ua: makeSeg(),
    fa: makeSeg(),
    shoulder: null,
    config: { ...DEFAULT_FUSION_CONFIG, ...configOverrides },
  };

  const getEffectiveShoulder = (nowMs: number): Pt3 | null => {
    const anchor = state.shoulder;
    if (!anchor) return null;
    const age = nowMs - anchor.capturedAt;
    return age <= state.config.shoulderAnchorMaxAgeMs
      ? { x: anchor.pos.x, y: anchor.pos.y, z: anchor.pos.z }
      : null;
  };

  const processFusionFrame = (input: FusionFrameInput): FusionFrameResult => {
    // Update config overrides if they changed
    state.config = { ...DEFAULT_FUSION_CONFIG, ...configOverrides };
    return _processFusionFrame(state, input);
  };

  const reset = () => {
    state.ua = makeSeg();
    state.fa = makeSeg();
    state.shoulder = null;
  };

  return { processFusionFrame, getEffectiveShoulder, reset };
}

// ── Internal frame processing (shared by hook and factory) ────────────────────

function _processFusionFrame(s: FusionState, input: FusionFrameInput): FusionFrameResult {
  const cfg = s.config;
  const {
    stereoShoulder, stereoElbow, stereoWrist,
    imuElbow, imuFADir,
    jointStatuses, calibrationValid, calibUaLengthMm, calibFaLengthMm,
    imu01AgeMs, imu02AgeMs, simulated, nowMs,
  } = input;

  const byJoint = Object.fromEntries(jointStatuses.map(j => [j.joint, j]));

  const effStereoShoulder = simulated.shoulder ? null : stereoShoulder;
  const effStereoElbow    = simulated.elbow    ? null : stereoElbow;
  const effStereoWrist    = simulated.wrist    ? null : stereoWrist;

  const shoulderStatusReliable = !simulated.shoulder
    && stereoShoulder !== null
    && (byJoint['rightShoulder']?.reliable !== false);

  if (shoulderStatusReliable && stereoShoulder) {
    s.shoulder = { pos: { x: stereoShoulder.x, y: stereoShoulder.y, z: stereoShoulder.z }, capturedAt: nowMs };
  }

  const anchorAgeMs = s.shoulder ? nowMs - s.shoulder.capturedAt : Infinity;
  const anchorValid = anchorAgeMs <= cfg.shoulderAnchorMaxAgeMs;
  const effectiveShoulder: Pt3 | null = anchorValid ? (s.shoulder?.pos ?? null) : null;

  const shoulderAnchorState: ShoulderAnchorState =
    !anchorValid ? 'expired'
    : shoulderStatusReliable ? 'live'
    : 'frozen';

  const imuUAAvailable = imuElbow !== null
    && calibrationValid
    && imu01AgeMs <= cfg.imuFreshnessMs
    && effectiveShoulder !== null;

  const imuFABaseAvailable = imuFADir !== null
    && calibrationValid
    && imu02AgeMs <= cfg.imuFreshnessMs;

  const uaEval = evalStereoReliable(
    effStereoShoulder, effStereoElbow,
    byJoint['rightShoulder'], byJoint['rightElbow'],
    calibUaLengthMm, cfg.segLengthTolerance,
    simulated.shoulder, simulated.elbow,
  );

  const finalElbow = advanceSeg(
    s.ua, effStereoElbow, imuElbow,
    uaEval.reliable, uaEval.reason,
    imuUAAvailable, cfg, nowMs,
  );

  const imuTargetWrist: Pt3 | null = (imuFADir && finalElbow && calibFaLengthMm > 0)
    ? {
        x: finalElbow.x + calibFaLengthMm * imuFADir[0],
        y: finalElbow.y + calibFaLengthMm * imuFADir[1],
        z: finalElbow.z + calibFaLengthMm * imuFADir[2],
      }
    : null;

  const imuFAAvailable = imuFABaseAvailable && finalElbow !== null;

  const effectiveElbow = finalElbow;
  let faEval: { reliable: boolean; reason: string | null };
  if (!effectiveElbow) {
    faEval = { reliable: false, reason: 'Elbow unavailable' };
  } else if (!effStereoWrist) {
    faEval = { reliable: false, reason: simulated.wrist ? 'Simulated wrist failure' : 'Wrist missing' };
  } else if (!byJoint['rightWrist']?.reliable) {
    faEval = { reliable: false, reason: `Wrist unreliable (${byJoint['rightWrist']?.failureType ?? 'no data'})` };
  } else if (calibFaLengthMm > 0) {
    const faLen = dist3d(effectiveElbow, effStereoWrist);
    if (Math.abs(faLen - calibFaLengthMm) / calibFaLengthMm > cfg.segLengthTolerance) {
      faEval = { reliable: false, reason: `FA length ${faLen.toFixed(0)}mm vs calib ${calibFaLengthMm.toFixed(0)}mm (>${(cfg.segLengthTolerance * 100).toFixed(0)}% deviation)` };
    } else {
      faEval = { reliable: true, reason: null };
    }
  } else {
    faEval = { reliable: true, reason: null };
  }

  const finalWrist = advanceSeg(
    s.fa, effStereoWrist, imuTargetWrist,
    faEval.reliable, faEval.reason,
    imuFAAvailable, cfg, nowMs,
  );

  const finalShoulder: Pt3 | null = effectiveShoulder;

  const uaRecoveryPhase: RecoveryPhase = s.ua.state === 'RECOVERY'
    ? (s.ua.recoveryConfirmed ? 'blending' : 'confirming')
    : null;
  const faRecoveryPhase: RecoveryPhase = s.fa.state === 'RECOVERY'
    ? (s.fa.recoveryConfirmed ? 'blending' : 'confirming')
    : null;

  const uaBlendAlpha =
    s.ua.state === 'IMU_CORRECTION'
      ? Math.min(1, s.ua.transitionFrame / Math.max(1, cfg.blendFrames))
      : s.ua.state === 'RECOVERY' && s.ua.recoveryConfirmed
        ? Math.min(1, s.ua.transitionFrame / Math.max(1, cfg.blendFrames))
        : 0;
  const faBlendAlpha =
    s.fa.state === 'IMU_CORRECTION'
      ? Math.min(1, s.fa.transitionFrame / Math.max(1, cfg.blendFrames))
      : s.fa.state === 'RECOVERY' && s.fa.recoveryConfirmed
        ? Math.min(1, s.fa.transitionFrame / Math.max(1, cfg.blendFrames))
        : 0;

  const diagnostics: FusionDiagnostics = {
    uaState:              s.ua.state,
    faState:              s.fa.state,
    uaRecoveryPhase,
    faRecoveryPhase,
    shoulderAnchorState,
    shoulderAnchorAgeMs:  isFinite(anchorAgeMs) ? Math.round(anchorAgeMs) : 9999,
    uaFailureReason:      s.ua.failureReason,
    faFailureReason:      s.fa.failureReason,
    uaCorrectionActiveMs: s.ua.correctionStartedAt !== null ? Math.round(nowMs - s.ua.correctionStartedAt) : 0,
    faCorrectionActiveMs: s.fa.correctionStartedAt !== null ? Math.round(nowMs - s.fa.correctionStartedAt) : 0,
    uaRecoveryFrame:      s.ua.recoveryFrame,
    faRecoveryFrame:      s.fa.recoveryFrame,
    imuCalibrationValid:  calibrationValid,
    imu01AgeMs:           isFinite(imu01AgeMs) ? Math.round(imu01AgeMs) : 9999,
    imu02AgeMs:           isFinite(imu02AgeMs) ? Math.round(imu02AgeMs) : 9999,
    blendAlphaUA:         uaBlendAlpha,
    blendAlphaFA:         faBlendAlpha,
    fullyAvailable:       finalShoulder !== null && finalElbow !== null && finalWrist !== null,
    simulated,
  };

  return { finalShoulder, finalElbow, finalWrist, effectiveShoulder, diagnostics };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useIMUFusionController(configOverrides?: Partial<FusionConfig>) {
  const stateRef = useRef<FusionState>({
    ua: makeSeg(),
    fa: makeSeg(),
    shoulder: null,
    config: { ...DEFAULT_FUSION_CONFIG, ...configOverrides },
  });

  // Keep config in sync with renders
  stateRef.current.config = { ...DEFAULT_FUSION_CONFIG, ...configOverrides };

  /**
   * Read-only query: returns the current effective shoulder anchor position
   * without advancing any state. Used by callers to anchor IMU reconstruction
   * BEFORE calling processFusionFrame (one-frame lag accepted for display pose).
   */
  const getEffectiveShoulder = (nowMs: number): Pt3 | null => {
    const anchor = stateRef.current.shoulder;
    if (!anchor) return null;
    const age = nowMs - anchor.capturedAt;
    return age <= stateRef.current.config.shoulderAnchorMaxAgeMs
      ? { x: anchor.pos.x, y: anchor.pos.y, z: anchor.pos.z }
      : null;
  };

  const processFusionFrame = (input: FusionFrameInput): FusionFrameResult =>
    _processFusionFrame(stateRef.current, input);

  const reset = () => {
    stateRef.current.ua = makeSeg();
    stateRef.current.fa = makeSeg();
    stateRef.current.shoulder = null;
  };

  return { processFusionFrame, getEffectiveShoulder, reset };
}
