import { MotionRecording, MotionFrame } from '../hooks/useMotionRecorder';
import { PoseLandmarks, LandmarkPoint } from '../hooks/useMediaPipePose';

// ===== JOINT JITTER METRICS =====

export interface JitterMetrics {
  jointName: keyof PoseLandmarks;
  /**
   * Mean frame-to-frame speed normalised by shoulder width.
   * Units: body-widths / second — dimensionless and comparable across labs.
   */
  relativeVelocity: number;
  /**
   * Variance of frame-to-frame velocity, normalised by shoulder width.
   * Units: (body-widths / second)^2 — dimensionless and comparable across labs.
   */
  velocityVariance: number;
  /** Position std dev in the recording's native units (mm or [0,1]). */
  positionStdDev: { x: number; y: number; z: number };
  smoothnessScore: number; // 0-100, higher is smoother
  highFrequencyNoise: number;
  /** Shoulder width used as body-scale reference (native units). null if not available. */
  shoulderWidthRef: number | null;
  /** Per-frame normalised speeds (body-widths/s). */
  velocitySamples: number[];
}

/**
 * Compute shoulder width for a single frame. Returns null if either shoulder
 * is missing or below the visibility threshold.
 */
const SHOULDER_VISIBILITY_THRESHOLD = 0.5;

function frameShoulderWidth(frame: MotionFrame): number | null {
  const ls = frame.landmarks.leftShoulder;
  const rs = frame.landmarks.rightShoulder;
  if (!ls || !rs) return null;
  if ((ls.visibility ?? 1) < SHOULDER_VISIBILITY_THRESHOLD) return null;
  if ((rs.visibility ?? 1) < SHOULDER_VISIBILITY_THRESHOLD) return null;
  const dx = ls.x - rs.x;
  const dy = ls.y - rs.y;
  const dz = (ls.z ?? 0) - (rs.z ?? 0);
  const w = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return w > 0 ? w : null;
}

