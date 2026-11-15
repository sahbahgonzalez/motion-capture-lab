/**
 * Lightweight test runner for the fusion controller.
 * Uses no test framework — runs with: pnpm exec tsx src/app/hooks/__tests__/runTests.ts
 *
 * Each test function throws on failure; all tests run before exit.
 * Output: PASS / FAIL per test, summary at end.
 */

import {
  createFusionController,
  type FusionFrameInput,
  type FusionFrameResult,
  DEFAULT_FUSION_CONFIG,
} from '../useIMUFusionController';
import type { JointFailureStatus } from '../usePoseFailureCorrection';
import {
  calculateRecordingFrameRate,
  createMotionFrame,
  useMotionRecorder,
  type MotionRecording,
} from '../useMotionRecorder';
import { triangulatedPoseToMotionLandmarks } from '../useStereoMotionRecorder';
import {
  buildSynchronizationDiagnostics,
  createCameraTimingObservation,
  createExperimentClockMetadata,
  createStereoVideoRecording,
  createUnavailableCameraTimingSidecar,
  summarizeCameraTiming,
  type CameraTimingSidecar,
  type RecordedCameraTimingObservation,
} from '../useStereoVideoRecorder';
import type { PoseLandmarks } from '../useMediaPipePose';
import type { TriangulatedPose } from '../useTriangulation';
import {
  EXPERIMENT_SCHEMA_VERSION,
  type ExperimentCalibrationMetadata,
  type ExperimentCycle,
  type IMUAlsCalibrationSnapshot,
} from '../../types/experiment';
import type { StereoCalibration } from '../../types/calibration';
import { calculateJitterMetrics } from '../../utils/motionQualityMetrics';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ── Helpers ───────────────────────────────────────────────────────────────────

type Pt3 = { x: number; y: number; z: number };

const shoulder: Pt3 = { x: 0,   y: 0,    z: 0  };
const elbow: Pt3    = { x: 300, y: -50,  z: 10 };
const wrist: Pt3    = { x: 540, y: -100, z: 20 };
const imuUADir: [number, number, number] = [0.986, -0.160, 0.040];
const imuFADir: [number, number, number] = [0.942, -0.196, 0.274];
const calibFaLengthMm = 260;

function reliable(joint: string): JointFailureStatus {
  return { joint: joint as JointFailureStatus['joint'], failureType: 'none', reliable: true, correctionMethod: 'none', requiresIMU: false };
}
function unreliable(joint: string): JointFailureStatus {
  return { joint: joint as JointFailureStatus['joint'], failureType: 'occlusion', reliable: false, correctionMethod: 'none', requiresIMU: false };
}
function allReliable(): JointFailureStatus[] {
  return [reliable('rightShoulder'), reliable('rightElbow'), reliable('rightWrist')];
}
function baseInput(overrides: Partial<FusionFrameInput> = {}): FusionFrameInput {
  return {
    stereoShoulder: shoulder,
    stereoElbow: elbow,
    stereoWrist: wrist,
    imuUADir,
    imuFADir,
    jointStatuses: allReliable(),
    calibrationValid: true,
    calibUaLengthMm: 300,
    calibFaLengthMm,
    imu01AgeMs: 20,
    imu02AgeMs: 20,
    simulated: { shoulder: false, elbow: false, wrist: false },
    nowMs: 1000,
    ...overrides,
  };
}
function runFrames(ctrl: ReturnType<typeof createFusionController>, n: number, overrides: Partial<FusionFrameInput>, startNow = 1000): FusionFrameResult {
  let result!: FusionFrameResult;
  for (let i = 0; i < n; i++) result = ctrl.processFusionFrame(baseInput({ ...overrides, nowMs: startNow + i * 16 }));
  return result;
}
function dist3(a: Pt3, b: Pt3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function makeLandmarks(
  overrides: Partial<PoseLandmarks> = {},
): PoseLandmarks {
  const point = { x: 0, y: 0, z: 0, visibility: 1 };
  return {
    nose: { ...point },
    leftShoulder: { ...point, x: -1 },
    rightShoulder: { ...point, x: 1 },
    leftElbow: { ...point },
    rightElbow: { ...point },
    leftWrist: { ...point },
    rightWrist: { ...point },
    leftHip: { ...point },
    rightHip: { ...point },
    leftKnee: { ...point },
    rightKnee: { ...point },
    leftAnkle: { ...point },
    rightAnkle: { ...point },
    ...overrides,
  };
}

const testStereoCalibration: StereoCalibration = {
  camera1: {
    K: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    distortion: [0, 0, 0, 0, 0],
    imageWidth: 1280,
    imageHeight: 720,
    reprojectionError: 0.2,
  },
  camera2: {
    K: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    distortion: [0, 0, 0, 0, 0],
    imageWidth: 1280,
    imageHeight: 720,
    reprojectionError: 0.2,
  },
  extrinsic: {
    R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    T: [100, 0, 0],
    E: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    F: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
  },
  P1: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]],
  P2: [[1, 0, 0, 100], [0, 1, 0, 0], [0, 0, 1, 0]],
  stereoReprojectionError: 0.3,
  calibrationDate: '2026-01-01T00:00:00.000Z',
  checkerboardConfig: { rows: 6, cols: 9, squareSize: 25 },
};

