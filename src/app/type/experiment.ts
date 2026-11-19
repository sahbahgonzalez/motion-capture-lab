import type { MotionRecording } from '../hooks/useMotionRecorder';
import type { PoseLandmarks } from '../hooks/useMediaPipePose';
import type { RecoveryPhase, SegmentState } from '../hooks/useIMUFusionController';
import type { StereoCalibration } from './calibration';

export const EXPERIMENT_SCHEMA_VERSION = '1.0.0' as const;

export type ExperimentSchemaVersion = typeof EXPERIMENT_SCHEMA_VERSION;
export type PipelineId = 'P1' | 'P2' | 'P3' | 'P4';
export type CameraRole = 'camera_a' | 'camera_b';
export type ExperimentJoint = keyof PoseLandmarks;
export type RightArmJoint = 'rightShoulder' | 'rightElbow' | 'rightWrist';
export type SynchronizationStatus = 'unknown' | 'unverified' | 'estimated' | 'verified';

export interface ContentHash {
  algorithm: 'sha256' | 'sha384' | 'sha512';
  value: string;
}

export interface ResolvableAssetReference {
  assetId: string;
  fileName?: string;
  mimeType?: string;
  uri?: string;
  contentHash?: ContentHash;
  byteLength?: number;
}

export type ReproducibleArtifact<TSnapshot> =
  | {
      storage: 'embedded';
      snapshot: TSnapshot;
      contentHash?: ContentHash;
      sourceReference?: ResolvableAssetReference;
    }
  | {
      storage: 'external';
      reference: ResolvableAssetReference & {
        uri: string;
        contentHash: ContentHash;
      };
    };

export interface ExperimentSoftwareMetadata {
  applicationVersion?: string;
  commitIdentifier?: string;
  buildIdentifier?: string;
}

export interface ExperimentRecordingConfiguration {
  enabledPipelines: PipelineId[];
  requestedCameraFrameRate?: number;
  requestedCameraResolution?: {
    width: number;
    height: number;
  };
  imuWebSocketUrl?: string;
  coordinateUnits: Partial<Record<PipelineId, 'normalized' | 'mm'>>;
  notes?: string;
}

export interface LiveMonotonicClockOrigin {
  source: 'performance.now';
  originPerformanceNowMs: number;
  browserTimeOriginEpochMs?: number;
}

export interface CameraPlaybackClockOrigin {
  source: 'camera_a_media_time';
  cameraMediaTimeOriginSeconds: number;
  experimentTimeAtOriginMs: number;
}

export interface BrowserReceiverClockMetadata {
  monotonicSource: 'performance.now';
  browserTimeOriginEpochMs?: number;
  wallClockSource?: 'Date.now';
  receiverTimestampPrecision?: 'unknown' | 'milliseconds' | 'nanoseconds';
}

export interface ClockRelationship {
  fromClock: 'experiment' | 'browser_monotonic' | 'browser_wall' | 'camera_a' | 'camera_b' | 'imu_01' | 'imu_02';
  toClock: 'experiment' | 'browser_monotonic' | 'browser_wall' | 'camera_a' | 'camera_b' | 'imu_01' | 'imu_02';
  status: SynchronizationStatus;
  estimatedOffsetMs?: number;
  uncertaintyMs?: number;
  method?: string;
  notes?: string;
}

export interface ExperimentClockMetadata {
  authoritativeClock: 'live_performance_now' | 'camera_a_media_time';
  experimentTimeDefinition: 'milliseconds_relative_to_authoritative_origin';
  liveCaptureOrigin?: LiveMonotonicClockOrigin;
  playbackOrigin?: CameraPlaybackClockOrigin;
  browserReceiverClock: BrowserReceiverClockMetadata;
  relationships: ClockRelationship[];
}

export interface CameraResolution {
  width: number;
  height: number;
}

export interface CameraFrameRateMetadata {
  nominalFps?: number;
  observedAverageFps?: number;
  variableFrameRate?: boolean;
}

export interface CameraPresentationMetadata {
  presentedFrames?: number;
  expectedDisplayTimePerformanceNowMs?: number;
  presentationTimePerformanceNowMs?: number;
  processingDurationMs?: number;
}

export interface CameraTimestampObservation {
  frameRef: string;
  experimentTimeMs: number;
  mediaTimeSeconds: number;
  browserObservedPerformanceNowMs: number;
  browserObservedWallClockMs?: number;
  presentation?: CameraPresentationMetadata;
}

