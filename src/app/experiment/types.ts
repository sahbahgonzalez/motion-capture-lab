import type {ComparisonFrame,PipelineOutput} from '../type/pipelineComparison';
import type {CameraTimingSidecar,StereoSynchronizationDiagnostics,StereoRecordingDiagnostics,StereoRecorderInstrumentation} from '../hooks/useStereoVideoRecorder';
import type {Annotation,EvaluationConfig} from '../evaluation/types';
export type VisualPipeline='P1'|'P2'|'P3';
export type ExperimentPipeline=VisualPipeline|'P4';
export interface VideoClockMapping {
  offsetMs:number;
  provenance:'user_supplied'|'estimated_recorder_start';
  uncertaintyMs:number|null;
  description:string;
}
export interface LiveP4Sample {
  cycleId:number;experimentTimeMs:number;phase:ComparisonFrame['phase'];
  output:PipelineOutput;visualReliability:ComparisonFrame['pipelines']['P3']['joints'];
  cameraObservationTiming:ComparisonFrame['timing'];fusion:ComparisonFrame['fusion'];correction:ComparisonFrame['correction'];
  liveSharedProcessingDurationMs:number;errors:string[];
}
export interface OfflineSample {
  sampleId:string;index:number;cameraAMediaTimeSeconds:number;cameraBMediaTimeSeconds:number|null;
  cameraAFrameId:number|null;cameraBFrameId:number|null;
  experimentTimeMs:number|null;output:PipelineOutput;
  playbackProcessingDurationMs:number;
  timingEvidence:string;
  /** Requested seek/currentTime residual only; B decoded PTS is unverified. */
  stereoPairResidualMs:number|null;errors:string[];
}
export interface OfflineResult {
  sessionId:string;pipeline:VisualPipeline;runId:string;status:'complete'|'partial'|'failed';
  samples:OfflineSample[];configuration:unknown;errors:string[];
  cameraMapping:{cameraA:VideoClockMapping|null;cameraB:VideoClockMapping|null};
  samplingPolicy:string;skippedPresentationObservations:number;
}
export interface ExperimentalSession {
  schemaVersion:'1.0.0-live-p4-visual-offline';sessionId:string;
  status:'recording'|'finalizing'|'ready'|'partial'|'failed';
  originPerformanceNowMs:number;startWallClockMs:number;stopWallClockMs:number|null;durationMs:number|null;
  warmupEndExperimentTimeMs:number;configuration:unknown;
  clockDefinitions:{experiment:string;wall:string;video:string;liveSample:string;offlineProcessing:string};
  liveP4:LiveP4Sample[];
  configurationChanges:Array<{experimentTimeMs:number;configuration:unknown}>;
  cameras:{status:string;cameraAStatus:string;cameraBStatus:string;cameraAAsset:string|null;cameraBAsset:string|null;cameraAMimeType?:string;cameraBMimeType?:string;
    cameraATiming:CameraTimingSidecar|null;cameraBTiming:CameraTimingSidecar|null;synchronization:StereoSynchronizationDiagnostics|null;diagnostics:StereoRecordingDiagnostics|null;startupInstrumentation?:StereoRecorderInstrumentation;};
  offline:Partial<Record<VisualPipeline,OfflineResult>>;
  cameraMapping:{cameraA:VideoClockMapping|null;cameraB:VideoClockMapping|null};
  alignment:{toleranceMs:number;allowEstimated:boolean;};
  annotations:Annotation[];evaluationConfigurations:Partial<Record<ExperimentPipeline,Partial<EvaluationConfig>>>;
  errors:string[];limitations:string[];
}
export interface ExperimentalAssets {cameraA:Blob|null;cameraB:Blob|null;}
export interface StoredExperiment {manifest:ExperimentalSession;assets:ExperimentalAssets;}