export function calculateJitterMetrics(
  recording: MotionRecording,
  jointName: keyof PoseLandmarks
): JitterMetrics {
  const frames = recording.frames;
  if (frames.length < 3) {
    return {
      jointName,
      relativeVelocity: 0,
      velocityVariance: 0,
      positionStdDev: { x: 0, y: 0, z: 0 },
      smoothnessScore: 100,
      highFrequencyNoise: 0,
      shoulderWidthRef: null,
      velocitySamples: [],
    };
  }

  // Pre-compute per-frame shoulder width. Using per-frame width means the
  // normalisation adapts as the person moves toward/away from the camera,
  // keeping the body-scale reference geometrically consistent across depths.
  // Falls back to the nearest valid frame's width when shoulders are occluded.
  const perFrameWidth: number[] = new Array(frames.length);
  let lastValid: number | null = null;
  for (let i = 0; i < frames.length; i++) {
    const w = frameShoulderWidth(frames[i]);
    if (w !== null) lastValid = w;
    perFrameWidth[i] = lastValid ?? 0;
  }
  // Forward-fill from the first valid frame for any leading nulls
  let firstValid: number | null = null;
  for (let i = 0; i < frames.length; i++) {
    if (perFrameWidth[i] > 0) { firstValid = perFrameWidth[i]; break; }
  }
  if (firstValid === null) {
    // No shoulder data at all — fall back to un-normalised (scale = 1)
    perFrameWidth.fill(1);
  } else {
    for (let i = 0; i < frames.length; i++) {
      if (perFrameWidth[i] === 0) perFrameWidth[i] = firstValid;
    }
  }

  // Mean shoulder width across the recording — reported in the UI for reference
  const shoulderWidthRef = firstValid !== null
    ? perFrameWidth.reduce((a, b) => a + b, 0) / perFrameWidth.length
    : null;

  const positions = frames.map(f => f.landmarks[jointName]);

  // Frame-to-frame velocities — each interval normalised by the mean of the
  // two adjacent frames' shoulder widths for smooth interpolation at boundaries.
  const velocities: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1].landmarks[jointName];
    const curr = frames[i].landmarks[jointName];
    const timeDelta = (frames[i].timestamp - frames[i - 1].timestamp) / 1000;
    const bodyScale = (perFrameWidth[i - 1] + perFrameWidth[i]) / 2;

    const dx = (curr.x - prev.x) / bodyScale;
    const dy = (curr.y - prev.y) / bodyScale;
    const dz = ((curr.z ?? 0) - (prev.z ?? 0)) / bodyScale;
    const speed = timeDelta > 0 ? Math.sqrt(dx * dx + dy * dy + dz * dz) / timeDelta : 0;
    velocities.push(speed);
  }

  // Velocity variance in (body-widths/s)^2
  const meanVelocity = velocities.reduce((a, b) => a + b, 0) / velocities.length;
  const velocityVariance =
    velocities.reduce((sum, v) => sum + Math.pow(v - meanVelocity, 2), 0) / velocities.length;

  // Position std dev — only over frames where the joint was actually visible.
  // Occluded joints are stored as (0,0,0) with visibility=0; including those
  // zeros would pull the mean toward the origin and inflate std dev.
  const validPositions = positions.filter(p => (p.visibility ?? 1) >= 0.5);
  const positionStdDev = (() => {
    if (validPositions.length === 0) return { x: 0, y: 0, z: 0 };
    const mean = {
      x: validPositions.reduce((s, p) => s + p.x, 0) / validPositions.length,
      y: validPositions.reduce((s, p) => s + p.y, 0) / validPositions.length,
      z: validPositions.reduce((s, p) => s + (p.z ?? 0), 0) / validPositions.length,
    };
    return {
      x: Math.sqrt(validPositions.reduce((s, p) => s + Math.pow(p.x - mean.x, 2), 0) / validPositions.length),
      y: Math.sqrt(validPositions.reduce((s, p) => s + Math.pow(p.y - mean.y, 2), 0) / validPositions.length),
      z: Math.sqrt(validPositions.reduce((s, p) => s + Math.pow((p.z ?? 0) - mean.z, 2), 0) / validPositions.length),
    };
  })();

  // High-frequency noise: fraction of frames where acceleration > 2× mean velocity
  let rapidChanges = 0;
  for (let i = 2; i < velocities.length; i++) {
    if (Math.abs(velocities[i] - velocities[i - 1]) > meanVelocity * 2) rapidChanges++;
  }
  const highFrequencyNoise = rapidChanges / velocities.length;

  // Smoothness score — thresholds calibrated for body-width-normalised velocity units
  const jitterScore = velocityVariance + highFrequencyNoise * 10;
  const smoothnessScore = Math.max(0, Math.min(100, 100 - jitterScore * 1000));

  return {
    jointName,
    relativeVelocity: meanVelocity,
    velocityVariance,
    positionStdDev,
    smoothnessScore,
    highFrequencyNoise,
    shoulderWidthRef,
    velocitySamples: velocities,
  };
}

// ===== OCCLUSION METRICS =====
// MediaPipe Pose Landmarker provides visibility scores (0-1) for each landmark
// indicating the likelihood the landmark is visible and not occluded

export interface OcclusionMetrics {
  jointName: keyof PoseLandmarks;
  averageVisibility: number;
  minVisibility: number;
  occludedFrameCount: number; // Frames below threshold
  occludedFramePercentage: number;
  visibilityTimeline: Array<{ frame: number; visibility: number; timestamp: number }>;
}

export function calculateOcclusionMetrics(
  recording: MotionRecording,
  jointName: keyof PoseLandmarks,
  visibilityThreshold: number = 0.5
): OcclusionMetrics {
  const frames = recording.frames;
  const visibilities: number[] = [];
  const visibilityTimeline: Array<{ frame: number; visibility: number; timestamp: number }> = [];

  let occludedFrameCount = 0;

  for (let i = 0; i < frames.length; i++) {
    const landmark = frames[i].landmarks[jointName];
    const visibility = landmark.visibility ?? 1.0;
    visibilities.push(visibility);
    visibilityTimeline.push({
      frame: i,
      visibility,
      timestamp: frames[i].timestamp,
    });

    if (visibility < visibilityThreshold) {
      occludedFrameCount++;
    }
  }

  const averageVisibility = visibilities.reduce((a, b) => a + b, 0) / visibilities.length;
  const minVisibility = Math.min(...visibilities);
  const occludedFramePercentage = (occludedFrameCount / frames.length) * 100;

  return {
    jointName,
    averageVisibility,
    minVisibility,
    occludedFrameCount,
    occludedFramePercentage,
    visibilityTimeline,
  };
}

