import { LANDMARK_KEYS } from '../hooks/useTriangulation';
import type { ComparisonCycleInput, ComparisonFrame, ComparisonPose, ComparisonSession, PipelineId, PipelineOutput } from '../type/pipelineComparison';
import type { TriangulatedPose } from '../hooks/useTriangulation';
import type { JointFailureStatus } from '../hooks/usePoseFailureCorrection';
import type { ComparisonFusionSnapshot } from '../type/pipelineComparison';
import { STEREO_GEOMETRY_DESCRIPTION } from './stereoGeometry';

/** Orchestration only: reconstruction and fusion are supplied by the working lab. */
export function processComparisonCycle(
  input: Pick<ComparisonCycleInput, 'cycleId' | 'timing' | 'cameraA' | 'cameraB' | 'calibrationAvailable'>,
  processors: {
    triangulate: () => TriangulatedPose;
    correct: (pose: TriangulatedPose) => {correctedPose: TriangulatedPose; jointStatuses: JointFailureStatus[]};
    advanceLiveFusion: (pose: TriangulatedPose, tracked: number, statuses: JointFailureStatus[]) => void;
    readFusion: () => ComparisonFusionSnapshot;
    now: () => number;
    readGeometry?: () => ComparisonCycleInput['geometry'];
  },
): ComparisonFrame {
  let p2 = emptyComparisonPose() as TriangulatedPose;
  let p3 = emptyComparisonPose() as TriangulatedPose;
  let correction: JointFailureStatus[] = [];
  let fusion: ComparisonFusionSnapshot = {pose: null, diagnostics: null, imuSamples: null};
  const errors = [...input.timing.inferenceErrors];
  try {
    if (input.cameraA && input.cameraB && input.calibrationAvailable) p2 = processors.triangulate();
  } catch (err) { errors.push('triangulation: ' + String(err)); }
  try {
    // Missing observations advance state rather than reusing an earlier skeleton.
    const result = processors.correct(p2); p3 = comparisonSnapshot(result.correctedPose); correction = result.jointStatuses;
    // Give the parent a separate baseline so right-arm substitutions cannot
    // mutate the P3 snapshot, even if a future integration mutates its input.
    processors.advanceLiveFusion(comparisonSnapshot(p3), LANDMARK_KEYS.filter(k => p3[k] !== null).length, comparisonSnapshot(correction));
    fusion = processors.readFusion();
  } catch (err) { errors.push('correction_or_fusion: ' + String(err)); }
  return buildComparisonFrame({...input, p2, p3, correction, fusion, errors, geometry: processors.readGeometry?.() ?? null, processingCompletedPerformanceNowMs: processors.now()});
}

export const PIPELINES: PipelineId[] = ['P1', 'P2', 'P3', 'P4'];
export const COMPARISON_LIMITATIONS = [
  'Camera A drives processing; Camera B is sampled sequentially. Browser observations are not exposure timestamps; hardware synchronization is unverified.',
  'Camera media-time origins and ESP32 clocks are independent. No hardware clock alignment is assumed.',
  'Geometry: '+STEREO_GEOMETRY_DESCRIPTION.method+'. Per-camera undistortion and normalized [I|0]/[R|T] triangulation; original Camera A frame. Unknown crops/orientation and calibration quality remain limitations.',
  'P1 is image-normalized XY with inferred relative Z, not metric world coordinates. P2/P3/P4 inherit calibration millimeters.',
  'Every eligible processing callback is retained, including failed poses. Camera frames not scheduled by the browser are not reconstructed.',
  'Start recording preserves existing correction, calibration, fusion and MediaPipe state. State at start is observational, not a complete restorable controller checkpoint.',
  'This JSON retains processed P1?P4 poses, shared cycle timing and fusion diagnostics. Primary live analysis omits selected IMU samples; historical recordings may contain them. It is separate from optional video/ZIP recording.',
  'No absolute accuracy or hardware synchronization is established. Measurements are not ground truth.',
];

