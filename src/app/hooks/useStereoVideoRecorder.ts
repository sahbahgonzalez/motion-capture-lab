import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type {
  CameraPairTimingMetadata,
  CameraPresentationMetadata,
  CameraTimestampObservation,
  ExperimentClockMetadata,
  SynchronizationStatus,
} from '../type/experiment';
import type { IMURecordingHandle, IMURecordingSidecars, IMURecordingSource } from '../type/imuRecording';

export type CameraTimingMetadataAvailability =
  | 'frame_specific'
  | 'fallback_current_time'
  | 'unavailable';

export type CameraRecordingStatus =
  | 'inactive'
  | 'recording'
  | 'stopping'
  | 'complete'
  | 'unavailable'
  | 'error';

export const DEFAULT_PAIRING_TOLERANCE_MS = 33;
export const DEFAULT_SIGNIFICANT_GAP_THRESHOLD_MS = 100;
const RECORDER_STOP_TIMEOUT_MS = 5000;

export type EncodedVideoMetrics =
  | {
      status: 'unavailable';
      reason: string;
      externalMeasurementRecommended: true;
    }
  | {
      status: 'measured_externally';
      measurementTool: string;
      encodedFrameCount: number;
      encodedFramesPerSecond: number;
      timestampGapsMs: number[];
    };

export interface CameraTimingDiscontinuity {
  afterSequence: number;
  browserObservationGapMs: number;
  cameraMediaTimeGapMs?: number;
  skippedPresentationFrames: number;
  thresholdMs: number;
}

export interface RecordedCameraTimingObservation extends CameraTimestampObservation {
  sequence: number;
  observationMethod: 'request_video_frame_callback' | 'request_animation_frame_current_time';
  mediaTimestampSource: 'rvfc_media_time' | 'video_current_time';
  skippedFramesSincePrevious: number;
  mediaTimeDeltaMs?: number;
}

export interface CameraTimingSummary {
  observedFrameCount: number;
  firstExperimentTimeMs?: number;
  lastExperimentTimeMs?: number;
  firstMediaTimeSeconds?: number;
  lastMediaTimeSeconds?: number;
  browserObservedCallbackFps?: number;
  /** @deprecated Alias of browserObservedCallbackFps; never encoded-video FPS. */
  observedFrameRate?: number;
  meanObservationIntervalMs?: number;
  observationIntervalStdDevMs?: number;
  /** Legacy count of observations with skipped presentation frames; not significant time gaps. */
  frameGapCount: number;
  skippedFrameCount: number;
  largestObservationIntervalMs?: number;
  largestMediaTimeDeltaMs?: number;
  significantGapCount: number;
}

export interface CameraTimingSidecar {
  schemaVersion: '1.0.0-camera-timing';
  recordingId: string;
  cameraRole: 'camera_a' | 'camera_b';
  cameraId: string;
  videoAssetId: string;
  resolution?: {
    width: number;
    height: number;
  };
  nominalFrameRate?: number;
  requestedFrameRate?: number;
  trackReportedFrameRate?: number;
  experimentStartPerformanceNowMs: number;
  metadataAvailability: CameraTimingMetadataAvailability;
  synchronizationStatus: SynchronizationStatus;
  limitation?: string;
  observations: RecordedCameraTimingObservation[];
  summary: CameraTimingSummary;
  significantGapThresholdMs: number;
  significantDiscontinuities: CameraTimingDiscontinuity[];
  encodedVideoMetrics: EncodedVideoMetrics;
}

export interface RecorderStartupTiming {
  startCallExperimentTimeMs?: number;
  startEventExperimentTimeMs?: number;
  firstDataAvailableExperimentTimeMs?: number;
  timingObserverRegisteredExperimentTimeMs?: number;
  firstTimingObservationExperimentTimeMs?: number;
  stopCallExperimentTimeMs?: number;
  stopEventExperimentTimeMs?: number;
  lastDataAvailableExperimentTimeMs?: number;
}

export interface StereoRecorderInstrumentation {
  recordingId: string;
  experimentStartPerformanceNowMs: number;
  cameraA: RecorderStartupTiming;
  cameraB: RecorderStartupTiming;
  notes: string[];
}

export interface CameraObservationPair {
  cameraASequence: number;
  cameraBSequence: number;
  browserCallbackOffsetMs: number;
}

export interface StereoSynchronizationDiagnostics {
  recordingId: string;
  status: SynchronizationStatus;
  basis: 'one_to_one_browser_callback_receipt';
  /** @deprecated Pairing no longer uses this interpretation. */
  browserPresentationAlignmentOnly: false;
  browserCallbackReceiptAlignmentOnly: true;
  hardwareExposureSynchronizationVerified: false;
  pairingPolicy: 'monotonic_one_to_one_greedy';
  pairingTimeBasis: 'browser_callback_receipt_performance_now';
  pairingToleranceMs: number;
  pairedObservationCount: number;
  matchedObservationCount: number;
  unmatchedCameraAObservationCount: number;
  unmatchedCameraBObservationCount: number;
  matchedPairs: CameraObservationPair[];
  meanBrowserObservationOffsetMs?: number;
  meanAbsoluteBrowserObservationOffsetMs?: number;
  medianAbsoluteBrowserObservationOffsetMs?: number;
  p95AbsoluteBrowserObservationOffsetMs?: number;
  maxAbsoluteBrowserObservationOffsetMs?: number;
  /** @deprecated Raw camera media-time origins are not assumed comparable. */
  meanMediaTimeOffsetMs?: number;
  /** @deprecated Raw camera media-time origins are not assumed comparable. */
  maxAbsoluteMediaTimeOffsetMs?: number;
  /** @deprecated This was browser pairing residual, not exposure uncertainty. */
  timingUncertaintyMs?: number;
  cameraMediaTimeOriginsComparable: false;
  cameraPairMetadata: CameraPairTimingMetadata;
  startupInstrumentation?: StereoRecorderInstrumentation;
  limitations: string[];
}