const testImuCalibration: IMUAlsCalibrationSnapshot = {
  timestampMs: 1,
  upperArm: {
    boneLocalDirection: [1, 0, 0],
    imuWorldToStereoRotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    lengthMm: 300,
  },
  forearm: {
    boneLocalDirection: [1, 0, 0],
    imuWorldToStereoRotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    lengthMm: 250,
  },
  quality: 'good',
};

function createRecorderHarness(): ReturnType<typeof useMotionRecorder> {
  let recorder: ReturnType<typeof useMotionRecorder> | null = null;
  function Harness() {
    recorder = useMotionRecorder();
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  if (!recorder) throw new Error('Recorder harness failed to initialize');
  return recorder;
}

function makeCameraTimingSidecar(
  recordingId: string,
  cameraRole: 'camera_a' | 'camera_b',
  experimentStartPerformanceNowMs: number,
  observations: RecordedCameraTimingObservation[],
): CameraTimingSidecar {
  return {
    schemaVersion: '1.0.0-camera-timing',
    recordingId,
    cameraRole,
    cameraId: `${cameraRole}-device`,
    videoAssetId: `${recordingId}:${cameraRole}:video`,
    experimentStartPerformanceNowMs,
    metadataAvailability: 'frame_specific',
    synchronizationStatus: 'unverified',
    observations,
    summary: summarizeCameraTiming(observations),
  };
}

// ── Assertion helpers ─────────────────────────────────────────────────────────
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}
function eq<T>(a: T, b: T, msg: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ── Test registry ─────────────────────────────────────────────────────────────
type Test = { name: string; fn: () => void };
const tests: Test[] = [];
function test(name: string, fn: () => void): void { tests.push({ name, fn }); }

// ── Tests ─────────────────────────────────────────────────────────────────────

test('1. All joints reliable: output equals stereo', () => {
  const ctrl = createFusionController();
  const r = runFrames(ctrl, 10, {});
  eq(r.diagnostics.uaState, 'STEREO', 'uaState');
  eq(r.diagnostics.faState, 'STEREO', 'faState');
  eq(r.finalElbow, elbow, 'finalElbow');
  eq(r.finalWrist, wrist, 'finalWrist');
  eq(r.finalShoulder, shoulder, 'finalShoulder');
});

test('2. Wrist occluded: FA→IMU_CORRECTION, UA stays STEREO', () => {
  const ctrl = createFusionController();
  runFrames(ctrl, 5, {});
  const r = ctrl.processFusionFrame(baseInput({
    stereoWrist: null,
    jointStatuses: [reliable('rightShoulder'), reliable('rightElbow'), unreliable('rightWrist')],
    nowMs: 2000,
  }));
  eq(r.diagnostics.uaState, 'STEREO', 'uaState');
  eq(r.diagnostics.faState, 'IMU_CORRECTION', 'faState');
  eq(r.finalElbow, elbow, 'finalElbow must be stereo elbow');
  assert(r.finalWrist !== null, 'finalWrist must not be null');
});

test('3. Elbow occluded: UA→IMU_CORRECTION', () => {
  const ctrl = createFusionController();
  runFrames(ctrl, 5, {});
  const r = ctrl.processFusionFrame(baseInput({
    stereoElbow: null,
    jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
    nowMs: 2000,
  }));
  eq(r.diagnostics.uaState, 'IMU_CORRECTION', 'uaState');
  assert(r.finalElbow !== null, 'finalElbow must not be null');
});

test('4. Elbow+wrist occluded: both segments IMU', () => {
  const ctrl = createFusionController();
  runFrames(ctrl, 5, {});
  const r = ctrl.processFusionFrame(baseInput({
    stereoElbow: null, stereoWrist: null,
    jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), unreliable('rightWrist')],
    nowMs: 2000,
  }));
  eq(r.diagnostics.uaState, 'IMU_CORRECTION', 'uaState');
  eq(r.diagnostics.faState, 'IMU_CORRECTION', 'faState');
  assert(r.finalElbow !== null, 'finalElbow');
  assert(r.finalWrist !== null, 'finalWrist');
});

test('5. Shoulder anchor expires', () => {
  const ctrl = createFusionController({ shoulderAnchorMaxAgeMs: 200 });
  ctrl.processFusionFrame(baseInput({ nowMs: 1000 }));
  const r = ctrl.processFusionFrame(baseInput({
    stereoShoulder: null,
    jointStatuses: [unreliable('rightShoulder'), reliable('rightElbow'), reliable('rightWrist')],
    nowMs: 1210,
  }));
  eq(r.diagnostics.shoulderAnchorState, 'expired', 'anchorState');
  assert(r.effectiveShoulder === null, 'effectiveShoulder must be null when expired');
});

test('6. IMU_01 stale: UA→UNAVAILABLE', () => {
  const ctrl = createFusionController();
  runFrames(ctrl, 5, {});
  const r = ctrl.processFusionFrame(baseInput({
    stereoElbow: null,
    jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
    imu01AgeMs: 9999, nowMs: 2000,
  }));
  eq(r.diagnostics.uaState, 'UNAVAILABLE', 'uaState');
  assert(r.finalElbow === null, 'finalElbow must be null');
});

