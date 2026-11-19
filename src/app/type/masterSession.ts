import type { StereoVideoRecording, StereoRecordingProgress, StereoVideoRecorderOptions } from '../hooks/useStereoVideoRecorder';
import type { ExperimentClockMetadata } from './experiment';
import type { StereoCalibration } from './calibration';
import type { FailureCorrectionConfig } from '../hooks/usePoseFailureCorrection';

export type MasterPhase = 'idle' | 'warming_up' | 'initializing' | 'ready' | 'stopping';
export type RequiredStream = 'camera_a' | 'camera_b' | 'imu_01' | 'imu_02';
export interface ReadinessCheck { ready: boolean; reason: string; }
export interface MasterReadiness {
  streams: Record<RequiredStream, ReadinessCheck>;
  processing: ReadinessCheck;
}
export interface ReconstructionRuntimeReport {
  stereoCalibration: StereoCalibration | null;
  correction: FailureCorrectionConfig;
  correctionDefaults: FailureCorrectionConfig;
  mediaPipe: {loaded: boolean; running: boolean; error: string | null; options: unknown; wasmUrl: string};
}
export interface SnapshotValue {
  availability: 'available' | 'unavailable';
  provenance: 'runtime' | 'implementation_constant' | 'declared_package' | 'environment' | 'configured_default' | 'unavailable';
  value: unknown;
  reason?: string;
}
export interface RuntimeSnapshot {
  schemaVersion: '1.0.0-runtime-snapshot';
  values: Record<string, SnapshotValue>;
  criticalMissing: string[];
}
export interface RuntimeJournal {
  schemaVersion: '1.0.0-runtime-configuration';
  initial: RuntimeSnapshot | null;
  changes: Array<{experimentTimeMs: number; snapshot: RuntimeSnapshot}>;
}
export interface MasterReadinessEvent {
  performanceNowMs: number;
  experimentTimeMs: number | null;
  phase: MasterPhase;
  missing: string[];
}
export interface MasterTimeline {
  requestedPerformanceNowMs: number;
  warmupDurationRequiredMs: number;
  warmupStableStartPerformanceNowMs: number | null;
  warmupEndPerformanceNowMs: number | null;
  recordingOriginPerformanceNowMs: number | null;
  evaluationWindowStartMs: number | null;
  evaluationWindowEndMs: number | null;
  stopPerformanceNowMs: number | null;
}
export interface MasterStreamManifest {
  status: 'complete' | 'partial' | 'failed' | 'missing';
  dataAvailable: boolean;
  usable: boolean;
  count: number;
  countMeaning: 'browser_camera_observations' | 'received_imu_packets';
  validPacketCount?: number;
  invalidPacketCount?: number;
  asset: string;
  timingAsset?: string;
  timing: unknown;
  recordingMetadata?: unknown;
  issues: string[];
}
export interface MasterManifest {
  schemaVersion: '1.0.0-master-session';
  sessionId: string;
  createdAt: string;
  status: 'complete' | 'partial' | 'failed';
  clock: ExperimentClockMetadata | null;
  timeline: MasterTimeline;
  durationMs: number;
  warmupExperimentStartMs: number | null;
  readiness: {basis: 'browser_observations_only'; events: MasterReadinessEvent[]; evaluationReady: boolean};
  streams: Record<RequiredStream, MasterStreamManifest>;
  synchronization: StereoVideoRecording['synchronizationDiagnostics'] | null;
  startupDelayAnalysis: unknown;
  configuration: {asset: 'config/runtime_snapshot.json'; completeForReplay: boolean; criticalMissing: string[]};
  files: Array<{path: string; present: boolean}>;
  errors: string[];
  warnings: string[];
  limitations: string[];
}
export interface MasterSession {
  manifest: MasterManifest;
  configuration: RuntimeJournal;
  recording: StereoVideoRecording | null;
}
export interface MasterControllerOptions extends Omit<StereoVideoRecorderOptions, 'onRecordingFinalized'> {
  warmupMs?: number;
  getReadiness(): MasterReadiness;
  getRuntimeSnapshot(): RuntimeSnapshot;
  createZip?: (session: MasterSession) => Promise<Blob>;
}
export interface MasterActiveSession {
  sessionId: string;
  createdAt: string;
  phase: MasterPhase;
  timeline: MasterTimeline;
  configuration: RuntimeJournal;
  readinessEvents: MasterReadinessEvent[];
  missing: string[];
  errors: string[];
  warnings: string[];
  interruptedStreams: Set<string>;
  lastReadinessKey: string;
  lastProgress: StereoRecordingProgress | null;
}