export interface StereoRecordingDiagnostics {
  recordingId: string | null;
  cameraAStatus: CameraRecordingStatus;
  cameraBStatus: CameraRecordingStatus;
  cameraAObservedFrameCount: number;
  cameraBObservedFrameCount: number;
  cameraARequestedFps?: number;
  cameraBRequestedFps?: number;
  cameraABrowserObservedCallbackFps?: number;
  cameraBBrowserObservedCallbackFps?: number;
  cameraASkippedPresentationFrames: number;
  cameraBSkippedPresentationFrames: number;
  cameraAEncodedFpsAvailable: boolean;
  cameraBEncodedFpsAvailable: boolean;
  durationMs: number;
  cameraAMetadataAvailability: CameraTimingMetadataAvailability;
  cameraBMetadataAvailability: CameraTimingMetadataAvailability;
  synchronizationStatus: SynchronizationStatus;
}

export interface StereoVideoRecording {
  id: string;
  name: string;
  /** Optional wall-clock correlation retained for existing UI and filenames. */
  startTime: number;
  /** Monotonic duration from the shared experiment clock. */
  duration: number;
  cam1Blob: Blob;
  cam2Blob: Blob;
  mimeType: string;
  experimentSessionId?: string;
  imuRecording?: IMURecordingSidecars;
  clockMetadata: ExperimentClockMetadata;
  cameraATiming: CameraTimingSidecar;
  cameraBTiming: CameraTimingSidecar;
  synchronizationDiagnostics: StereoSynchronizationDiagnostics;
  startupInstrumentation: StereoRecorderInstrumentation;
  status: 'complete' | 'partial' | 'failed';
  limitations: string[];
  cameraAEncodingStatus: 'complete' | 'failed';
  cameraBEncodingStatus: 'complete' | 'failed';
  errors: string[];
}

export interface StereoRecordingIdentity { recordingId: string; experimentSessionId: string; }
export interface StereoRecordingProgress {
  recordingId: string;
  originPerformanceNowMs: number;
  phase: RecordingSession['phase'];
  diagnostics: StereoRecordingDiagnostics;
  instrumentation: StereoRecorderInstrumentation;
  imu: import('../type/imuRecording').IMURecordingProgress | null;
}

export interface StereoVideoRecorderOptions {
  onRecordingFinalized?: (recording: StereoVideoRecording) => void;
  imuRecordingSource?: IMURecordingSource;
  cameraA?: {
    videoRef?: RefObject<HTMLVideoElement | null>;
    cameraId?: string;
  };
  cameraB?: {
    videoRef?: RefObject<HTMLVideoElement | null>;
    cameraId?: string;
  };
  experimentSessionId?: string;
  pairingToleranceMs?: number;
  significantGapThresholdMs?: number;
}

interface VideoFrameCallbackMetadataLike {
  mediaTime?: number;
  presentedFrames?: number;
  presentationTime?: number;
  expectedDisplayTime?: number;
  processingDuration?: number;
}

interface TimingObserverHandle {
  kind: 'rvfc' | 'raf';
  id: number;
  video: HTMLVideoElement;
}

interface CreateObservationInput {
  recordingId: string;
  cameraRole: 'camera_a' | 'camera_b';
  sequence: number;
  experimentStartPerformanceNowMs: number;
  browserObservedPerformanceNowMs: number;
  browserObservedWallClockMs?: number;
  mediaTimeSeconds: number;
  observationMethod: RecordedCameraTimingObservation['observationMethod'];
  mediaTimestampSource: RecordedCameraTimingObservation['mediaTimestampSource'];
  presentedFrames?: number;
  previousPresentedFrames?: number;
  previousMediaTimeSeconds?: number;
  presentationTimePerformanceNowMs?: number;
  expectedDisplayTimePerformanceNowMs?: number;
  processingDurationMs?: number;
}

const EMPTY_DIAGNOSTICS: StereoRecordingDiagnostics = {
  recordingId: null,
  cameraAStatus: 'inactive',
  cameraBStatus: 'inactive',
  cameraAObservedFrameCount: 0,
  cameraBObservedFrameCount: 0,
  cameraASkippedPresentationFrames: 0,
  cameraBSkippedPresentationFrames: 0,
  cameraAEncodedFpsAvailable: false,
  cameraBEncodedFpsAvailable: false,
  durationMs: 0,
  cameraAMetadataAvailability: 'unavailable',
  cameraBMetadataAvailability: 'unavailable',
  synchronizationStatus: 'unknown',
};

export function calculateSkippedFrames(
  previousPresentedFrames: number | undefined,
  presentedFrames: number | undefined,
): number {
  if (
    previousPresentedFrames === undefined
    || presentedFrames === undefined
    || !Number.isFinite(previousPresentedFrames)
    || !Number.isFinite(presentedFrames)
  ) {
    return 0;
  }
  return Math.max(0, Math.floor(presentedFrames - previousPresentedFrames - 1));
}

export function createCameraTimingObservation(
  input: CreateObservationInput,
): RecordedCameraTimingObservation {
  const presentation: CameraPresentationMetadata = {
    presentedFrames: input.presentedFrames,
    presentationTimePerformanceNowMs: input.presentationTimePerformanceNowMs,
    expectedDisplayTimePerformanceNowMs: input.expectedDisplayTimePerformanceNowMs,
    processingDurationMs: input.processingDurationMs,
  };
  return {
    frameRef: `${input.recordingId}:${input.cameraRole}:${input.sequence}`,
    sequence: input.sequence,
    experimentTimeMs:
      input.browserObservedPerformanceNowMs - input.experimentStartPerformanceNowMs,
    mediaTimeSeconds: input.mediaTimeSeconds,
    browserObservedPerformanceNowMs: input.browserObservedPerformanceNowMs,
    browserObservedWallClockMs: input.browserObservedWallClockMs,
    presentation,
    observationMethod: input.observationMethod,
    mediaTimestampSource: input.mediaTimestampSource,
    skippedFramesSincePrevious: calculateSkippedFrames(
      input.previousPresentedFrames,
      input.presentedFrames,
    ),
    mediaTimeDeltaMs: input.previousMediaTimeSeconds === undefined
      ? undefined
      : (input.mediaTimeSeconds - input.previousMediaTimeSeconds) * 1000,
  };
}

function calculateMean(values: number[]): number | undefined {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : undefined;
}

function calculateStdDev(values: number[], mean: number | undefined): number | undefined {
  if (values.length === 0 || mean === undefined) return undefined;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
  );
}

