import type { PipelineId } from '../type/pipelineComparison';
import type { PoseLandmarks } from '../hooks/useMediaPipePose';

export type Joint = keyof PoseLandmarks;
export type Controller = 'upperArm' | 'forearm';
export type Point = {x:number;y:number;z:number};
export type State = 'STEREO' | 'IMU_CORRECTION' | 'RECOVERY' | 'UNAVAILABLE' | 'UNKNOWN';
export type Segment = 'rightUpperArm' | 'rightForearm' | 'leftUpperArm' | 'leftForearm';
export interface Annotation {
  id:string; label:string; coordinate:'time_ms'|'frame_index'; start:number; end:number;
  healthyVisibility:boolean;
  kind?:'stationary'|'moving'|'visible'|'occluded'|'recovery'|'custom';
}
export interface EvaluationConfig {
  schemaVersion:'1.0.0-evaluation-config';
  includeWarmup:boolean;
  includeUnclassified:boolean;
  maxObservationGapMs:number;
  transitionWindowMs:number;
  jumpDistanceMm:number;
  jumpSpeedMmPerSecond:number;
  jumpDistanceNormalizedXY:number;
  jumpSpeedNormalizedXYPerSecond:number;
  lengthDeviationThresholdFraction:number;
  annotations:Annotation[];
  controllerFilter: {controller:Controller; state:State} | null;
  comparative?:{
    joint?:Joint;stationaryIds?:string[];movingIds?:string[];
    visibility?:'all'|'visible'|'occluded'|'recovery';
    lagMaxMs?:number;lagStepMs?:number;lagToleranceMs?:number;
    freezeSpeedBodyWidthsPerSecond?:number;observedMovementBodyWidthsPerSecond?:number;
    jumpBodyWidths?:number;jumpBodyWidthsPerSecond?:number;
  };
}
export interface Sample {point:Point|null;valid:boolean;reason:string|null;validitySource:'recorded'|'inferred_legacy'|'unavailable';}
export interface EvaluatedFrame {
  index:number;cycleId:number|null;timeMs:number|null;timeSource:'recorded'|'performance_origin'|'unavailable';
  phase:'warmup'|'measurement'|'unclassified';
  pipelines:Record<PipelineId,Record<Joint,Sample>>;
  controllers:Record<Controller,{state:State;reason:string|null;failureEvidence:boolean|null}>;
  imuActive:boolean|null;imuActiveSource:'recorded_flag'|'controller_states'|'unavailable';
  processingMs:number|null;inferenceMs:number|null;reconstructionMs:number|null;
  pipelineProcessingMs:Record<PipelineId,number|null>;
  cameraAPresentedFrames:number|null;
  cameraConfidence?:Record<'cameraA'|'cameraB',Partial<Record<Joint,number|null>>>;
  recordedErrors:string[];
  geometryStatus:string|null;
  calibratedLengths:Partial<Record<Segment,number>>;
  configurationIndex:number;
}
export interface ImportedSession {
  sessionId:string;sourceSchema:string;status:string|null;durationMs:number|null;warmupEndMs:number|null;
  frames:EvaluatedFrame[];
  configurations:unknown[];
  configurationChanges:unknown[];
  warnings:string[];
  startWallClockMs:number|null;endWallClockMs:number|null;stopReason:string|null;
  quality:{malformedFrames:number;missingPipelineRecords:number;invalidRecordedValidityClaims:number;inferredValiditySamples:number;missingTimestamps:number;duplicateTimestamps:number;nonMonotonicTimestamps:number;duplicateCycleIds:number;imuFlagStateDisagreements:number;};
  sourceFingerprint:{algorithm:'fnv1a-32';value:string;purpose:string};
}
export interface Stats {count:number;mean:number|null;median:number|null;stdDev:number|null;min:number|null;max:number|null;p95:number|null;p99:number|null;mad:number|null;iqr:number|null;}
export interface Run {
  startIndex:number;endIndexExclusive:number;frames:number;
  startMs:number|null;endMs:number|null;durationMs:number|null;
  leftCensored:boolean;rightCensored:boolean;timingUnknown:boolean;
}
export interface Availability {
  validFrames:number;missingFrames:number;availabilityPercent:number|null;
  missingIntervals:Run[];longestMissingIntervalMs:number|null;meanCompleteMissingIntervalMs:number|null;
}
export interface RecoveryComparison {bothValid:number;bothInvalid:number;recoveredByP4:number;lostByP4:number;improvementPercentagePoints:number|null;}
export interface ControllerEvent {
  controller:Controller;index:number;timeMs:number|null;from:State;to:State;kind:'correction_activation'|'recovery_entry'|'state_change';
  reason:string|null;
  failureObservedIndex:number|null;recordedCycleSeparationMs:number|null;
  failureToActivationMs:number|null;latencyInterpretation:string;
  annotatedHealthy:boolean;
}
export interface ControllerMetrics {
  stateFrames:Record<State,number>;stateTimeMs:Record<State,number|null>;
  coveredTimeMs:number|null;unobservedTimeMs:number|null;
  correctionActivations:number;activationReasons:Record<string,number>;activationLatenciesMs:Stats;
  correctionFramePercent:number|null;imuInfluenceFramePercent:number|null;
  activationsDuringAnnotatedHealthy:number|null;healthyAnnotatedFrames:number;
  correctionEpisodes:Run[];recoveryEpisodes:Run[];correctionDurationMs:Stats;recoveryDurationMs:Stats;
  interruptedRecoveries:number;unsuccessfulRecoveries:number;censoredRecoveries:number;
}
export interface SegmentMetrics {
  eligibleFrames:number;validLengthFrames:number;missingLengthFrames:number;
  lengthMm:Stats;calibratedReferenceMm:Stats;deviationMm:Stats;absoluteDeviationFraction:Stats;
  framesWithReference:number;exceedingThresholdFrames:number;exceedingThresholdPercent:number|null;
  byControllerState:Partial<Record<State,{count:number;lengthMm:Stats;deviationMm:Stats}>>;
}
export interface MotionSample {index:number;timeMs:number|null;elapsedMs:number|null;displacement:number;speed:number|null;nearActivation:boolean;nearRecovery:boolean;}
export interface MotionGroup {intervals:number;displacement:Stats;speed:Stats;largeDisplacementCount:number;largeSpeedCount:number;}
export interface MotionMetrics {
  units:'normalized_image_xy'|'mm';speedUnits:'normalized_image_xy/s'|'mm/s';
  overall:MotionGroup;ordinary:MotionGroup;nearActivation:MotionGroup;nearRecovery:MotionGroup;samples:MotionSample[];
  excludedNonAdjacentOrInvalid:number;excludedTimingGaps:number;
}
export interface PerformanceMetrics {
  effectiveFps:number|null;observationSpanMs:number|null;frameIntervalsMs:Stats;processingDurationMs:Stats;inferenceSpanMs:Stats;postInferenceSpanMs:Stats;
  perPipelineDurationMs:Record<PipelineId,Stats>;
  skippedCycleIdIndicators:number;skippedCameraAPresentationIndicators:number;largeObservationGaps:number;
}
export interface ScopeMetrics {
  id:string;label:string;annotation:Annotation|null;frameCount:number;frameIndices:number[];
  dataQuality:{missingTimestampCycles:number;unknownControllerCycles:number;recordedErrorCycles:number;invalidGeometryCycles:number;};
  selectedWindowMs:number|null;firstTimestampMs:number|null;lastTimestampMs:number|null;
  availability:Record<PipelineId,Record<Joint,Availability>>;
  p3VersusP4:Record<Joint,RecoveryComparison>;
  controllers:Record<Controller,ControllerMetrics>;
  imuActiveFrames:number;imuActiveKnownFrames:number;imuActivePercent:number|null;
  anatomical:Record<'P2'|'P3'|'P4',Record<Segment,SegmentMetrics>>;
  motion:Record<PipelineId,Record<Joint,MotionMetrics>>;
  performance:PerformanceMetrics;
}
export interface EvaluationReport {
  schemaVersion:'1.0.0-offline-evaluation';engineVersion:'1.1.0';
  config:EvaluationConfig;
  source:{sessionId:string;schema:string;fingerprint:ImportedSession['sourceFingerprint'];};
  summary:{durationMs:number|null;startWallClockMs:number|null;endWallClockMs:number|null;stopReason:string|null;totalCycles:number;warmupCycles:number;measurementCycles:number;unclassifiedCycles:number;status:string|null;completeness:string;};
  configurations:unknown[];configurationChanges:unknown[];
  quality:ImportedSession['quality'];warnings:string[];
  definitions:Record<string,string>;
  scopes:ScopeMetrics[];events:ControllerEvent[];
  frames:EvaluatedFrame[];
  comparative:import('./comparative').ComparativeReport;
}
