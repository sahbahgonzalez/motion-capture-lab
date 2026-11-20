import type { PoseLandmarks } from '../hooks/useMediaPipePose';
import type { TriangulatedPose } from '../hooks/useTriangulation';
import type { JointFailureStatus } from '../hooks/usePoseFailureCorrection';
import type { FusionDiagnostics } from '../hooks/useIMUFusionController';
import type { StereoCycleTiming } from '../hooks/useDualMediaPipePose';
import type { StereoGeometryDiagnostics } from '../hooks/useTriangulation';

export type PipelineId = 'P1' | 'P2' | 'P3' | 'P4';
export type ComparisonPose = { [K in keyof PoseLandmarks]: PoseLandmarks[K] | null };
export interface PipelineOutput {
  pose: ComparisonPose;
  joints: Record<keyof PoseLandmarks, { valid: boolean; reason: string | null }>;
  availableJoints: number;
  status: 'available' | 'partial' | 'unavailable';
}
export interface ComparisonFusionSnapshot {
  pose: TriangulatedPose | null;
  diagnostics: FusionDiagnostics | null;
  imuSamples: unknown;
}
export interface ComparisonCycleInput {
  cycleId: number;
  timing: StereoCycleTiming;
  cameraA: PoseLandmarks | null;
  cameraB: PoseLandmarks | null;
  p2: TriangulatedPose;
  p3: TriangulatedPose;
  correction: JointFailureStatus[];
  fusion: ComparisonFusionSnapshot;
  calibrationAvailable: boolean;
  errors: string[];
  processingCompletedPerformanceNowMs: number;
  geometry?: StereoGeometryDiagnostics | null;
}
export interface ComparisonFrame {
  cycleId: number;
  experimentTimeMs: number | null;
  phase: 'preview' | 'warmup' | 'measurement';
  timing: StereoCycleTiming;
  processingCompletedPerformanceNowMs: number;
  processingDurationMs: number;
  cameras: { cameraA: { valid: boolean; landmarks: PoseLandmarks | null }; cameraB: { valid: boolean; landmarks: PoseLandmarks | null } };
  pipelines: Record<PipelineId, PipelineOutput>;
  correction: JointFailureStatus[];
  fusion: FusionDiagnostics | null;
  imuCorrectionActive: boolean;
  imuSamples: unknown;
  errors: string[];
  geometry?: StereoGeometryDiagnostics | null;
}
export interface ComparisonSession {
  schemaVersion: '1.0.0-live-pipeline-comparison';
  sessionId: string;
  startWallClockMs: number;
  endWallClockMs: number | null;
  originPerformanceNowMs: number;
  endPerformanceNowMs: number | null;
  durationMs: number;
  warmupEndExperimentTimeMs: number;
  status: 'recording' | 'stopped';
  stopReason: string | null;
  metadata: unknown;
  stateAtStart: ComparisonFrame | null;
  configurationChanges: Array<{ experimentTimeMs: number; configuration: unknown }>;
  frames: ComparisonFrame[];
  diagnostics: ReturnType<typeof import('../utils/pipelineComparison').summarizeComparison> | null;
}