export interface ExperimentCameraMetadata {
  role: CameraRole;
  cameraId: string;
  deviceId?: string;
  label?: string;
  videoFile?: ResolvableAssetReference;
  resolution?: CameraResolution;
  frameRate?: CameraFrameRateMetadata;
  timestampObservations: CameraTimestampObservation[];
}

export interface CameraPairTimingMetadata {
  status: SynchronizationStatus;
  cameraBMediaTimeBasis: 'observed_current_time' | 'camera_b_frame_callback';
  cameraBFrameSynchronizationVerified: boolean;
  estimatedOffsetMs?: number;
  uncertaintyMs?: number;
  notes?: string;
}

export interface NormalizedQuaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

export interface BrowserReceiverTimestamp {
  performanceNowMs: number;
  wallClockMs?: number;
  /** New IMU archives use exact decimal strings; numbers remain accepted for legacy exports. */
  receiverTimeNs?: number | string;
  receiverTimeUtc?: string;
}

export interface IMUPacketValidity {
  valid: boolean;
  quaternionNormalized: boolean;
  rejectionReason?: string;
}

export interface IMUPacketSynchronization {
  status: SynchronizationStatus;
  estimatedSensorToExperimentOffsetMs?: number;
  uncertaintyMs?: number;
  method?: string;
}

export interface ExperimentIMUPacket {
  packetId: string;
  sensorId: 'imu_01' | 'imu_02';
  /** Null when absent or invalid; original transport values belong in the raw packet archive. */
  sensorTimestampUs: number | null;
  sequence: number | null;
  browserReceiverTimestamp: BrowserReceiverTimestamp;
  experimentReceiveTimeMs: number;
  normalizedQuaternion: NormalizedQuaternion | null;
  accuracy?: number | null;
  validity: IMUPacketValidity;
  synchronization: IMUPacketSynchronization;
}

export interface ExperimentIMUStream {
  sensorId: 'imu_01' | 'imu_02';
  segment: 'right_upper_arm' | 'right_forearm';
  packets: ExperimentIMUPacket[];
  source?: ResolvableAssetReference;
}

export interface IMUAlsCalibrationSnapshot {
  timestampMs: number;
  upperArm: {
    boneLocalDirection: readonly [number, number, number];
    imuWorldToStereoRotation: readonly [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
    ];
    lengthMm: number;
  };
  forearm: {
    boneLocalDirection: readonly [number, number, number];
    imuWorldToStereoRotation: readonly [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
    ];
    lengthMm: number;
  };
  quality: 'good' | 'warning' | 'failed';
  validationSummary?: Record<string, number | boolean | string>;
}

export interface ExperimentCalibrationMetadata {
  calibrationVersion: string;
  units: {
    cameraTranslation: 'mm';
    reconstructedCoordinates: 'mm';
    angles: 'degrees';
    imuSensorTimestamp: 'microseconds';
  };
  stereo: ReproducibleArtifact<StereoCalibration>;
  imuAls: ReproducibleArtifact<IMUAlsCalibrationSnapshot>;
}

export type OcclusionMode = 'fusion_trigger_only' | 'shared_landmark_dropout';

interface OcclusionEventBase {
  eventId: string;
  startExperimentTimeMs: number;
  endExperimentTimeMs: number;
  targetJoints: RightArmJoint[];
  notes?: string;
}

export interface FusionTriggerOnlyOcclusionEvent extends OcclusionEventBase {
  mode: 'fusion_trigger_only';
  injectionStage: 'pipeline4_simulated_failures_input';
  semantics: 'pipeline4_trigger_without_shared_visual_dropout';
}

export interface SharedLandmarkDropoutOcclusionEvent extends OcclusionEventBase {
  mode: 'shared_landmark_dropout';
  injectionStage: 'shared_visual_observation_boundary';
  semantics: 'remove_designated_visual_observations_before_pipeline_branching';
}

export type RightArmOcclusionEvent =
  | FusionTriggerOnlyOcclusionEvent
  | SharedLandmarkDropoutOcclusionEvent;

export interface ExperimentProtocol {
  warmupStartMs: number;
  measurementStartMs: number;
  measurementEndMs: number;
  rightArmOcclusionSchedule: RightArmOcclusionEvent[];
}