export function summarizeCameraTiming(
  observations: RecordedCameraTimingObservation[],
  significantGapThresholdMs = DEFAULT_SIGNIFICANT_GAP_THRESHOLD_MS,
): CameraTimingSummary {
  if (observations.length === 0) {
    return {
      observedFrameCount: 0,
      frameGapCount: 0,
      skippedFrameCount: 0,
      significantGapCount: 0,
    };
  }

  const first = observations[0];
  const last = observations[observations.length - 1];
  const experimentIntervals = observations.slice(1).map(
    (observation, index) => observation.experimentTimeMs - observations[index].experimentTimeMs,
  );
  const meanInterval = calculateMean(experimentIntervals);
  const browserObservationElapsedSeconds =
    (last.browserObservedPerformanceNowMs - first.browserObservedPerformanceNowMs) / 1000;
  const mediaIntervals = observations.slice(1)
    .map(observation => observation.mediaTimeDeltaMs)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));

  return {
    observedFrameCount: observations.length,
    firstExperimentTimeMs: first.experimentTimeMs,
    lastExperimentTimeMs: last.experimentTimeMs,
    firstMediaTimeSeconds: first.mediaTimeSeconds,
    lastMediaTimeSeconds: last.mediaTimeSeconds,
    browserObservedCallbackFps:
      observations.length >= 2 && browserObservationElapsedSeconds > 0
        ? (observations.length - 1) / browserObservationElapsedSeconds
        : undefined,
    observedFrameRate: observations.length >= 2 && browserObservationElapsedSeconds > 0
      ? (observations.length - 1) / browserObservationElapsedSeconds
      : undefined,
    meanObservationIntervalMs: meanInterval,
    observationIntervalStdDevMs: calculateStdDev(experimentIntervals, meanInterval),
    frameGapCount: observations.filter(
      observation => observation.skippedFramesSincePrevious > 0,
    ).length,
    skippedFrameCount: observations.reduce(
      (sum, observation) => sum + observation.skippedFramesSincePrevious,
      0,
    ),
    largestObservationIntervalMs: experimentIntervals.length > 0
      ? Math.max(...experimentIntervals)
      : undefined,
    largestMediaTimeDeltaMs: mediaIntervals.length > 0
      ? Math.max(...mediaIntervals)
      : undefined,
    significantGapCount: observations.filter((observation, index) => {
      if (index === 0) return false;
      const browserGap =
        observation.experimentTimeMs - observations[index - 1].experimentTimeMs;
      return browserGap >= significantGapThresholdMs
        || (observation.mediaTimeDeltaMs ?? 0) >= significantGapThresholdMs;
    }).length,
  };
}

export function detectTimingDiscontinuities(
  observations: RecordedCameraTimingObservation[],
  thresholdMs = DEFAULT_SIGNIFICANT_GAP_THRESHOLD_MS,
): CameraTimingDiscontinuity[] {
  const discontinuities: CameraTimingDiscontinuity[] = [];
  for (let index = 1; index < observations.length; index += 1) {
    const previous = observations[index - 1];
    const current = observations[index];
    const browserGap =
      current.browserObservedPerformanceNowMs - previous.browserObservedPerformanceNowMs;
    const mediaGap = current.mediaTimeDeltaMs;
    if (
      browserGap >= thresholdMs
      || (mediaGap ?? 0) >= thresholdMs
    ) {
      discontinuities.push({
        afterSequence: previous.sequence,
        browserObservationGapMs: browserGap,
        cameraMediaTimeGapMs: mediaGap,
        skippedPresentationFrames: current.skippedFramesSincePrevious,
        thresholdMs,
      });
    }
  }
  return discontinuities;
}

