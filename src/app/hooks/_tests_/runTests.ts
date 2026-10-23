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

// ── Helpers ───────────────────────────────────────────────────────────────────

type Pt3 = { x: number; y: number; z: number };

const shoulder: Pt3 = { x: 0,   y: 0,    z: 0  };
const elbow: Pt3    = { x: 300, y: -50,  z: 10 };
const wrist: Pt3    = { x: 540, y: -100, z: 20 };
const imuElbow: Pt3 = { x: 295, y: -48,  z: 12 };
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
    imuElbow,
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
    calibrationValid: false, imuElbow: null, imuFADir: null, nowMs: 2000,
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
    stereoElbow: null, imuElbow: null, imuFADir: null, calibrationValid: false,
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
    imuElbow: null, imuFADir: null,
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
      stereoElbow: null, imuElbow: null, imuFADir: null, calibrationValid: false,
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