test('7. IMU_02 stale: FA→UNAVAILABLE', () => {
  const ctrl = createFusionController();
  runFrames(ctrl, 5, {});
  const r = ctrl.processFusionFrame(baseInput({
    stereoWrist: null,
    jointStatuses: [reliable('rightShoulder'), reliable('rightElbow'), unreliable('rightWrist')],
    imu02AgeMs: 9999, nowMs: 2000,
  }));
  eq(r.diagnostics.faState, 'UNAVAILABLE', 'faState');
  assert(r.finalWrist === null, 'finalWrist must be null');
});

test('8. Calibration invalid: no IMU correction', () => {
  const ctrl = createFusionController();
  runFrames(ctrl, 5, {});
  const r = ctrl.processFusionFrame(baseInput({
    stereoElbow: null, stereoWrist: null,
    jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), unreliable('rightWrist')],
    calibrationValid: false, imuUADir: null, imuFADir: null, nowMs: 2000,
  }));
  assert(r.diagnostics.imuCalibrationValid === false, 'calibrationValid');
  eq(r.diagnostics.uaState, 'UNAVAILABLE', 'uaState');
  eq(r.diagnostics.faState, 'UNAVAILABLE', 'faState');
  assert(r.finalElbow === null && r.finalWrist === null, 'joints must be null');
});

test('9. One-frame stereo recovery: still confirming, output unchanged', () => {
  const ctrl = createFusionController({ recoveryConfirmFrames: 5, blendFrames: 4 });
  runFrames(ctrl, 5, {});
  ctrl.processFusionFrame(baseInput({
    stereoElbow: null,
    jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
    nowMs: 2000,
  }));
  // The frame that transitions FROM IMU_CORRECTION TO RECOVERY does not run the RECOVERY
  // case — it runs the IMU_CORRECTION case which sets state=RECOVERY. recoveryFrame stays 0.
  const r = ctrl.processFusionFrame(baseInput({ nowMs: 2016 }));
  eq(r.diagnostics.uaState, 'RECOVERY', 'uaState');
  eq(r.diagnostics.uaRecoveryPhase, 'confirming', 'recoveryPhase');
  // recoveryFrame = 0 on the entry frame; the next frame will increment it to 1
  assert(r.diagnostics.uaRecoveryFrame >= 0, 'recoveryFrame must be non-negative');
  assert(r.finalElbow !== null, 'finalElbow must not be null during confirming');
});

test('10. Sustained recovery: confirm then blend then STEREO', () => {
  // With recoveryConfirmFrames=3: the entry frame is recoveryFrame=0; next 3 frames → recoveryFrame 1,2,3
  // Frame with recoveryFrame=3 >= 3 sets recoveryConfirmed=true. That's 4 recovery frames total.
  const ctrl = createFusionController({ recoveryConfirmFrames: 3, blendFrames: 4 });
  runFrames(ctrl, 5, {});
  ctrl.processFusionFrame(baseInput({
    stereoElbow: null,
    jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
    nowMs: 2000,
  }));
  let r!: FusionFrameResult;
  // 4 recovery frames (frame 0 is entry; frames 1,2,3 confirm; frame 3 triggers blending)
  for (let i = 0; i < 4; i++) r = ctrl.processFusionFrame(baseInput({ nowMs: 2016 + i * 16 }));
  eq(r.diagnostics.uaState, 'RECOVERY', 'uaState after confirm');
  eq(r.diagnostics.uaRecoveryPhase, 'blending', 'recoveryPhase after confirm');
  // Then blendFrames (4) more frames to reach STEREO
  for (let i = 0; i < 4; i++) r = ctrl.processFusionFrame(baseInput({ nowMs: 2080 + i * 16 }));
  eq(r.diagnostics.uaState, 'STEREO', 'uaState after blend');
  eq(r.finalElbow, elbow, 'finalElbow restored to stereo');
});

test('11. Intermittent stereo during recovery: resets counter', () => {
  const ctrl = createFusionController({ recoveryConfirmFrames: 5, blendFrames: 4 });
  runFrames(ctrl, 5, {});
  const occluded = { stereoElbow: null as Pt3 | null, jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')] };
  ctrl.processFusionFrame(baseInput({ ...occluded, nowMs: 2000 }));
  for (let i = 0; i < 3; i++) ctrl.processFusionFrame(baseInput({ nowMs: 2016 + i * 16 }));
  const r = ctrl.processFusionFrame(baseInput({ ...occluded, nowMs: 2064 }));
  eq(r.diagnostics.uaState, 'IMU_CORRECTION', 'uaState after interruption');
  eq(r.diagnostics.uaRecoveryFrame, 0, 'recoveryFrame must reset');
});

test('12. Both return from UNAVAILABLE: stereo path takes priority', () => {
  const ctrl = createFusionController();
  ctrl.processFusionFrame(baseInput({
    stereoElbow: null, imuUADir: null, imuFADir: null, calibrationValid: false,
    jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
    nowMs: 1000,
  }));
  const r = ctrl.processFusionFrame(baseInput({ nowMs: 1016 }));
  eq(r.diagnostics.uaState, 'RECOVERY', 'uaState must be RECOVERY not IMU_CORRECTION');
  eq(r.diagnostics.uaRecoveryPhase, 'confirming', 'recoveryPhase');
});

test('13. Wrist correction with stereo elbow: wrist anchors to stereo elbow', () => {
  const ctrl = createFusionController();
  runFrames(ctrl, 5, {});
  const r = ctrl.processFusionFrame(baseInput({
    stereoWrist: null,
    jointStatuses: [reliable('rightShoulder'), reliable('rightElbow'), unreliable('rightWrist')],
    nowMs: 2000,
  }));
  eq(r.diagnostics.uaState, 'STEREO', 'uaState');
  eq(r.diagnostics.faState, 'IMU_CORRECTION', 'faState');
  eq(r.finalElbow, elbow, 'finalElbow must be stereo');
  assert(r.finalWrist !== null, 'finalWrist must not be null');
  if (r.finalWrist && r.finalElbow) {
    const len = dist3(r.finalElbow, r.finalWrist);
    assert(Number.isFinite(len) && len > 0, `wrist segment length must be finite+positive (got ${len})`);
  }
});

test('14. IMU unavailable: UNAVAILABLE, no fabricated output', () => {
  const ctrl = createFusionController();
  runFrames(ctrl, 5, {});
  const r = ctrl.processFusionFrame(baseInput({
    stereoElbow: null, stereoWrist: null,
    imuUADir: null, imuFADir: null,
    jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), unreliable('rightWrist')],
    nowMs: 2000,
  }));
  eq(r.diagnostics.uaState, 'UNAVAILABLE', 'uaState');
  eq(r.diagnostics.faState, 'UNAVAILABLE', 'faState');
  assert(r.finalElbow === null, 'finalElbow must be null');
  assert(r.finalWrist === null, 'finalWrist must be null');
});