// ===== LIMB SWAP DETECTION =====

export interface LimbSwapMetrics {
  detectedSwaps: Array<{
    frame: number;
    timestamp: number;
    type: 'arm' | 'leg' | 'side';
    description: string;
  }>;
  swapCount: number;
  affectedFramePercentage: number;
}

export function detectLimbSwaps(recording: MotionRecording): LimbSwapMetrics {
  const frames = recording.frames;
  const detectedSwaps: LimbSwapMetrics['detectedSwaps'] = [];

  for (let i = 0; i < frames.length; i++) {
    const landmarks = frames[i].landmarks;

    // Check if left wrist is on the right side of the body
    const shoulderMidX = (landmarks.leftShoulder.x + landmarks.rightShoulder.x) / 2;

    // Left wrist should be < midpoint (on left side)
    if (landmarks.leftWrist.x > shoulderMidX + 0.1) {
      detectedSwaps.push({
        frame: i,
        timestamp: frames[i].timestamp,
        type: 'arm',
        description: 'Left wrist detected on right side of body',
      });
    }

    // Right wrist should be > midpoint (on right side)
    if (landmarks.rightWrist.x < shoulderMidX - 0.1) {
      detectedSwaps.push({
        frame: i,
        timestamp: frames[i].timestamp,
        type: 'arm',
        description: 'Right wrist detected on left side of body',
      });
    }

    // Check ankles
    const hipMidX = (landmarks.leftHip.x + landmarks.rightHip.x) / 2;

    if (landmarks.leftAnkle.x > hipMidX + 0.1) {
      detectedSwaps.push({
        frame: i,
        timestamp: frames[i].timestamp,
        type: 'leg',
        description: 'Left ankle detected on right side of body',
      });
    }

    if (landmarks.rightAnkle.x < hipMidX - 0.1) {
      detectedSwaps.push({
        frame: i,
        timestamp: frames[i].timestamp,
        type: 'leg',
        description: 'Right ankle detected on left side of body',
      });
    }

    // Check if left landmarks have higher x values than right (should be opposite)
    if (landmarks.leftShoulder.x > landmarks.rightShoulder.x) {
      detectedSwaps.push({
        frame: i,
        timestamp: frames[i].timestamp,
        type: 'side',
        description: 'Left/right shoulder positions swapped',
      });
    }

    if (landmarks.leftHip.x > landmarks.rightHip.x) {
      detectedSwaps.push({
        frame: i,
        timestamp: frames[i].timestamp,
        type: 'side',
        description: 'Left/right hip positions swapped',
      });
    }
  }

  const affectedFrames = new Set(detectedSwaps.map(s => s.frame));
  const affectedFramePercentage = (affectedFrames.size / frames.length) * 100;

  return {
    detectedSwaps,
    swapCount: detectedSwaps.length,
    affectedFramePercentage,
  };
}

// ===== DEPTH AMBIGUITY METRICS =====

export interface DepthAmbiguityMetrics {
  jointPair: string;
  depthVariance: number;
  inconsistentFrames: Array<{
    frame: number;
    timestamp: number;
    issue: string;
    expectedRelation: string;
    actualRelation: string;
  }>;
  inconsistencyPercentage: number;
  averageDepthSeparation: number;
  zOrderFlips?: number;
  depthJitterScore?: number;
  depthMovementRatio?: number;
  ambiguityDetected?: boolean;
}