/** Serializable snapshots detach archived data from mutable runtime refs. */
export function comparisonSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : typeof v === 'number' && !Number.isFinite(v) ? null : v));
}
export function emptyComparisonPose(): ComparisonPose {
  return Object.fromEntries(LANDMARK_KEYS.map(k => [k, null])) as ComparisonPose;
}
export function comparisonOutput(pose: ComparisonPose | null, reason: (key: keyof ComparisonPose) => string): PipelineOutput {
  const points = emptyComparisonPose();
  const joints = {} as PipelineOutput['joints'];
  let availableJoints = 0;
  for (const key of LANDMARK_KEYS) {
    const p = pose?.[key];
    const finite = !!p && [p.x, p.y, p.z].every(Number.isFinite);
    points[key] = finite ? { ...p } : null;
    const valid = finite && (p!.visibility ?? 1) >= 0.5;
    joints[key] = { valid, reason: valid ? null : p && !finite ? 'non_finite_coordinates' : p && (p.visibility ?? 1) < 0.5 ? 'low_visibility' : reason(key) };
    if (valid) availableJoints++;
  }
  return { pose: points, joints, availableJoints, status: availableJoints === 0 ? 'unavailable' : availableJoints === LANDMARK_KEYS.length ? 'available' : 'partial' };
}

export function buildComparisonFrame(input: ComparisonCycleInput): ComparisonFrame {
  const visualReason = (key: keyof ComparisonPose) => {
    if (!input.cameraA) return 'missing_camera_a_pose';
    if (!input.cameraB) return 'missing_camera_b_pose';
    if (!input.calibrationAvailable) return 'stereo_calibration_unavailable';
    if (input.geometry?.calibrationError) return 'incompatible_calibration_or_capture_geometry';
    if (!input.cameraA[key] || !input.cameraB[key]) return 'missing_camera_landmark';
    if ((input.cameraA[key].visibility ?? 1) < 0.5 || (input.cameraB[key].visibility ?? 1) < 0.5) return 'low_visibility';
    return input.geometry?.joints[key]?.reason ?? 'triangulation_unavailable';
  };
  const p2 = comparisonOutput(input.p2, visualReason);
  const p3 = comparisonOutput(input.p3, k => p2.joints[k].reason ?? 'corrected_pose_unavailable');
  const p4 = comparisonOutput(input.fusion.pose, k => {
    if (['rightShoulder', 'rightElbow', 'rightWrist'].includes(k)) return 'fusion_unavailable';
    return p3.joints[k].reason ?? 'fused_pose_unavailable';
  });
  return comparisonSnapshot({
    cycleId: input.cycleId, experimentTimeMs: null, phase: 'preview', timing: input.timing,
    processingCompletedPerformanceNowMs: input.processingCompletedPerformanceNowMs,
    processingDurationMs: Math.max(0, input.processingCompletedPerformanceNowMs - input.timing.processingStartedPerformanceNowMs),
    cameras: {cameraA: {valid: !!input.cameraA, landmarks: input.cameraA}, cameraB: {valid: !!input.cameraB, landmarks: input.cameraB}},
    pipelines: {P1: comparisonOutput(input.cameraA, () => 'missing_camera_a_pose'), P2: p2, P3: p3, P4: p4},
    correction: input.correction, fusion: input.fusion.diagnostics,
    imuCorrectionActive: [input.fusion.diagnostics?.uaState, input.fusion.diagnostics?.faState]
      .some(state => state === 'IMU_CORRECTION' || state === 'RECOVERY'),
    imuSamples: input.fusion.imuSamples, errors: input.errors, geometry: input.geometry ?? null,
  } as ComparisonFrame);
}