test('15. Full recovery from UNAVAILABLE: finite coordinates', () => {
  const ctrl = createFusionController({ recoveryConfirmFrames: 2, blendFrames: 2 });
  for (let i = 0; i < 2; i++) {
    ctrl.processFusionFrame(baseInput({
      stereoElbow: null, imuUADir: null, imuFADir: null, calibrationValid: false,
      jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
      nowMs: 1000 + i * 16,
    }));
  }
  let r!: FusionFrameResult;
  for (let i = 0; i < 6; i++) r = ctrl.processFusionFrame(baseInput({ nowMs: 1032 + i * 16 }));
  eq(r.diagnostics.uaState, 'STEREO', 'uaState must reach STEREO');
  assert(r.finalElbow !== null, 'finalElbow must not be null');
  if (r.finalElbow) {
    assert(Number.isFinite(r.finalElbow.x), 'x must be finite');
    assert(Number.isFinite(r.finalElbow.y), 'y must be finite');
    assert(Number.isFinite(r.finalElbow.z), 'z must be finite');
  }
});

test('Simulated shoulder: anchor not updated', () => {
  const ctrl = createFusionController();
  ctrl.processFusionFrame(baseInput({ nowMs: 1000 }));
  const before = ctrl.getEffectiveShoulder(1016);
  ctrl.processFusionFrame(baseInput({
    stereoShoulder: { x: 999, y: 999, z: 999 },
    simulated: { shoulder: true, elbow: false, wrist: false },
    nowMs: 1016,
  }));
  const after = ctrl.getEffectiveShoulder(1016);
  eq(after, before, 'anchor must not update on simulated shoulder failure');
  assert(after?.x !== 999, 'anchor must not reflect the new stereo position');
});

test('getEffectiveShoulder: returns null when expired', () => {
  const ctrl = createFusionController({ shoulderAnchorMaxAgeMs: 100 });
  ctrl.processFusionFrame(baseInput({ nowMs: 1000 }));
  assert(ctrl.getEffectiveShoulder(1050) !== null, 'should be valid at 50ms');
  assert(ctrl.getEffectiveShoulder(1200) === null, 'should be null at 200ms (expired)');
});

test('reset: clears state and anchor', () => {
  const ctrl = createFusionController();
  runFrames(ctrl, 5, {});
  ctrl.processFusionFrame(baseInput({
    stereoElbow: null,
    jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
    nowMs: 2000,
  }));
  ctrl.reset();
  const r = ctrl.processFusionFrame(baseInput({ nowMs: 3000 }));
  eq(r.diagnostics.uaState, 'STEREO', 'uaState after reset');
  eq(r.diagnostics.faState, 'STEREO', 'faState after reset');
});

test('19. Moving live shoulder does not stretch IMU upper arm', () => {
  const ctrl = createFusionController({ blendFrames: 4 });
  runFrames(ctrl, 8, {});
  const movedShoulder = { x: 80, y: 20, z: -10 };
  const r = ctrl.processFusionFrame(baseInput({
    stereoShoulder: movedShoulder,
    stereoElbow: null,
    jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
    nowMs: 2000,
  }));
  assert(r.finalElbow !== null, 'finalElbow must exist');
  if (r.finalElbow) {
    const outputLength = dist3(movedShoulder, r.finalElbow);
    assert(
      Math.abs(outputLength - r.diagnostics.uaReferenceLengthMm) < 1e-6,
      `UA must remain at reference length (got ${outputLength}, expected ${r.diagnostics.uaReferenceLengthMm})`,
    );
  }
});