export function calculateDepthAmbiguity(
  recording: MotionRecording,
  joint1: keyof PoseLandmarks,
  joint2: keyof PoseLandmarks
): DepthAmbiguityMetrics {
  const frames = recording.frames;

  const depthDiffs: number[] = [];
  const inconsistentFrames: DepthAmbiguityMetrics["inconsistentFrames"] = [];

  let zOrderFlips = 0;
  let overlapFrames = 0;
  let zSpikeFrames = 0;

  if (frames.length < 2) {
    return {
      jointPair: `${joint1} - ${joint2}`,
      depthVariance: 0,
      inconsistentFrames: [],
      inconsistencyPercentage: 0,
      averageDepthSeparation: 0,
      zOrderFlips: 0,
      depthJitterScore: 100,
      depthMovementRatio: 0,
      ambiguityDetected: false,
    };
  }

  for (let i = 0; i < frames.length; i++) {
    const landmark1 = frames[i].landmarks[joint1];
    const landmark2 = frames[i].landmarks[joint2];

    if (!landmark1 || !landmark2) continue;

    const depthDiff = landmark1.z - landmark2.z;
    depthDiffs.push(depthDiff);

    if (i === 0) continue;

    const prev1 = frames[i - 1].landmarks[joint1];
    const prev2 = frames[i - 1].landmarks[joint2];

    if (!prev1 || !prev2) continue;

    const prevDepthDiff = prev1.z - prev2.z;

    const zOrderFlipped =
      (depthDiff > 0 && prevDepthDiff < 0) ||
      (depthDiff < 0 && prevDepthDiff > 0);

    if (zOrderFlipped) {
      zOrderFlips++;
    }

    // 2D distance between the two joints in the current frame
    const pairDx = landmark1.x - landmark2.x;
    const pairDy = landmark1.y - landmark2.y;
    const xyDistance = Math.sqrt(pairDx * pairDx + pairDy * pairDy);

    // If joints are close together in the image, depth is more ambiguous
    const jointsOverlapIn2D = xyDistance < 0.12;

    if (jointsOverlapIn2D) {
      overlapFrames++;
    }

    // Change in z separation between these two joints
    const prevZSeparation = Math.abs(prev1.z - prev2.z);
    const currentZSeparation = Math.abs(landmark1.z - landmark2.z);
    const zSeparationChange = Math.abs(currentZSeparation - prevZSeparation);

    // Frame-to-frame movement for joint 1
    const joint1XYMove = Math.sqrt(
      Math.pow(landmark1.x - prev1.x, 2) +
      Math.pow(landmark1.y - prev1.y, 2)
    );
    const joint1ZMove = Math.abs(landmark1.z - prev1.z);

    // Frame-to-frame movement for joint 2
    const joint2XYMove = Math.sqrt(
      Math.pow(landmark2.x - prev2.x, 2) +
      Math.pow(landmark2.y - prev2.y, 2)
    );
    const joint2ZMove = Math.abs(landmark2.z - prev2.z);

    // A z spike is suspicious when z changes a lot but x/y barely moves
    const joint1ZSpike = joint1XYMove < 0.04 && joint1ZMove > 0.12;
    const joint2ZSpike = joint2XYMove < 0.04 && joint2ZMove > 0.12;

    if (joint1ZSpike || joint2ZSpike) {
      zSpikeFrames++;
    }

    // Strong ambiguity condition:
    // only flag when the z instability happens with overlap, z-order flip,
    // sharp z separation change, or suspicious z spike.
    const hasUnstableDepth =
      zOrderFlipped ||
      zSeparationChange > 0.08 ||
      joint1ZSpike ||
      joint2ZSpike;

    const ambiguityLikely =
      hasUnstableDepth &&
      (
        jointsOverlapIn2D ||
        zOrderFlipped ||
        zSeparationChange > 0.12 ||
        joint1ZSpike ||
        joint2ZSpike
      );

    if (ambiguityLikely) {
      let issue = "Possible unstable relative depth";

      if (joint1ZSpike || joint2ZSpike) {
        issue = "Z-depth spike with little 2D movement";
      } else if (zOrderFlipped) {
        issue = "Z-order flipped between frames";
      } else if (zSeparationChange > 0.08) {
        issue = "Z-separation changed sharply";
      }

      inconsistentFrames.push({
        frame: i,
        timestamp: frames[i].timestamp,
        issue,
        expectedRelation: "Depth should change smoothly between neighboring frames",
        actualRelation: `${joint1} and ${joint2} showed unstable z-depth behavior`,
      });
    }
  }

  const meanDepthDiff =
    depthDiffs.length > 0
      ? depthDiffs.reduce((a, b) => a + b, 0) / depthDiffs.length
      : 0;

  const depthVariance =
    depthDiffs.length > 0
      ? depthDiffs.reduce((sum, d) => sum + Math.pow(d - meanDepthDiff, 2), 0) /
        depthDiffs.length
      : 0;

  const inconsistencyPercentage =
    (inconsistentFrames.length / Math.max(1, frames.length)) * 100;

  const averageDepthSeparation = Math.abs(meanDepthDiff);

  // Overall z movement compared with x/y movement for joint1
  let xyMovement = 0;
  let zMovement = 0;

  for (let i = 1; i < frames.length; i++) {
    const prev1 = frames[i - 1].landmarks[joint1];
    const curr1 = frames[i].landmarks[joint1];

    if (!prev1 || !curr1) continue;

    const dx = curr1.x - prev1.x;
    const dy = curr1.y - prev1.y;
    const dz = curr1.z - prev1.z;

    xyMovement += Math.sqrt(dx * dx + dy * dy);
    zMovement += Math.abs(dz);
  }

  const depthMovementRatio = xyMovement > 0 ? zMovement / xyMovement : 0;

  const flipRate = zOrderFlips / Math.max(1, frames.length - 1);
  const unstableRate = inconsistentFrames.length / Math.max(1, frames.length);
  const overlapRate = overlapFrames / Math.max(1, frames.length);
  const zSpikeRate = zSpikeFrames / Math.max(1, frames.length);

  // Higher ambiguityScore = worse depth reliability
  const ambiguityScore = Math.min(
    100,
    flipRate * 35 +
      unstableRate * 35 +
      overlapRate * 10 +
      zSpikeRate * 30 +
      Math.min(depthMovementRatio * 8, 20)
  );

  const depthJitterScore = Math.max(0, 100 - ambiguityScore);

  return {
    jointPair: `${joint1} - ${joint2}`,
    depthVariance,
    inconsistentFrames,
    inconsistencyPercentage,
    averageDepthSeparation,
    zOrderFlips,
    depthJitterScore,
    depthMovementRatio,
    ambiguityDetected: ambiguityScore > 30,
  };
}