export type CameraCycleFrameReference =
  | {
      status: 'available';
      frameRef: string;
      mediaTimeSeconds: number;
      browserObservedPerformanceNowMs: number;
      presentation?: CameraPresentationMetadata;
    }
  | {
      status: 'missing';
      reason: string;
      observedMediaTimeSeconds?: number;
    };

export interface ExperimentCycleCameraReferences {
  cameraA: CameraCycleFrameReference;
  cameraB: CameraCycleFrameReference;
  cameraBTimingBasis: 'observed_current_time' | 'camera_b_frame_callback';
  synchronizationStatus: SynchronizationStatus;
  observedDriftMs?: number;
  timingUncertaintyMs?: number;
}

export type IMUSampleReference =
  | {
      status: 'available';
      packetId: string;
      sequence: number;
      sampleAgeMs?: number;
    }
  | {
      status: 'missing';
      reason: string;
    };

export type PipelineOutputMissingReason =
  | 'not_processed'
  | 'no_pose_detected'
  | 'insufficient_camera_data'
  | 'imu_unavailable'
  | 'pipeline_error'
  | 'outside_measurement_window'
  | 'other';

/**
 * The parent ExperimentCycle supplies the authoritative cycleId and
 * experimentTimeMs, so output references cannot introduce independent clocks.
 */
export type PipelineCycleOutputReference =
  | {
      status: 'available';
      recordingId: string;
      frameNumber: number;
    }
  | {
      status: 'missing';
      reason: PipelineOutputMissingReason;
      detail?: string;
    };

export interface Pipeline4FailureTriggerMetadata {
  segment: 'upper_arm' | 'forearm';
  reason: string;
  targetJoint?: RightArmJoint;
}

export interface Pipeline4TransitionEvent {
  segment: 'upper_arm' | 'forearm';
  from: SegmentState;
  to: SegmentState;
}

export interface Pipeline4RecoveryMetadata {
  upperArmPhase: RecoveryPhase;
  forearmPhase: RecoveryPhase;
  upperArmFrame: number;
  forearmFrame: number;
}

export interface Pipeline4ReconstructionValidity {
  shoulder: boolean;
  elbow: boolean;
  wrist: boolean;
  fullyAvailable: boolean;
}

export interface Pipeline4CycleDiagnostics {
  upperArmState?: SegmentState;
  forearmState?: SegmentState;
  failureTrigger?: Pipeline4FailureTriggerMetadata;
  transitionEvent?: Pipeline4TransitionEvent;
  imuSampleAgeMs?: {
    imu_01: number;
    imu_02: number;
  };
  recovery?: Pipeline4RecoveryMetadata;
  reconstructionValidity?: Pipeline4ReconstructionValidity;
}

export interface ExperimentCycleProcessingStatus {
  status: 'complete' | 'partial' | 'failed' | 'skipped';
  missingData: string[];
  errors?: string[];
}

export interface ExperimentCycle {
  cycleId: string;
  experimentTimeMs: number;
  cameras: ExperimentCycleCameraReferences;
  imuSamples: {
    imu_01: IMUSampleReference;
    imu_02: IMUSampleReference;
  };
  outputs: {
    P1: PipelineCycleOutputReference;
    P2: PipelineCycleOutputReference;
    P3: PipelineCycleOutputReference;
    P4: PipelineCycleOutputReference;
  };
  pipeline4Diagnostics?: Pipeline4CycleDiagnostics;
  processing: ExperimentCycleProcessingStatus;
}

export interface ExperimentPipelineRecording {
  pipelineId: PipelineId;
  recording: MotionRecording;
  timestampSource: 'experimentTimeMs';
  coordinateSpace: 'camera_a_normalized' | 'stereo_world_mm';
}

export interface ExperimentSession {
  sessionId: string;
  schemaVersion: ExperimentSchemaVersion;
  createdAt: string;
  software?: ExperimentSoftwareMetadata;
  recordingConfiguration: ExperimentRecordingConfiguration;
  clock: ExperimentClockMetadata;
  cameras: {
    cameraA: ExperimentCameraMetadata;
    cameraB: ExperimentCameraMetadata;
    pairTiming: CameraPairTimingMetadata;
  };
  imu: {
    imu_01: ExperimentIMUStream;
    imu_02: ExperimentIMUStream;
  };
  calibration: ExperimentCalibrationMetadata;
  protocol: ExperimentProtocol;
  cycles: ExperimentCycle[];
  pipelineRecordings: Partial<Record<PipelineId, ExperimentPipelineRecording>>;
}