test('20. IMU correction freezes the latest vision-derived arm lengths', () => {
  const ctrl = createFusionController({ visionLengthEmaAlpha: 1 });
  const cameraElbow = { x: 280, y: 0, z: 0 };
  const cameraWrist = { x: 510, y: 0, z: 0 };
  runFrames(ctrl, 5, {
    stereoElbow: cameraElbow,
    stereoWrist: cameraWrist,
    calibUaLengthMm: 300,
    calibFaLengthMm: 260,
  });
  const r = ctrl.processFusionFrame(baseInput({
    stereoElbow: null,
    stereoWrist: null,
    jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), unreliable('rightWrist')],
    nowMs: 2000,
  }));
  assert(Math.abs(r.diagnostics.uaReferenceLengthMm - 280) < 1e-6, 'UA reference must come from vision');
  assert(Math.abs(r.diagnostics.faReferenceLengthMm - 230) < 1e-6, 'FA reference must come from vision');
  assert(Math.abs(r.diagnostics.uaOutputLengthMm - 280) < 1e-6, 'UA output must keep vision length');
  assert(Math.abs(r.diagnostics.faOutputLengthMm - 230) < 1e-6, 'FA output must keep vision length');
});

test('21. Legacy live frame creation remains backward compatible', () => {
  const landmarks = makeLandmarks();
  const first = createMotionFrame(landmarks, 25, 0, null, false);
  const sameMillisecond = createMotionFrame(landmarks, 25, 1, 25, false);
  assert(first.accepted, 'legacy frame must be accepted');
  assert(sameMillisecond.accepted, 'legacy Date.now path must retain same-ms frame behavior');
  if (first.accepted) {
    eq(first.frame.timestamp, 25, 'legacy relative timestamp');
    eq(first.frame.frameNumber, 0, 'legacy frame number');
  }
});

test('22. Explicit experiment timestamps are preserved exactly', () => {
  const timestamp = 1234.56789;
  const result = createMotionFrame(makeLandmarks(), timestamp, 7, 1000, true);
  assert(result.accepted, 'explicit frame must be accepted');
  if (result.accepted) {
    eq(result.frame.timestamp, timestamp, 'explicit timestamp');
    eq(result.frame.frameNumber, 7, 'explicit frame number');
  }
});

test('23. Invalid and non-monotonic explicit timestamps are rejected', () => {
  const landmarks = makeLandmarks();
  const invalid = createMotionFrame(landmarks, Number.NaN, 0, null, true);
  const negative = createMotionFrame(landmarks, -1, 0, null, true);
  const duplicate = createMotionFrame(landmarks, 100, 1, 100, true);
  const backwards = createMotionFrame(landmarks, 99, 1, 100, true);
  assert(!invalid.accepted && invalid.reason === 'invalid_timestamp', 'NaN must be rejected');
  assert(!negative.accepted && negative.reason === 'invalid_timestamp', 'negative timestamp must be rejected');
  assert(!duplicate.accepted && duplicate.reason === 'non_monotonic_timestamp', 'duplicate explicit timestamp must be rejected');
  assert(!backwards.accepted && backwards.reason === 'non_monotonic_timestamp', 'backwards timestamp must be rejected');
});

test('24. Stereo conversion preserves both shoulders and visibility conventions', () => {
  const emptyPose = Object.fromEntries(
    Object.keys(makeLandmarks()).map(key => [key, null]),
  ) as TriangulatedPose;
  emptyPose.leftShoulder = { x: -210, y: 30, z: 1500 };
  emptyPose.rightShoulder = { x: 210, y: 35, z: 1505 };
  const cameraLandmarks = makeLandmarks({
    leftShoulder: { x: 0.3, y: 0.4, z: 0, visibility: 0.9 },
    rightShoulder: { x: 0.7, y: 0.4, z: 0, visibility: 0.8 },
  });
  const converted = triangulatedPoseToMotionLandmarks(emptyPose, cameraLandmarks);
  eq(converted.leftShoulder.x, -210, 'left shoulder x');
  eq(converted.rightShoulder.x, 210, 'right shoulder x');
  eq(converted.leftShoulder.visibility, 0.9, 'left shoulder visibility');
  eq(converted.rightShoulder.visibility, 0.8, 'right shoulder visibility');
  eq(converted.rightWrist.visibility, 0, 'missing stereo joint visibility');
});

test('25. One experiment cycle associates all four outputs with one clock', () => {
  const cycle: ExperimentCycle = {
    cycleId: 'cycle-0001',
    experimentTimeMs: 2500,
    cameras: {
      cameraA: {
        status: 'available',
        frameRef: 'cam-a-42',
        mediaTimeSeconds: 2.5,
        browserObservedPerformanceNowMs: 9000,
      },
      cameraB: {
        status: 'available',
        frameRef: 'cam-b-observed-41',
        mediaTimeSeconds: 2.492,
        browserObservedPerformanceNowMs: 9000,
      },
      cameraBTimingBasis: 'observed_current_time',
      synchronizationStatus: 'unverified',
      observedDriftMs: 8,
    },
    imuSamples: {
      imu_01: { status: 'available', packetId: 'imu01-100', sequence: 100, sampleAgeMs: 4 },
      imu_02: { status: 'available', packetId: 'imu02-101', sequence: 101, sampleAgeMs: 3 },
    },
    outputs: {
      P1: { status: 'available', recordingId: 'p1', frameNumber: 42 },
      P2: { status: 'available', recordingId: 'p2', frameNumber: 42 },
      P3: { status: 'available', recordingId: 'p3', frameNumber: 42 },
      P4: { status: 'available', recordingId: 'p4', frameNumber: 42 },
    },
    processing: { status: 'complete', missingData: [] },
  };
  eq(cycle.cycleId, 'cycle-0001', 'cycle ID');
  eq(cycle.experimentTimeMs, 2500, 'authoritative cycle timestamp');
  assert(Object.values(cycle.outputs).every(output => output.status === 'available'), 'all outputs must reference the same parent cycle');
  eq(EXPERIMENT_SCHEMA_VERSION, '1.0.0', 'schema version');
});