export interface EnhancedDepthAmbiguityMetrics {
  pairAnalyses: DepthAmbiguityMetrics[];
  limbCrossingEvents: Array<{
    frame: number;
    timestamp: number;
    leftLimb: keyof PoseLandmarks;
    rightLimb: keyof PoseLandmarks;
    description: string;
  }>;
  overlapDetections: Array<{
    frame: number;
    timestamp: number;
    joint1: keyof PoseLandmarks;
    joint2: keyof PoseLandmarks;
    xy2DDistance: number;
    unstableZSeparation: boolean;
  }>;
  severityScore: number; // 0-100, higher = more ambiguity
}

export function detectEnhancedDepthAmbiguity(recording: MotionRecording): EnhancedDepthAmbiguityMetrics {
  const frames = recording.frames;
  const pairAnalyses: DepthAmbiguityMetrics[] = [];
  const limbCrossingEvents: EnhancedDepthAmbiguityMetrics['limbCrossingEvents'] = [];
  const overlapDetections: EnhancedDepthAmbiguityMetrics['overlapDetections'] = [];

  // Analyze key paired joints (parent-child in kinematic chain)
 const jointPairs: Array<[keyof PoseLandmarks, keyof PoseLandmarks]> = [
  ['leftWrist', 'rightWrist'],
  ['leftElbow', 'rightElbow'],
  ['leftWrist', 'rightElbow'],
  ['rightWrist', 'leftElbow'],
  ['leftKnee', 'rightKnee'],
  ['leftAnkle', 'rightAnkle'],
];

 for (const [joint1, joint2] of jointPairs) {
  const analysis = calculateDepthAmbiguity(recording, joint1, joint2);
  pairAnalyses.push(analysis);
}

  // Detect left/right limb crossing with unstable z values
  for (let i = 0; i < frames.length; i++) {
    const landmarks = frames[i].landmarks;

    // Check wrist crossing
    if (Math.abs(landmarks.leftWrist.x - landmarks.rightWrist.x) < 0.15) {
      // Wrists are overlapping in 2D
      const zDiff = landmarks.leftWrist.z - landmarks.rightWrist.z;
      if (i > 0) {
        const prevZDiff = frames[i - 1].landmarks.leftWrist.z - frames[i - 1].landmarks.rightWrist.z;
        const zDiffChange = Math.abs(zDiff - prevZDiff);
        if (zDiffChange > 0.1) {
          limbCrossingEvents.push({
            frame: i,
            timestamp: frames[i].timestamp,
            leftLimb: 'leftWrist',
            rightLimb: 'rightWrist',
            description: 'Wrists crossing with rapid z-value changes',
          });
        }
      }
    }

    // Check ankle crossing
    if (Math.abs(landmarks.leftAnkle.x - landmarks.rightAnkle.x) < 0.15) {
      const zDiff = landmarks.leftAnkle.z - landmarks.rightAnkle.z;
      if (i > 0) {
        const prevZDiff = frames[i - 1].landmarks.leftAnkle.z - frames[i - 1].landmarks.rightAnkle.z;
        const zDiffChange = Math.abs(zDiff - prevZDiff);
        if (zDiffChange > 0.1) {
          limbCrossingEvents.push({
            frame: i,
            timestamp: frames[i].timestamp,
            leftLimb: 'leftAnkle',
            rightLimb: 'rightAnkle',
            description: 'Ankles crossing with rapid z-value changes',
          });
        }
      }
    }
  }

  // Detect 2D overlaps with unstable depth separation
  const overlapPairs: Array<[keyof PoseLandmarks, keyof PoseLandmarks]> = [
    ['leftWrist', 'rightWrist'],
    ['leftElbow', 'rightElbow'],
    ['leftAnkle', 'rightAnkle'],
    ['leftKnee', 'rightKnee'],
  ];

  for (const [joint1, joint2] of overlapPairs) {
    for (let i = 1; i < frames.length; i++) {
      const landmark1 = frames[i].landmarks[joint1];
      const landmark2 = frames[i].landmarks[joint2];

      if (!landmark1 || !landmark2) continue;

      // Calculate 2D distance
      const dx = landmark1.x - landmark2.x;
      const dy = landmark1.y - landmark2.y;
      const xy2DDistance = Math.sqrt(dx * dx + dy * dy);

      // Check for 2D overlap with unstable z separation
      if (xy2DDistance < 0.15) {
        const zSep = Math.abs(landmark1.z - landmark2.z);
        const prevZSep = Math.abs(
          frames[i - 1].landmarks[joint1].z - frames[i - 1].landmarks[joint2].z
        );
        const zSepChange = Math.abs(zSep - prevZSep);

        if (zSepChange > 0.05) {
          overlapDetections.push({
            frame: i,
            timestamp: frames[i].timestamp,
            joint1,
            joint2,
            xy2DDistance,
            unstableZSeparation: true,
          });
        }
      }
    }
  }

  // Calculate severity score
  const ambiguousPairs = pairAnalyses.filter(p => p.ambiguityDetected).length;
  const pairAmbiguityScore = (ambiguousPairs / pairAnalyses.length) * 100;
  const crossingScore = Math.min(100, limbCrossingEvents.length * 5);
  const overlapScore = Math.min(100, overlapDetections.length * 3);
  const severityScore = (pairAmbiguityScore * 0.4 + crossingScore * 0.3 + overlapScore * 0.3);

  return {
    pairAnalyses,
    limbCrossingEvents,
    overlapDetections,
    severityScore,
  };
}

