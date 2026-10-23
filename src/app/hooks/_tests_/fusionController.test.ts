/**
 * Deterministic tests for the fusion controller state machine.
 *
 * Uses createFusionController() — a pure factory with no React dependency —
 * so tests run in a plain Node environment without DOM or React tree.
 *
 * These tests verify state machine logic, recovery hysteresis, source priority,
 * and geometric constraints using synthetic coordinates. They do NOT prove
 * real-world tracking accuracy, which requires live camera + IMU validation.
 */

import { describe, it, expect } from 'vitest';
import {
  createFusionController,
  type FusionFrameInput,
  type FusionFrameResult,
  DEFAULT_FUSION_CONFIG,
} from '../useIMUFusionController';
import type { JointFailureStatus } from '../usePoseFailureCorrection';

// ── Test fixtures ─────────────────────────────────────────────────────────────

type Pt3 = { x: number; y: number; z: number };

const shoulder: Pt3 = { x: 0,   y: 0,    z: 0  };
const elbow: Pt3    = { x: 300, y: -50,  z: 10 };
const wrist: Pt3    = { x: 540, y: -100, z: 20 };

// IMU-derived elbow — distinct from stereo to catch source confusion
const imuElbow: Pt3 = { x: 295, y: -48, z: 12 };
// Normalized forearm direction (unit vector)
const imuFADir: [number, number, number] = [0.942, -0.196, 0.274];
const calibFaLengthMm = 260;

function reliable(joint: string): JointFailureStatus {
  return { joint: joint as JointFailureStatus['joint'], failureType: 'none', reliable: true, correctionMethod: 'none', requiresIMU: false };
}

function unreliable(joint: string, failureType: JointFailureStatus['failureType'] = 'occlusion'): JointFailureStatus {
  return { joint: joint as JointFailureStatus['joint'], failureType, reliable: false, correctionMethod: 'none', requiresIMU: false };
}

function allReliable(): JointFailureStatus[] {
  return [reliable('rightShoulder'), reliable('rightElbow'), reliable('rightWrist')];
}

function baseInput(overrides: Partial<FusionFrameInput> = {}): FusionFrameInput {
  return {
    stereoShoulder: shoulder,
    stereoElbow:    elbow,
    stereoWrist:    wrist,
    imuElbow,
    imuFADir,
    jointStatuses:    allReliable(),
    calibrationValid: true,
    calibUaLengthMm:  300,
    calibFaLengthMm,
    imu01AgeMs: 20,
    imu02AgeMs: 20,
    simulated: { shoulder: false, elbow: false, wrist: false },
    nowMs: 1000,
    ...overrides,
  };
}

function runFrames(
  ctrl: ReturnType<typeof createFusionController>,
  n: number,
  inputOverrides: Partial<FusionFrameInput>,
  startNow = 1000,
): FusionFrameResult {
  let result!: FusionFrameResult;
  for (let i = 0; i < n; i++) {
    result = ctrl.processFusionFrame(baseInput({ ...inputOverrides, nowMs: startNow + i * 16 }));
  }
  return result;
}