test('26. Missing pipeline outputs are explicit and contain no fabricated pose', () => {
  const missingOutput: ExperimentCycle['outputs']['P4'] = {
    status: 'missing',
    reason: 'imu_unavailable',
    detail: 'imu_01 packet exceeded freshness threshold',
  };
  assert(missingOutput.status === 'missing', 'missing status');
  assert(!('frameNumber' in missingOutput), 'missing output must not fabricate a frame');
  assert(!('landmarks' in missingOutput), 'missing output must not fabricate coordinates');
});

test('27. Calibration metadata supports snapshots and verified references', () => {
  const metadata: ExperimentCalibrationMetadata = {
    calibrationVersion: 'stereo-v1+als-v1',
    units: {
      cameraTranslation: 'mm',
      reconstructedCoordinates: 'mm',
      angles: 'degrees',
      imuSensorTimestamp: 'microseconds',
    },
    stereo: {
      storage: 'embedded',
      snapshot: testStereoCalibration,
    },
    imuAls: {
      storage: 'external',
      reference: {
        assetId: 'imu-calibration-1',
        uri: 'calibrations/imu-calibration-1.json',
        contentHash: { algorithm: 'sha256', value: 'abc123' },
        mimeType: 'application/json',
      },
    },
  };
  assert(metadata.stereo.storage === 'embedded', 'stereo snapshot must be embedded');
  assert(metadata.imuAls.storage === 'external', 'IMU calibration must be externally referenced');
  if (metadata.imuAls.storage === 'external') {
    assert(metadata.imuAls.reference.uri.length > 0, 'external calibration must be resolvable');
    assert(metadata.imuAls.reference.contentHash.value.length > 0, 'external calibration must be verifiable');
  }

  const inverseMetadata: ExperimentCalibrationMetadata = {
    ...metadata,
    stereo: {
      storage: 'external',
      reference: {
        assetId: 'stereo-calibration-1',
        uri: 'calibrations/stereo-calibration-1.json',
        contentHash: { algorithm: 'sha256', value: 'def456' },
      },
    },
    imuAls: {
      storage: 'embedded',
      snapshot: testImuCalibration,
    },
  };
  assert(inverseMetadata.imuAls.storage === 'embedded', 'IMU ALS snapshot must be embeddable');
});

test('28. Explicit MotionRecording remains analyzer-compatible with unchanged normalization', () => {
  const frames = [0, 1000, 2000].map((timestamp, index) => {
    const result = createMotionFrame(
      makeLandmarks({ rightWrist: { x: index * 2, y: 0, z: 0, visibility: 1 } }),
      timestamp,
      index,
      index === 0 ? null : (index - 1) * 1000,
      true,
    );
    if (!result.accepted) throw new Error(`frame ${index} unexpectedly rejected`);
    return result.frame;
  });
  const recording: MotionRecording = {
    id: 'explicit-test',
    name: 'Explicit timestamp compatibility',
    startTime: 0,
    duration: 2000,
    frames,
    frameRate: 1.5,
    metadata: {},
  };
  const metrics = calculateJitterMetrics(recording, 'rightWrist');
  assert(Math.abs((metrics.shoulderWidthRef ?? 0) - 2) < 1e-9, 'shoulder width normalization must remain 2');
  assert(Math.abs(metrics.relativeVelocity - 1) < 1e-9, 'normalized wrist velocity must remain 1 body-width/s');
  assert(Math.abs(metrics.velocityVariance) < 1e-9, 'constant normalized velocity variance must remain zero');
});

test('29. Explicit FPS uses frame intervals while legacy FPS is unchanged', () => {
  const explicitFps = calculateRecordingFrameRate('explicit-experiment', 4, 1500);
  const legacyFps = calculateRecordingFrameRate('wall-clock-relative', 4, 1500);
  assert(Math.abs(explicitFps - 2) < 1e-9, 'explicit FPS must be (4-1)/1.5 = 2');
  assert(Math.abs(legacyFps - (4 / 1.5)) < 1e-9, 'legacy FPS must remain 4/1.5');
  eq(calculateRecordingFrameRate('explicit-experiment', 1, 0), 0, 'single-frame explicit FPS');
});

test('30. Recording lifecycle refs accept immediately after start and reject after stop', () => {
  const emptyRecorder = createRecorderHarness();
  emptyRecorder.startRecording();
  const emptyCompleted = emptyRecorder.stopRecording();
  assert(emptyCompleted !== null, 'stop immediately after start must finalize without a render');
  eq(emptyCompleted?.frames.length, 0, 'immediate empty recording');

  const recorder = createRecorderHarness();
  recorder.startRecording();
  recorder.recordFrame(makeLandmarks());
  const completed = recorder.stopRecording();
  assert(completed !== null, 'stop must finalize without waiting for a React render');
  eq(completed?.frames.length, 1, 'frame immediately after start');

  const afterStop = recorder.recordFrameAtTime(makeLandmarks(), 10);
  assert(!afterStop.accepted && afterStop.reason === 'not_recording', 'frame after stop must be rejected');
  eq(recorder.stopRecording(), null, 'second stop must not finalize twice');
});