export function createUnavailableCameraTimingSidecar(
  recordingId: string,
  cameraRole: 'camera_a' | 'camera_b',
  cameraId: string,
  experimentStartPerformanceNowMs: number,
  reason: string,
): CameraTimingSidecar {
  return {
    schemaVersion: '1.0.0-camera-timing',
    recordingId,
    cameraRole,
    cameraId,
    videoAssetId: `${recordingId}:${cameraRole}:video`,
    experimentStartPerformanceNowMs,
    metadataAvailability: 'unavailable',
    synchronizationStatus: 'unknown',
    limitation: reason,
    observations: [],
    summary: summarizeCameraTiming([]),
    significantGapThresholdMs: DEFAULT_SIGNIFICANT_GAP_THRESHOLD_MS,
    significantDiscontinuities: [],
    encodedVideoMetrics: {
      status: 'unavailable',
      reason:
        'Encoded frame count, FPS, and encoded timestamp gaps require independent container/frame analysis.',
      externalMeasurementRecommended: true,
    },
  };
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function nearestRankPercentile(values: number[], percentile: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[Math.min(sorted.length - 1, rank - 1)];
}

export function pairCameraObservationsOneToOne(
  cameraAObservations: RecordedCameraTimingObservation[],
  cameraBObservations: RecordedCameraTimingObservation[],
  toleranceMs = DEFAULT_PAIRING_TOLERANCE_MS,
): {
  matches: CameraObservationPair[];
  unmatchedCameraAObservationCount: number;
  unmatchedCameraBObservationCount: number;
} {
  const cameraA = [...cameraAObservations].sort(
    (a, b) => a.browserObservedPerformanceNowMs - b.browserObservedPerformanceNowMs,
  );
  const cameraB = [...cameraBObservations].sort(
    (a, b) => a.browserObservedPerformanceNowMs - b.browserObservedPerformanceNowMs,
  );
  const matches: CameraObservationPair[] = [];
  let unmatchedCameraAObservationCount = 0;
  let unmatchedCameraBObservationCount = 0;
  let indexA = 0;
  let indexB = 0;

  while (indexA < cameraA.length && indexB < cameraB.length) {
    const observationA = cameraA[indexA];
    const observationB = cameraB[indexB];
    const offset =
      observationB.browserObservedPerformanceNowMs
      - observationA.browserObservedPerformanceNowMs;

    if (Math.abs(offset) <= toleranceMs) {
      matches.push({
        cameraASequence: observationA.sequence,
        cameraBSequence: observationB.sequence,
        browserCallbackOffsetMs: offset,
      });
      indexA += 1;
      indexB += 1;
    } else if (observationA.browserObservedPerformanceNowMs < observationB.browserObservedPerformanceNowMs) {
      unmatchedCameraAObservationCount += 1;
      indexA += 1;
    } else {
      unmatchedCameraBObservationCount += 1;
      indexB += 1;
    }
  }

  unmatchedCameraAObservationCount += cameraA.length - indexA;
  unmatchedCameraBObservationCount += cameraB.length - indexB;

  return {
    matches,
    unmatchedCameraAObservationCount,
    unmatchedCameraBObservationCount,
  };
}

export function buildSynchronizationDiagnostics(
  recordingId: string,
  cameraA: CameraTimingSidecar,
  cameraB: CameraTimingSidecar,
  pairingToleranceMs = DEFAULT_PAIRING_TOLERANCE_MS,
  startupInstrumentation?: StereoRecorderInstrumentation,
): StereoSynchronizationDiagnostics {
  const pairing = pairCameraObservationsOneToOne(
    cameraA.observations,
    cameraB.observations,
    pairingToleranceMs,
  );
  const browserOffsets = pairing.matches.map(match => match.browserCallbackOffsetMs);
  const absoluteBrowserOffsets = browserOffsets.map(Math.abs);

  const maxAbs = (values: number[]): number | undefined => (
    values.length > 0 ? Math.max(...values.map(Math.abs)) : undefined
  );
  const maxBrowserOffset = maxAbs(browserOffsets);
  const bothFrameSpecific =
    cameraA.metadataAvailability === 'frame_specific'
    && cameraB.metadataAvailability === 'frame_specific';
  const status: SynchronizationStatus =
    cameraA.observations.length === 0
    || cameraB.observations.length === 0
    || pairing.matches.length === 0
      ? 'unknown'
      : 'unverified';

  return {
    recordingId,
    status,
    basis: 'one_to_one_browser_callback_receipt',
    browserPresentationAlignmentOnly: false,
    browserCallbackReceiptAlignmentOnly: true,
    hardwareExposureSynchronizationVerified: false,
    pairingPolicy: 'monotonic_one_to_one_greedy',
    pairingTimeBasis: 'browser_callback_receipt_performance_now',
    pairingToleranceMs,
    pairedObservationCount: browserOffsets.length,
    matchedObservationCount: browserOffsets.length,
    unmatchedCameraAObservationCount: pairing.unmatchedCameraAObservationCount,
    unmatchedCameraBObservationCount: pairing.unmatchedCameraBObservationCount,
    matchedPairs: pairing.matches,
    meanBrowserObservationOffsetMs: calculateMean(browserOffsets),
    meanAbsoluteBrowserObservationOffsetMs: calculateMean(absoluteBrowserOffsets),
    medianAbsoluteBrowserObservationOffsetMs: median(absoluteBrowserOffsets),
    p95AbsoluteBrowserObservationOffsetMs:
      nearestRankPercentile(absoluteBrowserOffsets, 0.95),
    maxAbsoluteBrowserObservationOffsetMs: maxBrowserOffset,
    cameraMediaTimeOriginsComparable: false,
    cameraPairMetadata: {
      status,
      cameraBMediaTimeBasis: cameraB.metadataAvailability === 'frame_specific'
        ? 'camera_b_frame_callback'
        : 'observed_current_time',
      cameraBFrameSynchronizationVerified: false,
      notes:
        `One-to-one browser callback receipt pairing with a ${pairingToleranceMs} ms tolerance. `
        + 'Raw camera media-time origins are not treated as synchronized. '
        + 'Camera exposure synchronization is not verified.',
    },
    startupInstrumentation,
    limitations: [
      'Pairing uses browser callback receipt performance.now() timestamps, not camera exposure timestamps.',
      'Browser callback timing can be delayed by main-thread work.',
      'Raw camera media timestamps are retained per camera but their origins are not assumed comparable.',
      'Browser presentation timing does not prove simultaneous camera exposure.',
      ...(bothFrameSpecific
        ? []
        : ['At least one camera lacks frame-specific requestVideoFrameCallback metadata.']),
    ],
  };
}

export function createExperimentClockMetadata(
  experimentStartPerformanceNowMs: number,
): ExperimentClockMetadata {
  return {
    authoritativeClock: 'live_performance_now',
    experimentTimeDefinition: 'milliseconds_relative_to_authoritative_origin',
    liveCaptureOrigin: {
      source: 'performance.now',
      originPerformanceNowMs: experimentStartPerformanceNowMs,
      browserTimeOriginEpochMs:
        typeof performance.timeOrigin === 'number' ? performance.timeOrigin : undefined,
    },
    browserReceiverClock: {
      monotonicSource: 'performance.now',
      browserTimeOriginEpochMs:
        typeof performance.timeOrigin === 'number' ? performance.timeOrigin : undefined,
      wallClockSource: 'Date.now',
      receiverTimestampPrecision: 'milliseconds',
    },
    relationships: [
      {
        fromClock: 'camera_a',
        toClock: 'experiment',
        status: 'unverified',
        method: 'Independent browser video-frame presentation observation',
      },
      {
        fromClock: 'camera_b',
        toClock: 'experiment',
        status: 'unverified',
        method: 'Independent browser video-frame presentation observation',
      },
    ],
  };
}

interface CreateRecordingInput {
  recordingId: string;
  name: string;
  startTime: number;
  duration: number;
  cam1Blob: Blob;
  cam2Blob: Blob;
  mimeType: string;
  experimentSessionId?: string;
  imuRecording?: IMURecordingSidecars;
  clockMetadata: ExperimentClockMetadata;
  cameraATiming: CameraTimingSidecar;
  cameraBTiming: CameraTimingSidecar;
  pairingToleranceMs?: number;
  startupInstrumentation?: StereoRecorderInstrumentation;
  cameraAEncodingStatus?: 'complete' | 'failed';
  cameraBEncodingStatus?: 'complete' | 'failed';
  errors?: string[];
}

export function classifyStereoRecordingStatus(
  cameraAEncodingStatus: 'complete' | 'failed',
  cameraBEncodingStatus: 'complete' | 'failed',
): 'complete' | 'partial' | 'failed' {
  if (cameraAEncodingStatus === 'complete' && cameraBEncodingStatus === 'complete') {
    return 'complete';
  }
  if (cameraAEncodingStatus === 'failed' && cameraBEncodingStatus === 'failed') {
    return 'failed';
  }
  return 'partial';
}

export function createStereoVideoRecording(
  input: CreateRecordingInput,
): StereoVideoRecording {
  const cameraAGapThreshold =
    input.cameraATiming.significantGapThresholdMs
    ?? DEFAULT_SIGNIFICANT_GAP_THRESHOLD_MS;
  const cameraBGapThreshold =
    input.cameraBTiming.significantGapThresholdMs
    ?? DEFAULT_SIGNIFICANT_GAP_THRESHOLD_MS;
  const cameraATiming: CameraTimingSidecar = {
    ...input.cameraATiming,
    limitation: input.cameraATiming.metadataAvailability === 'frame_specific'
      ? undefined
      : input.cameraATiming.limitation,
    summary: summarizeCameraTiming(
      input.cameraATiming.observations,
      cameraAGapThreshold,
    ),
    significantGapThresholdMs: cameraAGapThreshold,
    significantDiscontinuities: detectTimingDiscontinuities(
      input.cameraATiming.observations,
      cameraAGapThreshold,
    ),
  };
  const cameraBTiming: CameraTimingSidecar = {
    ...input.cameraBTiming,
    limitation: input.cameraBTiming.metadataAvailability === 'frame_specific'
      ? undefined
      : input.cameraBTiming.limitation,
    summary: summarizeCameraTiming(
      input.cameraBTiming.observations,
      cameraBGapThreshold,
    ),
    significantGapThresholdMs: cameraBGapThreshold,
    significantDiscontinuities: detectTimingDiscontinuities(
      input.cameraBTiming.observations,
      cameraBGapThreshold,
    ),
  };
  const errors = [...(input.errors ?? [])];
  if (input.cam1Blob.size === 0) errors.push('Camera A produced an empty video blob.');
  if (input.cam2Blob.size === 0) errors.push('Camera B produced an empty video blob.');
  const cameraAEncodingStatus = input.cam1Blob.size === 0
    ? 'failed' : (input.cameraAEncodingStatus ?? 'complete');
  const cameraBEncodingStatus = input.cam2Blob.size === 0
    ? 'failed' : (input.cameraBEncodingStatus ?? 'complete');
  const startupInstrumentation = input.startupInstrumentation ?? {
    recordingId: input.recordingId,
    experimentStartPerformanceNowMs:
      input.clockMetadata.liveCaptureOrigin?.originPerformanceNowMs ?? 0,
    cameraA: {},
    cameraB: {},
    notes: ['Startup instrumentation was not supplied by the recording runtime.'],
  };
  return {
    id: input.recordingId,
    name: input.name,
    startTime: input.startTime,
    duration: input.duration,
    cam1Blob: input.cam1Blob,
    cam2Blob: input.cam2Blob,
    mimeType: input.mimeType,
    experimentSessionId: input.experimentSessionId,
    clockMetadata: input.clockMetadata,
    ...(input.imuRecording ? {imuRecording: input.imuRecording} : {}),
    cameraATiming,
    cameraBTiming,
    synchronizationDiagnostics: buildSynchronizationDiagnostics(
      input.recordingId,
      cameraATiming,
      cameraBTiming,
      input.pairingToleranceMs,
      startupInstrumentation,
    ),
    startupInstrumentation,
    status: classifyStereoRecordingStatus(
      cameraAEncodingStatus,
      cameraBEncodingStatus,
    ),
    cameraAEncodingStatus,
    cameraBEncodingStatus,
    errors,
    limitations: [
      'Non-empty blobs and successful encoder completion do not verify video decodability or encoded frame coverage.',
      'Camera exposure synchronization is not verified.',
      ...[cameraATiming, cameraBTiming].flatMap(sidecar => [
        ...(sidecar.limitation ? [sidecar.cameraRole + ': ' + sidecar.limitation] : []),
        ...(sidecar.observations.length === 0
          ? [sidecar.cameraRole + ': no browser timing observations were recorded.'] : []),
      ]),
    ],
  };
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find(mimeType => MediaRecorder.isTypeSupported(mimeType)) ?? '';
}

function requestedFrameRateFromTrack(track: MediaStreamTrack | undefined): number | undefined {
  const constraint = track?.getConstraints().frameRate;
  if (typeof constraint === 'number') return constraint;
  if (constraint && typeof constraint === 'object') {
    if (typeof constraint.exact === 'number') return constraint.exact;
    if (typeof constraint.ideal === 'number') return constraint.ideal;
    if (typeof constraint.max === 'number') return constraint.max;
    if (typeof constraint.min === 'number') return constraint.min;
  }
  return undefined;
}

export function stopMediaRecorderSafely(
  recorder: Pick<MediaRecorder, 'state' | 'stop'> | null,
): boolean {
  if (!recorder || recorder.state === 'inactive') return false;
  try {
    recorder.stop();
    return true;
  } catch {
    return false;
  }
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function downloadJson(data: unknown, fileName: string): void {
  downloadBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    fileName,
  );
}

interface RecordingCameraSession {
  recorder: MediaRecorder | null;
  chunks: Blob[];
  sidecar: CameraTimingSidecar;
  timing: RecorderStartupTiming;
  observer: TimingObserverHandle | null;
  failed: boolean;
  started: boolean;
  settled: boolean;
}

interface RecordingSession {
  id: string;
  phase: 'starting' | 'recording' | 'stopping' | 'finalized';
  origin: number;
  wallStart: number;
  duration: number;
  experimentSessionId?: string;
  pairingToleranceMs: number;
  imuHandle?: IMURecordingHandle;
  imuSidecars?: IMURecordingSidecars;
  clock: ExperimentClockMetadata;
  instrumentation: StereoRecorderInstrumentation;
  cameras: [RecordingCameraSession, RecordingCameraSession];
  errors: string[];
  lastDiagnosticsUpdate: number;
  stop: (reason?: string) => Promise<StereoVideoRecording | null>;
}

/** Additive metadata in the existing clock download keeps the six-file bundle compatible. */
export function createRecordingClockExport(recording: StereoVideoRecording) {
  return {
    ...recording.clockMetadata,
    recordingId: recording.id,
    experimentSessionId: recording.experimentSessionId,
    recordingSummary: {
      status: recording.status,
      cameraAEncodingStatus: recording.cameraAEncodingStatus,
      cameraBEncodingStatus: recording.cameraBEncodingStatus,
      errors: [...recording.errors],
      limitations: [...recording.limitations, ...recording.synchronizationDiagnostics.limitations],
      durationMs: recording.duration,
      cameraAByteLength: recording.cam1Blob.size,
      cameraBByteLength: recording.cam2Blob.size,
      ...(recording.imuRecording ? {imuStreams: Object.fromEntries(
        Object.entries(recording.imuRecording).map(([id, stream]) => [id, {
          status: stream.status, packetCount: stream.diagnostics.packetCount,
          invalidPacketCount: stream.diagnostics.invalidPacketCount,
        }]),
      )} : {}),
      videoValidation: 'non_empty_blob_and_encoder_completion_only',
    },
  };
}

function cancelTimingObserver(camera: RecordingCameraSession) {
  const observer = camera.observer;
  camera.observer = null;
  if (!observer) return;
  try {
    if (observer.kind === 'rvfc') observer.video.cancelVideoFrameCallback(observer.id);
    else cancelAnimationFrame(observer.id);
  } catch {
    // The session phase also guards callbacks already queued by the browser.
  }
}

function sessionDiagnostics(session: RecordingSession): StereoRecordingDiagnostics {
  const [a, b] = session.cameras;
  const summaryA = summarizeCameraTiming(a.sidecar.observations, a.sidecar.significantGapThresholdMs);
  const summaryB = summarizeCameraTiming(b.sidecar.observations, b.sidecar.significantGapThresholdMs);
  const status = (camera: RecordingCameraSession): CameraRecordingStatus => camera.failed
    ? 'error' : session.phase === 'finalized' ? 'complete'
    : session.phase === 'stopping' ? 'stopping' : 'recording';
  return {
    recordingId: session.id,
    cameraAStatus: status(a), cameraBStatus: status(b),
    cameraAObservedFrameCount: summaryA.observedFrameCount,
    cameraBObservedFrameCount: summaryB.observedFrameCount,
    cameraARequestedFps: a.sidecar.requestedFrameRate,
    cameraBRequestedFps: b.sidecar.requestedFrameRate,
    cameraABrowserObservedCallbackFps: summaryA.browserObservedCallbackFps,
    cameraBBrowserObservedCallbackFps: summaryB.browserObservedCallbackFps,
    cameraASkippedPresentationFrames: summaryA.skippedFrameCount,
    cameraBSkippedPresentationFrames: summaryB.skippedFrameCount,
    cameraAEncodedFpsAvailable: a.sidecar.encodedVideoMetrics.status === 'measured_externally',
    cameraBEncodedFpsAvailable: b.sidecar.encodedVideoMetrics.status === 'measured_externally',
    durationMs: session.phase === 'starting' || session.phase === 'recording'
      ? Math.max(0, performance.now() - session.origin) : session.duration,
    cameraAMetadataAvailability: a.sidecar.metadataAvailability,
    cameraBMetadataAvailability: b.sidecar.metadataAvailability,
    synchronizationStatus: a.sidecar.observations.length && b.sidecar.observations.length
      ? 'unverified' : 'unknown',
  };
}

export function useStereoVideoRecorder(
  stream1: MediaStream | null,
  stream2: MediaStream | null,
  options: StereoVideoRecorderOptions = {},
) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordings, setRecordings] = useState<StereoVideoRecording[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recordingDiagnostics, setRecordingDiagnostics] =
    useState<StereoRecordingDiagnostics>(EMPTY_DIAGNOSTICS);
  const sessionRef = useRef<RecordingSession | null>(null);
  const mountedRef = useRef(true);
  const sequenceRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      if (session) void session.stop('Recording interrupted by component unmount.');
    };
  }, []);

  const updateDiagnostics = useCallback((session: RecordingSession, force = false) => {
    if (!mountedRef.current || sessionRef.current !== session) return;
    const now = performance.now();
    if (!force && now - session.lastDiagnosticsUpdate < 200) return;
    session.lastDiagnosticsUpdate = now;
    setRecordingDiagnostics(sessionDiagnostics(session));
  }, []);

  const startRecordingWithIdentity = useCallback((identity?: StereoRecordingIdentity) => {
    // Keep ownership until both encoders settle and the immutable output is built.
    if (!mountedRef.current || sessionRef.current) return null;
    if (!stream1 || !stream2) {
      setError('Both camera streams must be active before recording.');
      return null;
    }
    const wallStart = Date.now();
    const origin = performance.now();
    const id = identity?.recordingId ?? ('stereo_video_' + wallStart + '_' + sequenceRef.current++);
    const instrumentation: StereoRecorderInstrumentation = {
      recordingId: id, experimentStartPerformanceNowMs: origin,
      cameraA: {}, cameraB: {},
      notes: [
        'Times are relative to the shared performance.now() origin.',
        'MediaRecorder events and video callbacks are browser observations, not camera exposure timestamps.',
      ],
    };
    const cameras = [stream1, stream2].map((stream, index): RecordingCameraSession => {
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings();
      const config = index === 0 ? options.cameraA : options.cameraB;
      const role = index === 0 ? 'camera_a' : 'camera_b';
      const sidecar = createUnavailableCameraTimingSidecar(id, role,
        config?.cameraId || settings?.deviceId || track?.label || role + '_unknown',
        origin, 'Timing observer has not started.');
      sidecar.resolution = settings?.width && settings?.height
        ? { width: settings.width, height: settings.height } : undefined;
      sidecar.nominalFrameRate = settings?.frameRate;
      sidecar.trackReportedFrameRate = settings?.frameRate;
      sidecar.requestedFrameRate = requestedFrameRateFromTrack(track);
      sidecar.significantGapThresholdMs = options.significantGapThresholdMs
        ?? DEFAULT_SIGNIFICANT_GAP_THRESHOLD_MS;
      return {
        recorder: null, chunks: [], sidecar,
        timing: index === 0 ? instrumentation.cameraA : instrumentation.cameraB,
        observer: null, failed: false, started: false, settled: false,
      };
    }) as [RecordingCameraSession, RecordingCameraSession];
    const session: RecordingSession = {
      id, phase: 'starting', origin, wallStart, duration: 0,
      experimentSessionId: identity?.experimentSessionId ?? options.experimentSessionId,
      pairingToleranceMs: options.pairingToleranceMs ?? DEFAULT_PAIRING_TOLERANCE_MS,
      clock: createExperimentClockMetadata(origin), instrumentation, cameras,
      errors: [], lastDiagnosticsUpdate: 0,
      stop: () => Promise.resolve(null),
    };
    sessionRef.current = session;
    const onFinalized = options.onRecordingFinalized;
    let completion: Promise<StereoVideoRecording | null> | null = null;
    let resolveCompletion: (recording: StereoVideoRecording | null) => void = () => {};
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const fail = (camera: RecordingCameraSession, message: string) => {
      if (session.phase === 'finalized') return;
      camera.failed = true;
      if (!session.errors.includes(message)) session.errors.push(message);
      if (mountedRef.current && sessionRef.current === session) setError(message);
    };
    const finalize = () => {
      if (session.phase !== 'stopping' || cameras.some(camera => !camera.settled)) return;
      session.phase = 'finalized';
      clearTimeout(timeout);
      const blobs = cameras.map(camera => new Blob(camera.chunks,
        { type: camera.recorder?.mimeType || 'video/webm' }));
      const recording = createStereoVideoRecording({
        recordingId: id, name: 'StereoCapture_' + new Date(wallStart).toLocaleString(),
        startTime: wallStart, duration: session.duration,
        cam1Blob: blobs[0], cam2Blob: blobs[1], mimeType: blobs[0].type,
        experimentSessionId: session.experimentSessionId, clockMetadata: session.clock,
        cameraATiming: cameras[0].sidecar, cameraBTiming: cameras[1].sidecar,
        pairingToleranceMs: session.pairingToleranceMs, startupInstrumentation: instrumentation,
        cameraAEncodingStatus: cameras[0].failed ? 'failed' : 'complete',
        cameraBEncodingStatus: cameras[1].failed ? 'failed' : 'complete',
        errors: session.errors, imuRecording: session.imuSidecars,
      });
      cameras[0].failed = recording.cameraAEncodingStatus === 'failed';
      cameras[1].failed = recording.cameraBEncodingStatus === 'failed';
      for (const camera of cameras) {
        cancelTimingObserver(camera);
        if (camera.recorder) {
          camera.recorder.ondataavailable = null;
          camera.recorder.onstart = null;
          camera.recorder.onstop = null;
          camera.recorder.onerror = null;
        }
        camera.chunks = [];
      }
      if (mountedRef.current && sessionRef.current === session) {
        setRecordings(previous => [recording, ...previous]);
        setIsRecording(false);
        setRecordingDiagnostics({
          ...sessionDiagnostics(session),
          synchronizationStatus: recording.synchronizationDiagnostics.status,
        });
        if (recording.errors.length) setError(recording.errors.join(' '));
      }
      if (sessionRef.current === session) sessionRef.current = null;
      resolveCompletion(recording);
      try { onFinalized?.(recording); }
      catch (cause) {
        if (mountedRef.current) setError('Session metadata finalization failed: ' + (cause as Error).message);
      }
    };
    session.stop = (reason?: string) => {
      if (completion) return completion;
      completion = new Promise(resolve => { resolveCompletion = resolve; });
      session.phase = 'stopping';
      const stopPerformanceNowMs = performance.now();
      session.duration = Math.max(0, stopPerformanceNowMs - origin);
      session.imuSidecars = session.imuHandle?.stop({
        endPerformanceNowMs: stopPerformanceNowMs,
        reason: reason ?? (session.errors.length ? 'camera_error' : 'user_stop'),
      });
      for (const camera of cameras) {
        cancelTimingObserver(camera);
        if (reason) fail(camera, reason);
      }
      updateDiagnostics(session, true);
      timeout = setTimeout(() => {
        cameras.forEach((camera, index) => {
          if (camera.settled) return;
          fail(camera, 'Camera ' + (index === 0 ? 'A' : 'B') + ' MediaRecorder stop timed out.');
          stopMediaRecorderSafely(camera.recorder);
          camera.settled = true;
        });
        finalize();
      }, RECORDER_STOP_TIMEOUT_MS);
      cameras.forEach((camera, index) => {
        if (!camera.recorder || !camera.started) {
          camera.settled = true;
        } else if (!camera.settled && camera.recorder.state !== 'inactive') {
          camera.timing.stopCallExperimentTimeMs = performance.now() - origin;
          try { camera.recorder.stop(); }
          catch (caughtError) {
            fail(camera, 'Camera ' + (index === 0 ? 'A' : 'B')
              + ' MediaRecorder stop failed: ' + (caughtError as Error).message);
            // Retry best-effort cleanup; the timeout bounds missing stop events.
            stopMediaRecorderSafely(camera.recorder);
          }
        }
        // Inactive encoders may still have final data/stop events queued. Wait for onstop.
      });
      finalize();
      return completion;
    };

    const startObserver = (camera: RecordingCameraSession, video: HTMLVideoElement | null) => {
      const sidecar = camera.sidecar;
      camera.timing.timingObserverRegisteredExperimentTimeMs = performance.now() - origin;
      if (!video) {
        sidecar.limitation = 'No video element was available when recording started.';
        return;
      }
      if (!sidecar.resolution && video.videoWidth > 0 && video.videoHeight > 0) {
        sidecar.resolution = { width: video.videoWidth, height: video.videoHeight };
      }
      let previousPresentedFrames: number | undefined;
      let previousMediaTimeSeconds: number | undefined;
      let lastMediaTime = -1;
      const rvfc = typeof video.requestVideoFrameCallback === 'function';
      sidecar.metadataAvailability = rvfc ? 'frame_specific' : 'fallback_current_time';
      sidecar.synchronizationStatus = 'unverified';
      sidecar.limitation = rvfc ? undefined
        : 'requestVideoFrameCallback unavailable; video.currentTime observations are not frame-specific.';
      const active = () => session.phase === 'recording' && sessionRef.current === session;
      const schedule = () => {
        if (!active()) return;
        const callback = (_now: number, rawMetadata?: unknown) => {
          if (!active()) return;
          const metadata = (rawMetadata ?? {}) as VideoFrameCallbackMetadataLike;
          if (rvfc || video.currentTime !== lastMediaTime) {
            lastMediaTime = video.currentTime;
            const hasMediaTime = Number.isFinite(metadata.mediaTime);
            const mediaTimeSeconds = hasMediaTime ? metadata.mediaTime! : video.currentTime;
            const observation = createCameraTimingObservation({
              recordingId: id, cameraRole: sidecar.cameraRole,
              sequence: sidecar.observations.length,
              experimentStartPerformanceNowMs: origin,
              browserObservedPerformanceNowMs: performance.now(), browserObservedWallClockMs: Date.now(),
              mediaTimeSeconds, previousMediaTimeSeconds, previousPresentedFrames,
              observationMethod: rvfc ? 'request_video_frame_callback' : 'request_animation_frame_current_time',
              mediaTimestampSource: hasMediaTime ? 'rvfc_media_time' : 'video_current_time',
              presentedFrames: metadata.presentedFrames,
              presentationTimePerformanceNowMs: metadata.presentationTime,
              expectedDisplayTimePerformanceNowMs: metadata.expectedDisplayTime,
              processingDurationMs: metadata.processingDuration === undefined
                ? undefined : metadata.processingDuration * 1000,
            });
            sidecar.observations.push(observation);
            camera.timing.firstTimingObservationExperimentTimeMs ??= observation.experimentTimeMs;
            previousPresentedFrames = metadata.presentedFrames;
            previousMediaTimeSeconds = mediaTimeSeconds;
            updateDiagnostics(session);
          }
          schedule();
        };
        camera.observer = rvfc
          ? { kind: 'rvfc', video, id: video.requestVideoFrameCallback(callback) }
          : { kind: 'raf', video, id: requestAnimationFrame(callback) };
      };
      schedule();
    };

    setError(null);
    setIsRecording(true);
    try {
      session.imuHandle = options.imuRecordingSource?.start({
        recordingId: id, experimentSessionId: session.experimentSessionId,
        experimentStartPerformanceNowMs: origin, startTime: wallStart, clockMetadata: session.clock,
      });
      const mimeType = pickMimeType();
      const recorderOptions = mimeType ? { mimeType } : {};
      cameras.forEach((camera, index) => {
        const label = index === 0 ? 'A' : 'B';
        const recorder = new MediaRecorder(index === 0 ? stream1 : stream2, recorderOptions);
        camera.recorder = recorder;
        recorder.ondataavailable = event => {
          if (session.phase === 'finalized' || camera.settled || event.data.size === 0) return;
          camera.chunks.push(event.data);
          camera.timing.lastDataAvailableExperimentTimeMs = performance.now() - origin;
          camera.timing.firstDataAvailableExperimentTimeMs ??= performance.now() - origin;
        };
        recorder.onstart = () => {
          if (session.phase !== 'finalized') camera.timing.startEventExperimentTimeMs = performance.now() - origin;
        };
        recorder.onerror = () => {
          if (session.phase === 'finalized') return;
          fail(camera, 'Camera ' + label + ' MediaRecorder reported an encoding error.');
          void session.stop();
          updateDiagnostics(session, true);
        };
        recorder.onstop = () => {
          if (session.phase === 'finalized') return;
          camera.timing.stopEventExperimentTimeMs = performance.now() - origin;
          camera.settled = true;
          if (session.phase !== 'stopping') {
            fail(camera, 'Camera ' + label + ' MediaRecorder stopped unexpectedly.');
            void session.stop();
          }
          finalize();
        };
      });
      cameras.forEach(camera => {
        if (session.phase !== 'starting') return;
        camera.timing.startCallExperimentTimeMs = performance.now() - origin;
        camera.recorder!.start(100);
        camera.started = true;
      });
      if (session.phase === 'starting') {
        session.phase = 'recording';
        startObserver(cameras[0], options.cameraA?.videoRef?.current ?? null);
        startObserver(cameras[1], options.cameraB?.videoRef?.current ?? null);
        updateDiagnostics(session, true);
      }
    } catch (caughtError) {
      for (const camera of cameras) fail(camera, 'Failed to start recording: ' + (caughtError as Error).message);
      void session.stop();
    }
    return {recordingId: id, originPerformanceNowMs: origin, clockMetadata: session.clock};
  }, [stream1, stream2, options, updateDiagnostics]);

  const startRecording = useCallback(() => startRecordingWithIdentity(), [startRecordingWithIdentity]);
  const getRecordingProgress = useCallback((): StereoRecordingProgress | null => {
    const session = sessionRef.current;
    if (!session) return null;
    return {
      recordingId: session.id, originPerformanceNowMs: session.origin, phase: session.phase,
      diagnostics: sessionDiagnostics(session), instrumentation: structuredClone(session.instrumentation),
      imu: session.imuHandle?.getProgress?.() ?? null,
    };
  }, []);

  const stopRecording = useCallback((): Promise<StereoVideoRecording | null> => (
    sessionRef.current?.stop() ?? Promise.resolve(null)
  ), []);

  const downloadRecording = useCallback((recording: StereoVideoRecording) => {
    const extension = recording.mimeType.includes('mp4') ? 'mp4' : 'webm';
    const safeName = recording.name.replace(/[^a-z0-9]/gi, '_');
    downloadBlob(recording.cam1Blob, safeName + '_cam1.' + extension);
    downloadBlob(recording.cam2Blob, safeName + '_cam2.' + extension);
    downloadJson(recording.cameraATiming, safeName + '_camera_a_timing.json');
    downloadJson(recording.cameraBTiming, safeName + '_camera_b_timing.json');
    downloadJson(createRecordingClockExport(recording), safeName + '_recording_clock.json');
    downloadJson(recording.synchronizationDiagnostics, safeName + '_camera_sync_diagnostics.json');
    if (recording.imuRecording) {
      downloadJson(recording.imuRecording.imu_01, safeName + '_imu_01.json');
      downloadJson(recording.imuRecording.imu_02, safeName + '_imu_02.json');
    }
  }, []);

  const deleteRecording = useCallback((id: string) => {
    setRecordings(previous => previous.filter(recording => recording.id !== id));
  }, []);

  return {
    isRecording, recordings, error, recordingDiagnostics,
    startRecording, startRecordingWithIdentity, getRecordingProgress, stopRecording, downloadRecording, deleteRecording,
  };
}