function dist3(a: Pt3, b: Pt3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Fusion controller state machine', () => {

  it('1. All joints reliable: output equals stereo (Pipeline 3 equivalent)', () => {
    const ctrl = createFusionController();
    const result = runFrames(ctrl, 10, {});

    expect(result.diagnostics.uaState).toBe('STEREO');
    expect(result.diagnostics.faState).toBe('STEREO');
    expect(result.finalElbow).toEqual(elbow);
    expect(result.finalWrist).toEqual(wrist);
    expect(result.finalShoulder).toEqual(shoulder);
  });

  it('2. Wrist occluded: forearm IMU correction activates, upper arm stays stereo', () => {
    const ctrl = createFusionController();
    runFrames(ctrl, 5, {});

    const result = ctrl.processFusionFrame(baseInput({
      stereoWrist: null,
      jointStatuses: [reliable('rightShoulder'), reliable('rightElbow'), unreliable('rightWrist')],
      nowMs: 2000,
    }));

    expect(result.diagnostics.uaState).toBe('STEREO');
    expect(result.diagnostics.faState).toBe('IMU_CORRECTION');
    expect(result.finalElbow).toEqual(elbow);
    expect(result.finalWrist).not.toBeNull();
  });

  it('3. Elbow occluded: upper-arm IMU correction activates', () => {
    const ctrl = createFusionController();
    runFrames(ctrl, 5, {});

    const result = ctrl.processFusionFrame(baseInput({
      stereoElbow: null,
      jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
      nowMs: 2000,
    }));

    expect(result.diagnostics.uaState).toBe('IMU_CORRECTION');
    expect(result.finalElbow).not.toBeNull();
  });

  it('4. Elbow and wrist occluded: both segments use IMU reconstruction', () => {
    const ctrl = createFusionController();
    runFrames(ctrl, 5, {});

    const result = ctrl.processFusionFrame(baseInput({
      stereoElbow: null,
      stereoWrist: null,
      jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), unreliable('rightWrist')],
      nowMs: 2000,
    }));

    expect(result.diagnostics.uaState).toBe('IMU_CORRECTION');
    expect(result.diagnostics.faState).toBe('IMU_CORRECTION');
    expect(result.finalElbow).not.toBeNull();
    expect(result.finalWrist).not.toBeNull();
  });

  it('5. Shoulder anchor expires after shoulderAnchorMaxAgeMs', () => {
    const ctrl = createFusionController({ shoulderAnchorMaxAgeMs: 200 });
    ctrl.processFusionFrame(baseInput({ nowMs: 1000 }));

    const expired = ctrl.processFusionFrame(baseInput({
      stereoShoulder: null,
      jointStatuses: [unreliable('rightShoulder'), reliable('rightElbow'), reliable('rightWrist')],
      nowMs: 1210,  // 210ms past anchor capture — beyond 200ms limit
    }));

    expect(expired.diagnostics.shoulderAnchorState).toBe('expired');
    expect(expired.effectiveShoulder).toBeNull();
  });

  it('6. IMU_01 stale: upper-arm IMU correction unavailable → UNAVAILABLE', () => {
    const ctrl = createFusionController();
    runFrames(ctrl, 5, {});

    const result = ctrl.processFusionFrame(baseInput({
      stereoElbow: null,
      jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
      imu01AgeMs: 9999,
      nowMs: 2000,
    }));

    expect(result.diagnostics.uaState).toBe('UNAVAILABLE');
    expect(result.finalElbow).toBeNull();
  });

  it('7. IMU_02 stale: forearm IMU correction unavailable → UNAVAILABLE', () => {
    const ctrl = createFusionController();
    runFrames(ctrl, 5, {});

    const result = ctrl.processFusionFrame(baseInput({
      stereoWrist: null,
      jointStatuses: [reliable('rightShoulder'), reliable('rightElbow'), unreliable('rightWrist')],
      imu02AgeMs: 9999,
      nowMs: 2000,
    }));

    expect(result.diagnostics.faState).toBe('UNAVAILABLE');
    expect(result.finalWrist).toBeNull();
  });

  it('8. Calibration invalid: IMU correction blocked — UNAVAILABLE when stereo fails', () => {
    const ctrl = createFusionController();
    runFrames(ctrl, 5, {});

    const result = ctrl.processFusionFrame(baseInput({
      stereoElbow: null,
      stereoWrist: null,
      jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), unreliable('rightWrist')],
      calibrationValid: false,
      imuElbow: null,
      imuFADir: null,
      nowMs: 2000,
    }));

    expect(result.diagnostics.imuCalibrationValid).toBe(false);
    expect(result.diagnostics.uaState).toBe('UNAVAILABLE');
    expect(result.diagnostics.faState).toBe('UNAVAILABLE');
    expect(result.finalElbow).toBeNull();
    expect(result.finalWrist).toBeNull();
  });

  it('9. One-frame stereo recovery: still in confirming phase, output unchanged', () => {
    const ctrl = createFusionController({ recoveryConfirmFrames: 5, blendFrames: 4 });
    runFrames(ctrl, 5, {});

    // Enter IMU_CORRECTION
    ctrl.processFusionFrame(baseInput({
      stereoElbow: null,
      jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
      nowMs: 2000,
    }));

    // One frame of stereo recovery
    const oneFrame = ctrl.processFusionFrame(baseInput({ nowMs: 2016 }));
    expect(oneFrame.diagnostics.uaState).toBe('RECOVERY');
    expect(oneFrame.diagnostics.uaRecoveryPhase).toBe('confirming');
    expect(oneFrame.diagnostics.uaRecoveryFrame).toBe(1);
    // Output must still be non-null (holding IMU position)
    expect(oneFrame.finalElbow).not.toBeNull();
  });

  it('10. Sustained stereo recovery: confirm then blend, then STEREO', () => {
    const ctrl = createFusionController({ recoveryConfirmFrames: 3, blendFrames: 4 });
    runFrames(ctrl, 5, {});

    // Enter IMU_CORRECTION
    ctrl.processFusionFrame(baseInput({
      stereoElbow: null,
      jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
      nowMs: 2000,
    }));

    // Run 3 confirmation frames
    let result!: FusionFrameResult;
    for (let i = 0; i < 3; i++) {
      result = ctrl.processFusionFrame(baseInput({ nowMs: 2016 + i * 16 }));
    }
    // 3rd frame should transition to blending
    expect(result.diagnostics.uaState).toBe('RECOVERY');
    expect(result.diagnostics.uaRecoveryPhase).toBe('blending');

    // Run 4 blend frames
    for (let i = 0; i < 4; i++) {
      result = ctrl.processFusionFrame(baseInput({ nowMs: 2064 + i * 16 }));
    }
    expect(result.diagnostics.uaState).toBe('STEREO');
    expect(result.finalElbow).toEqual(elbow);
  });

  it('11. Intermittent stereo during recovery: counter resets, no spurious STEREO', () => {
    const ctrl = createFusionController({ recoveryConfirmFrames: 5, blendFrames: 4 });
    runFrames(ctrl, 5, {});

    const occluded = {
      stereoElbow: null as Pt3 | null,
      jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
    };

    // Enter IMU_CORRECTION
    ctrl.processFusionFrame(baseInput({ ...occluded, nowMs: 2000 }));

    // 3 partial recovery frames
    for (let i = 0; i < 3; i++) ctrl.processFusionFrame(baseInput({ nowMs: 2016 + i * 16 }));

    // Stereo drops again
    const interrupted = ctrl.processFusionFrame(baseInput({ ...occluded, nowMs: 2064 }));
    expect(interrupted.diagnostics.uaState).toBe('IMU_CORRECTION');
    expect(interrupted.diagnostics.uaRecoveryFrame).toBe(0);
  });

  it('12. Both sources return from UNAVAILABLE: stereo recovery takes priority', () => {
    const ctrl = createFusionController();

    // Drive to UNAVAILABLE: stereo fails, no IMU
    ctrl.processFusionFrame(baseInput({
      stereoElbow: null,
      imuElbow: null,
      imuFADir: null,
      calibrationValid: false,
      jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
      nowMs: 1000,
    }));

    // Both stereo and IMU available simultaneously
    const result = ctrl.processFusionFrame(baseInput({ nowMs: 1016 }));
    // Must enter RECOVERY (stereo-first) not IMU_CORRECTION
    expect(result.diagnostics.uaState).toBe('RECOVERY');
    expect(result.diagnostics.uaRecoveryPhase).toBe('confirming');
  });

  it('13. Wrist correction with stereo elbow: fused wrist anchors to stereo elbow', () => {
    const ctrl = createFusionController();
    runFrames(ctrl, 5, {});

    // Wrist occludes while elbow stays stereo-reliable
    const result = ctrl.processFusionFrame(baseInput({
      stereoWrist: null,
      jointStatuses: [reliable('rightShoulder'), reliable('rightElbow'), unreliable('rightWrist')],
      nowMs: 2000,
    }));

    expect(result.diagnostics.uaState).toBe('STEREO');
    expect(result.diagnostics.faState).toBe('IMU_CORRECTION');
    expect(result.finalElbow).toEqual(elbow);
    // Wrist must be finite and attached to elbow
    expect(result.finalWrist).not.toBeNull();
    if (result.finalWrist && result.finalElbow) {
      const len = dist3(result.finalElbow, result.finalWrist);
      expect(Number.isFinite(len)).toBe(true);
      expect(len).toBeGreaterThan(0);
    }
  });

  it('14. IMU unavailable: UNAVAILABLE state, no fabricated coordinates', () => {
    const ctrl = createFusionController();
    runFrames(ctrl, 5, {});

    const result = ctrl.processFusionFrame(baseInput({
      stereoElbow: null,
      stereoWrist: null,
      imuElbow: null,
      imuFADir: null,
      jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), unreliable('rightWrist')],
      nowMs: 2000,
    }));

    expect(result.diagnostics.uaState).toBe('UNAVAILABLE');
    expect(result.diagnostics.faState).toBe('UNAVAILABLE');
    expect(result.finalElbow).toBeNull();
    expect(result.finalWrist).toBeNull();
  });

  it('15. Full recovery from UNAVAILABLE: finite coordinates after restoration', () => {
    const ctrl = createFusionController({ recoveryConfirmFrames: 2, blendFrames: 2 });

    // Drive to UNAVAILABLE
    for (let i = 0; i < 2; i++) {
      ctrl.processFusionFrame(baseInput({
        stereoElbow: null,
        imuElbow: null,
        imuFADir: null,
        calibrationValid: false,
        jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
        nowMs: 1000 + i * 16,
      }));
    }

    // Restore both sources
    let result!: FusionFrameResult;
    for (let i = 0; i < 6; i++) {
      result = ctrl.processFusionFrame(baseInput({ nowMs: 1032 + i * 16 }));
    }

    expect(result.diagnostics.uaState).toBe('STEREO');
    expect(result.finalElbow).not.toBeNull();
    if (result.finalElbow) {
      expect(Number.isFinite(result.finalElbow.x)).toBe(true);
      expect(Number.isFinite(result.finalElbow.y)).toBe(true);
      expect(Number.isFinite(result.finalElbow.z)).toBe(true);
    }
  });

  it('Simulated shoulder: anchor not updated from stereo', () => {
    const ctrl = createFusionController();
    ctrl.processFusionFrame(baseInput({ nowMs: 1000 }));
    const anchorBefore = ctrl.getEffectiveShoulder(1016);

    // Simulate shoulder with a new stereo position — anchor must not update
    ctrl.processFusionFrame(baseInput({
      stereoShoulder: { x: 999, y: 999, z: 999 },
      simulated: { shoulder: true, elbow: false, wrist: false },
      nowMs: 1016,
    }));

    const anchorAfter = ctrl.getEffectiveShoulder(1016);
    expect(anchorAfter).toEqual(anchorBefore);
    expect(anchorAfter?.x).not.toBe(999);
  });

  it('getEffectiveShoulder: null when expired', () => {
    const ctrl = createFusionController({ shoulderAnchorMaxAgeMs: 100 });
    ctrl.processFusionFrame(baseInput({ nowMs: 1000 }));

    expect(ctrl.getEffectiveShoulder(1050)).not.toBeNull();
    expect(ctrl.getEffectiveShoulder(1200)).toBeNull();
  });

  it('reset: clears state and shoulder anchor', () => {
    const ctrl = createFusionController();
    runFrames(ctrl, 5, {});
    ctrl.processFusionFrame(baseInput({
      stereoElbow: null,
      jointStatuses: [reliable('rightShoulder'), unreliable('rightElbow'), reliable('rightWrist')],
      nowMs: 2000,
    }));

    ctrl.reset();

    const result = ctrl.processFusionFrame(baseInput({ nowMs: 3000 }));
    expect(result.diagnostics.uaState).toBe('STEREO');
    expect(result.diagnostics.faState).toBe('STEREO');
  });

});