// ===== SUMMARY METRICS =====

export interface QualitySummary {
  overallScore: number; // 0-100
  jitterScore: number;
  occlusionScore: number;
  limbSwapScore: number;
  depthScore: number;
  issues: string[];
}

export function calculateQualitySummary(recording: MotionRecording): QualitySummary {
  // Calculate average jitter across key joints
  const keyJoints: Array<keyof PoseLandmarks> = [
    'leftWrist',
    'rightWrist',
    'leftElbow',
    'rightElbow',
    'leftKnee',
    'rightKnee',
  ];

  const jitterMetrics = keyJoints.map(j => calculateJitterMetrics(recording, j));
  const avgJitterScore = jitterMetrics.reduce((sum, m) => sum + m.smoothnessScore, 0) / jitterMetrics.length;

  // Calculate average occlusion across all joints
  const allJoints = Object.keys(recording.frames[0]?.landmarks || {}) as Array<keyof PoseLandmarks>;
  const occlusionMetrics = allJoints.map(j => calculateOcclusionMetrics(recording, j));
  const avgVisibility = occlusionMetrics.reduce((sum, m) => sum + m.averageVisibility, 0) / occlusionMetrics.length;
  const occlusionScore = avgVisibility * 100;

  // Limb swap detection
  const limbSwaps = detectLimbSwaps(recording);
  const limbSwapScore = Math.max(0, 100 - limbSwaps.affectedFramePercentage);

  // Depth consistency / ambiguity checks
const depthMetrics = [
  calculateDepthAmbiguity(recording, 'leftWrist', 'rightWrist'),
  calculateDepthAmbiguity(recording, 'leftWrist', 'rightElbow'),
  calculateDepthAmbiguity(recording, 'rightWrist', 'leftElbow'),
  calculateDepthAmbiguity(recording, 'leftAnkle', 'rightAnkle'),
];

const avgDepthInconsistency =
  depthMetrics.reduce((sum, m) => sum + m.inconsistencyPercentage, 0) /
  depthMetrics.length;
  
  // Check for enhanced depth ambiguity
const enhancedDepthAnalysis = detectEnhancedDepthAmbiguity(recording);

// Depth score: higher is better.
// Average depth inconsistency catches unstable pair behavior.
// Severity score catches broader crossing/overlap ambiguity.
const depthScore = Math.max(
  0,
  100 - (avgDepthInconsistency * 0.5) - (enhancedDepthAnalysis.severityScore * 0.5)
);

// Overall score (weighted average)
const overallScore = (
  avgJitterScore * 0.3 +
  occlusionScore * 0.3 +
  limbSwapScore * 0.2 +
  depthScore * 0.2
);

  // Collect issues
  const issues: string[] = [];
  if (avgJitterScore < 70) issues.push('High joint jitter detected');
  if (occlusionScore < 70) issues.push('Frequent occlusions detected');
  if (limbSwaps.swapCount > 0) issues.push(`${limbSwaps.swapCount} limb swap events detected`);
  if (avgDepthInconsistency > 30) issues.push('Depth tracking inconsistencies detected');
  if (enhancedDepthAnalysis.severityScore > 40) {
    issues.push(`Depth ambiguity detected: ${enhancedDepthAnalysis.pairAnalyses.filter(p => p.ambiguityDetected).length} joint pairs with z-order instability`);
  }
  if (enhancedDepthAnalysis.limbCrossingEvents.length > 0) {
    issues.push(`Limb crossing detected in ${enhancedDepthAnalysis.limbCrossingEvents.length} frames with unstable z-values`);
  }
  if (enhancedDepthAnalysis.overlapDetections.length > 0) {
    issues.push(`Joint overlaps detected in ${enhancedDepthAnalysis.overlapDetections.length} frames with unstable depth separation`);
  }

  return {
    overallScore,
    jitterScore: avgJitterScore,
    occlusionScore,
    limbSwapScore,
    depthScore,
    issues,
  };
}