export function summarizeComparison(frames: ComparisonFrame[]) {
  const first = frames[0], last = frames.at(-1);
  const span = first && last ? last.timing.processingStartedPerformanceNowMs - first.timing.processingStartedPerformanceNowMs : 0;
  const events = { upperArmIMUEntries: 0, forearmIMUEntries: 0, upperArmRecoveryEntries: 0, forearmRecoveryEntries: 0 };
  frames.forEach((f, i) => {
    const prev = frames[i - 1]?.fusion;
    // First recorded state is baseline, not evidence of a transition.
    if (!prev || !f.fusion) return;
    if (prev.uaState !== f.fusion.uaState && f.fusion.uaState === 'IMU_CORRECTION') events.upperArmIMUEntries++;
    if (prev.faState !== f.fusion.faState && f.fusion.faState === 'IMU_CORRECTION') events.forearmIMUEntries++;
    if (prev.uaState !== f.fusion.uaState && f.fusion.uaState === 'RECOVERY') events.upperArmRecoveryEntries++;
    if (prev.faState !== f.fusion.faState && f.fusion.faState === 'RECOVERY') events.forearmRecoveryEntries++;
  });
  return { totalProcessingCycles: frames.length, observedProcessingRateHz: frames.length > 1 && span > 0 ? (frames.length - 1) * 1000 / span : null,
    pipelines: Object.fromEntries(PIPELINES.map(id => [id, {
      fullyAvailableCycles: frames.filter(f => f.pipelines[id].status === 'available').length,
      partialCycles: frames.filter(f => f.pipelines[id].status === 'partial').length,
      unavailableCycles: frames.filter(f => f.pipelines[id].status === 'unavailable').length,
    }])),
    processingDurationMs: {mean: frames.length ? frames.reduce((s, f) => s + f.processingDurationMs, 0) / frames.length : null,
      max: frames.length ? frames.reduce((m, f) => Math.max(m, f.processingDurationMs), 0) : null},
    events, eventCountDefinition: 'Observed state entries between consecutive recorded cycles; initial active states are not counted as new events.' };
}

/** Synchronous ownership: recording boundaries never depend on React state. */
export function createComparisonRecorder() {
  let session: ComparisonSession | null = null;
  let lastConfig = '';
  return {
    getSession: () => session,
    start(id: string, now: number, wall: number, warmupMs: number, metadata: unknown, stateAtStart: ComparisonFrame | null) {
      if (session?.status === 'recording') return false;
      if (!Number.isFinite(warmupMs) || warmupMs < 0) throw new Error('Warmup must be finite and non-negative.');
      lastConfig = JSON.stringify(comparisonSnapshot(metadata));
      session = {schemaVersion: '1.0.0-live-pipeline-comparison', sessionId: id, startWallClockMs: wall, endWallClockMs: null,
        originPerformanceNowMs: now, endPerformanceNowMs: null, durationMs: 0, warmupEndExperimentTimeMs: warmupMs,
        status: 'recording', stopReason: null, metadata: comparisonSnapshot(metadata), stateAtStart: comparisonSnapshot(stateAtStart), configurationChanges: [], frames: [], diagnostics: null};
      return true;
    },
    append(frame: ComparisonFrame, configuration: unknown) {
      if (session?.status !== 'recording') return frame;
      const t = frame.timing.processingStartedPerformanceNowMs - session.originPerformanceNowMs;
      if (t < 0 || (session.frames.length && frame.cycleId <= session.frames.at(-1)!.cycleId)) return frame;
      const saved = comparisonSnapshot({...frame, experimentTimeMs: t, phase: t < session.warmupEndExperimentTimeMs ? 'warmup' : 'measurement'} as ComparisonFrame);
      const config = comparisonSnapshot(configuration), encoded = JSON.stringify(config);
      if (encoded !== lastConfig) { session.configurationChanges.push({experimentTimeMs: t, configuration: config}); lastConfig = encoded; }
      session.frames.push(saved);
      // Preview and archive must not share mutable object ownership.
      return comparisonSnapshot(saved);
    },
    stop(now: number, wall: number, reason = 'user_stop') {
      if (session?.status !== 'recording') return session;
      session.endPerformanceNowMs = now; session.endWallClockMs = wall;
      session.durationMs = Math.max(0, now - session.originPerformanceNowMs);
      session.status = 'stopped'; session.stopReason = reason;
      session.diagnostics = summarizeComparison(session.frames);
      return session;
    },
    clear() { if (session?.status === 'recording') return false; session = null; return true; },
    exportJson() { if (!session || session.status === 'recording') throw new Error('Stop comparison before exporting.'); return JSON.stringify(session, null, 2); },
  };
}