test('31. Explicit recordings identify their ExperimentSession clock', () => {
  const invalidRecorder = createRecorderHarness();
  invalidRecorder.startRecording({ clockMode: 'explicit-experiment' });
  const unassociated = invalidRecorder.recordFrameAtTime(makeLandmarks(), 0);
  assert(!unassociated.accepted && unassociated.reason === 'not_recording', 'unassociated experiment must not start');

  const recorder = createRecorderHarness();
  recorder.startRecording({
    clockMode: 'explicit-experiment',
    experimentSessionId: 'session-stage1-test',
  });
  const first = recorder.recordFrameAtTime(makeLandmarks(), 5000);
  const second = recorder.recordFrameAtTime(makeLandmarks(), 5500);
  assert(first.accepted && second.accepted, 'associated experiment frames must be accepted');
  const completed = recorder.stopRecording();
  assert(completed !== null, 'associated experiment must finalize');
  eq(completed?.metadata.clockMode, 'explicit-experiment', 'recording clock mode');
  eq(completed?.metadata.experimentSessionId, 'session-stage1-test', 'experiment session association');
  eq(completed?.metadata.experimentClockReference, 'ExperimentSession.clock', 'clock metadata reference');
  eq(completed?.duration, 500, 'explicit elapsed duration');
  assert(Math.abs((completed?.frameRate ?? 0) - 2) < 1e-9, 'two frames over one interval of 0.5s must be 2 FPS');
});

test('32. Both camera sidecars use one monotonic experiment origin', () => {
  const origin = 10_000;
  const recordingId = 'stereo-shared-clock';
  const observationA = createCameraTimingObservation({
    recordingId,
    cameraRole: 'camera_a',
    sequence: 0,
    experimentStartPerformanceNowMs: origin,
    browserObservedPerformanceNowMs: 10_020,
    mediaTimeSeconds: 4.25,
    observationMethod: 'request_video_frame_callback',
    mediaTimestampSource: 'rvfc_media_time',
    presentedFrames: 1,
  });
  const observationB = createCameraTimingObservation({
    recordingId,
    cameraRole: 'camera_b',
    sequence: 0,
    experimentStartPerformanceNowMs: origin,
    browserObservedPerformanceNowMs: 10_023,
    mediaTimeSeconds: 4.247,
    observationMethod: 'request_video_frame_callback',
    mediaTimestampSource: 'rvfc_media_time',
    presentedFrames: 1,
  });
  eq(observationA.experimentTimeMs, 20, 'camera A experiment time');
  eq(observationB.experimentTimeMs, 23, 'camera B experiment time');
  const clock = createExperimentClockMetadata(origin);
  eq(clock.liveCaptureOrigin?.originPerformanceNowMs, origin, 'shared clock origin');
});

test('33. Camera media timestamps are preserved exactly', () => {
  const mediaTime = 12.3456789;
  const observation = createCameraTimingObservation({
    recordingId: 'stereo-media-time',
    cameraRole: 'camera_a',
    sequence: 4,
    experimentStartPerformanceNowMs: 100,
    browserObservedPerformanceNowMs: 150,
    mediaTimeSeconds: mediaTime,
    observationMethod: 'request_video_frame_callback',
    mediaTimestampSource: 'rvfc_media_time',
    presentedFrames: 9,
    presentationTimePerformanceNowMs: 149.5,
    expectedDisplayTimePerformanceNowMs: 151,
  });
  eq(observation.mediaTimeSeconds, mediaTime, 'camera media timestamp');
  eq(observation.presentation?.presentedFrames, 9, 'presented frame metadata');
  eq(observation.presentation?.presentationTimePerformanceNowMs, 149.5, 'presentation time');
});

test('34. Camera B timing observations remain independent from Camera A', () => {
  const origin = 1000;
  const recordingId = 'stereo-independent';
  const observationA = createCameraTimingObservation({
    recordingId,
    cameraRole: 'camera_a',
    sequence: 0,
    experimentStartPerformanceNowMs: origin,
    browserObservedPerformanceNowMs: 1030,
    mediaTimeSeconds: 1,
    observationMethod: 'request_video_frame_callback',
    mediaTimestampSource: 'rvfc_media_time',
    presentedFrames: 10,
  });
  const observationB = createCameraTimingObservation({
    recordingId,
    cameraRole: 'camera_b',
    sequence: 0,
    experimentStartPerformanceNowMs: origin,
    browserObservedPerformanceNowMs: 1041,
    mediaTimeSeconds: 0.984,
    observationMethod: 'request_video_frame_callback',
    mediaTimestampSource: 'rvfc_media_time',
    presentedFrames: 7,
  });
  const sidecarA = makeCameraTimingSidecar(recordingId, 'camera_a', origin, [observationA]);
  const sidecarB = makeCameraTimingSidecar(recordingId, 'camera_b', origin, [observationB]);
  eq(sidecarA.observations[0].mediaTimeSeconds, 1, 'camera A independent media time');
  eq(sidecarB.observations[0].mediaTimeSeconds, 0.984, 'camera B independent media time');
  assert(sidecarA.observations[0].frameRef !== sidecarB.observations[0].frameRef, 'camera frame references must differ');
});

