import type { ExperimentClockMetadata, ExperimentIMUPacket } from './experiment';

export type RecordedIMUSensorId = 'imu_01' | 'imu_02';
export type IMUConnectionState = 'disconnected' | 'connecting' | 'open' | 'closed' | 'error';
export interface IMUConnectionSnapshot {
  state: IMUConnectionState;
  connectionId: string | null;
  url: string | null;
}
export interface IMUConnectionEvent extends IMUConnectionSnapshot {
  type: 'connecting' | 'open' | 'close' | 'error' | 'reconnect' | 'construction_error' | 'unmount';
  browserReceiptPerformanceNowMs: number;
  experimentTimeMs: number;
  interruption: boolean;
  detail?: string;
}
export interface IMURawMessage {
  rawMessage: string | null;
  rawBinaryHex?: string;
  rawDataType: string;
  rawFields: unknown;
}
export interface RecordedIMUPacket extends ExperimentIMUPacket, IMURawMessage {
  connectionId: string | null;
  metadataValidity: Record<'timestamp_us' | 'sequence' | 'accuracy' | 'quaternion' | 'receiver_time_ns' | 'receiver_time_utc', 'valid' | 'missing' | 'invalid'>;
  validationIssues: string[];
}
export interface UnassignedIMUMessage extends IMURawMessage {
  browserReceiptPerformanceNowMs: number;
  browserReceiptWallClockMs: number;
  experimentReceiveTimeMs: number;
  connectionId: string | null;
  reason: string;
}
export interface IMURecordingContext {
  recordingId: string;
  experimentSessionId?: string;
  experimentStartPerformanceNowMs: number;
  startTime: number;
  clockMetadata: ExperimentClockMetadata;
}
export interface IMURecordingStop {
  endPerformanceNowMs: number;
  reason: string;
}
export interface IMURecordingDiagnostics {
  packetCount: number;
  validPacketCount: number;
  invalidPacketCount: number;
  firstExperimentReceiveTimeMs: number | null;
  lastExperimentReceiveTimeMs: number | null;
  observedReceiptRateHz: number | null;
  receiptGapThresholdMs: number;
  receiptTimingGaps: Array<{ afterPacketId: string; beforePacketId: string; gapMs: number }>;
  startToFirstPacketMs: number | null;
  lastPacketToStopMs: number | null;
  duplicateSequenceCount: number;
  outOfOrderSequenceCount: number;
  sequenceResetOrWrapCount: number;
  inferredForwardMissingSequenceCount: number;
  missingSequenceCount: number | null;
  missingSequenceCountLimitation: string;
  connectionInterruptionCount: number;
  unassignedMessageCount: number;
}
export interface IMURecordingSidecar extends IMURecordingContext {
  schemaVersion: '1.0.0-imu-recording';
  sensorId: RecordedIMUSensorId;
  segment: 'right_upper_arm' | 'right_forearm';
  endPerformanceNowMs: number;
  durationMs: number;
  stopReason: string;
  status: 'recorded' | 'empty';
  quaternionOrdering: 'wxyz';
  clockDefinitions: {
    browserReceiptSource: 'performance.now';
    experimentReceiveTimeDefinition: 'browser_receipt_minus_shared_camera_origin_ms';
    sensorTimestampField: 'timestamp_us';
    sensorTimestampUnit: 'microseconds';
    sensorClockOrigin: 'unknown';
    upstreamReceiverClock: 'unverified';
    hardwareClockSynchronizationVerified: false;
  };
  connectionAtStart: IMUConnectionSnapshot;
  connectionEvents: IMUConnectionEvent[];
  packets: RecordedIMUPacket[];
  unassignedMessages: UnassignedIMUMessage[];
  diagnostics: IMURecordingDiagnostics;
  limitations: string[];
}
export type IMURecordingSidecars = Record<RecordedIMUSensorId, IMURecordingSidecar>;
export interface IMURecordingProgress {
  recordingId: string;
  streams: Record<RecordedIMUSensorId, {
    packetCount: number;
    firstValidExperimentTimeMs: number | null;
    lastReceiptPerformanceNowMs: number | null;
  }>;
}
export interface IMURecordingHandle {
  getProgress?(): IMURecordingProgress;
  stop(boundary: IMURecordingStop): IMURecordingSidecars;
}
export interface IMURecordingSource {
  start(context: IMURecordingContext): IMURecordingHandle;
}