test('35. Presented-frame gaps and skipped frames are detectable', () => {
  const origin = 1000;
  const recordingId = 'stereo-gaps';
  const first = createCameraTimingObservation({
    recordingId,
    cameraRole: 'camera_a',
    sequence: 0,
    experimentStartPerformanceNowMs: origin,
    browserObservedPerformanceNowMs: 1010,
    mediaTimeSeconds: 0,
    observationMethod: 'request_video_frame_callback',
    mediaTimestampSource: 'rvfc_media_time',
    presentedFrames: 20,
  });
  const afterGap = createCameraTimingObservation({
    recordingId,
    cameraRole: 'camera_a',
    sequence: 1,
    experimentStartPerformanceNowMs: origin,
    browserObservedPerformanceNowMs: 1110,
    mediaTimeSeconds: 0.1,
    observationMethod: 'request_video_frame_callback',
    mediaTimestampSource: 'rvfc_media_time',
    presentedFrames: 23,
    previousPresentedFrames: 20,
    previousMediaTimeSeconds: 0,
  });
  eq(afterGap.skippedFramesSincePrevious, 2, 'skipped frame count');
  const summary = summarizeCameraTiming([first, afterGap]);
  eq(summary.frameGapCount, 1, 'frame gap count');
  eq(summary.skippedFrameCount, 2, 'summary skipped frame count');
});

test('36. Missing camera timing metadata is explicit', () => {
  const sidecar = createUnavailableCameraTimingSidecar(
    'stereo-missing',
    'camera_b',
    'camera-b-device',
    500,
    'requestVideoFrameCallback unavailable and no video element was attached',
  );
  eq(sidecar.metadataAvailability, 'unavailable', 'metadata availability');
  eq(sidecar.synchronizationStatus, 'unknown', 'missing synchronization status');
  eq(sidecar.observations.length, 0, 'missing metadata must not invent observations');
  assert(!!sidecar.limitation, 'missing metadata limitation must be documented');
});

test('37. Stereo video recording preserves existing video blobs and duration', () => {
  const origin = 2000;
  const recordingId = 'stereo-existing-behavior';
  const observationA = createCameraTimingObservation({
    recordingId,
    cameraRole: 'camera_a',
    sequence: 0,
    experimentStartPerformanceNowMs: origin,
    browserObservedPerformanceNowMs: 2010,
    mediaTimeSeconds: 0,
    observationMethod: 'request_video_frame_callback',
    mediaTimestampSource: 'rvfc_media_time',
  });
  const observationB = createCameraTimingObservation({
    recordingId,
    cameraRole: 'camera_b',
    sequence: 0,
    experimentStartPerformanceNowMs: origin,
    browserObservedPerformanceNowMs: 2011,
    mediaTimeSeconds: 0,
    observationMethod: 'request_video_frame_callback',
    mediaTimestampSource: 'rvfc_media_time',
  });
  const cam1Blob = new Blob(['camera-a'], { type: 'video/webm' });
  const cam2Blob = new Blob(['camera-b'], { type: 'video/webm' });
  const recording = createStereoVideoRecording({
    recordingId,
    name: 'Stereo test',
    startTime: 1_700_000_000_000,
    duration: 2500,
    cam1Blob,
    cam2Blob,
    mimeType: 'video/webm',
    clockMetadata: createExperimentClockMetadata(origin),
    cameraATiming: makeCameraTimingSidecar(recordingId, 'camera_a', origin, [observationA]),
    cameraBTiming: makeCameraTimingSidecar(recordingId, 'camera_b', origin, [observationB]),
  });
  eq(recording.cam1Blob, cam1Blob, 'camera A video blob');
  eq(recording.cam2Blob, cam2Blob, 'camera B video blob');
  eq(recording.duration, 2500, 'monotonic recording duration');
  eq(recording.mimeType, 'video/webm', 'video MIME type');
});

test('38. Timing exports are associated with the correct stereo recording', () => {
  const origin = 3000;
  const recordingId = 'stereo-associated';
  const sidecarA = makeCameraTimingSidecar(recordingId, 'camera_a', origin, []);
  const sidecarB = makeCameraTimingSidecar(recordingId, 'camera_b', origin, []);
  const diagnostics = buildSynchronizationDiagnostics(recordingId, sidecarA, sidecarB);
  eq(sidecarA.recordingId, recordingId, 'camera A recording association');
  eq(sidecarB.recordingId, recordingId, 'camera B recording association');
  eq(sidecarA.videoAssetId, `${recordingId}:camera_a:video`, 'camera A video association');
  eq(sidecarB.videoAssetId, `${recordingId}:camera_b:video`, 'camera B video association');
  eq(diagnostics.recordingId, recordingId, 'diagnostics recording association');
  eq(diagnostics.hardwareExposureSynchronizationVerified, false, 'hardware sync must remain unverified');
});

// ── Runner ────────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`  PASS  ${t.name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${t.name}`);
    console.log(`        ${(e as Error).message}`);
    failed++;
  }
}
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
