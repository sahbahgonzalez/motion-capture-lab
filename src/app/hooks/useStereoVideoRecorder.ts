import {
  useCallback,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type {
  CameraPairTimingMetadata,
  CameraPresentationMetadata,
  CameraTimestampObservation,
  ExperimentClockMetadata,
  SynchronizationStatus,
} from '../type/experiment';

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
  clockMetadata: ExperimentClockMetadata;
  cameraATiming: CameraTimingSidecar;
  cameraBTiming: CameraTimingSidecar;
  synchronizationDiagnostics: StereoSynchronizationDiagnostics;
  startupInstrumentation: StereoRecorderInstrumentation;
  status: 'complete' | 'partial' | 'failed';
  cameraAEncodingStatus: 'complete' | 'failed';
  cameraBEncodingStatus: 'complete' | 'failed';
  errors: string[];
}

export interface StereoVideoRecorderOptions {
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
        || (observation.mediaTimeDeltaMs ?? 0) >= significantGapThresholdMs
        || observation.skippedFramesSincePrevious > 0;
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
      || current.skippedFramesSincePrevious > 0
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
  const cameraAEncodingStatus = input.cameraAEncodingStatus ?? 'complete';
  const cameraBEncodingStatus = input.cameraBEncodingStatus ?? 'complete';
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
    errors: input.errors ?? [],
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

  const isRecordingRef = useRef(false);
  const rec1Ref = useRef<MediaRecorder | null>(null);
  const rec2Ref = useRef<MediaRecorder | null>(null);
  const chunks1Ref = useRef<Blob[]>([]);
  const chunks2Ref = useRef<Blob[]>([]);
  const startWallClockRef = useRef(0);
  const experimentStartRef = useRef(0);
  const recordingIdRef = useRef<string | null>(null);
  const clockMetadataRef = useRef<ExperimentClockMetadata | null>(null);
  const cameraASidecarRef = useRef<CameraTimingSidecar | null>(null);
  const cameraBSidecarRef = useRef<CameraTimingSidecar | null>(null);
  const cameraAObserverRef = useRef<TimingObserverHandle | null>(null);
  const cameraBObserverRef = useRef<TimingObserverHandle | null>(null);
  const startupInstrumentationRef = useRef<StereoRecorderInstrumentation | null>(null);
  const cameraEncodingFailureRef = useRef({ cameraA: false, cameraB: false });
  const recordingErrorsRef = useRef<string[]>([]);
  const lastDiagnosticsUpdateRef = useRef(0);

  const updateLiveDiagnostics = useCallback((
    cameraAStatus: CameraRecordingStatus = 'recording',
    cameraBStatus: CameraRecordingStatus = 'recording',
  ) => {
    const now = performance.now();
    if (
      cameraAStatus === 'recording'
      && cameraBStatus === 'recording'
      && now - lastDiagnosticsUpdateRef.current < 200
    ) {
      return;
    }
    lastDiagnosticsUpdateRef.current = now;
    const cameraA = cameraASidecarRef.current;
    const cameraB = cameraBSidecarRef.current;
    const cameraASummary = cameraA
      ? summarizeCameraTiming(
          cameraA.observations,
          cameraA.significantGapThresholdMs,
        )
      : null;
    const cameraBSummary = cameraB
      ? summarizeCameraTiming(
          cameraB.observations,
          cameraB.significantGapThresholdMs,
        )
      : null;
    setRecordingDiagnostics({
      recordingId: recordingIdRef.current,
      cameraAStatus,
      cameraBStatus,
      cameraAObservedFrameCount: cameraA?.observations.length ?? 0,
      cameraBObservedFrameCount: cameraB?.observations.length ?? 0,
      cameraARequestedFps: cameraA?.requestedFrameRate,
      cameraBRequestedFps: cameraB?.requestedFrameRate,
      cameraABrowserObservedCallbackFps:
        cameraASummary?.browserObservedCallbackFps,
      cameraBBrowserObservedCallbackFps:
        cameraBSummary?.browserObservedCallbackFps,
      cameraASkippedPresentationFrames:
        cameraASummary?.skippedFrameCount ?? 0,
      cameraBSkippedPresentationFrames:
        cameraBSummary?.skippedFrameCount ?? 0,
      cameraAEncodedFpsAvailable:
        cameraA?.encodedVideoMetrics.status === 'measured_externally',
      cameraBEncodedFpsAvailable:
        cameraB?.encodedVideoMetrics.status === 'measured_externally',
      durationMs: isRecordingRef.current
        ? Math.max(0, now - experimentStartRef.current)
        : 0,
      cameraAMetadataAvailability: cameraA?.metadataAvailability ?? 'unavailable',
      cameraBMetadataAvailability: cameraB?.metadataAvailability ?? 'unavailable',
      synchronizationStatus:
        cameraA?.observations.length && cameraB?.observations.length
          ? 'unverified'
          : 'unknown',
    });
  }, []);

  const cancelObserver = useCallback((observer: TimingObserverHandle | null) => {
    if (!observer) return;
    try {
      if (observer.kind === 'rvfc') {
        observer.video.cancelVideoFrameCallback(observer.id);
      } else {
        cancelAnimationFrame(observer.id);
      }
    } catch {
      // Cleanup is best-effort; the active flag still prevents new observations.
    }
  }, []);

  const startTimingObserver = useCallback((
    video: HTMLVideoElement | null,
    cameraRole: 'camera_a' | 'camera_b',
    sidecar: CameraTimingSidecar,
    observerRef: MutableRefObject<TimingObserverHandle | null>,
  ) => {
    const sidecarRef = cameraRole === 'camera_a' ? cameraASidecarRef : cameraBSidecarRef;
    const startupTiming = cameraRole === 'camera_a'
      ? startupInstrumentationRef.current?.cameraA
      : startupInstrumentationRef.current?.cameraB;
    if (startupTiming) {
      startupTiming.timingObserverRegisteredExperimentTimeMs =
        performance.now() - sidecar.experimentStartPerformanceNowMs;
    }
    sidecarRef.current = sidecar;
    if (!video) {
      sidecar.metadataAvailability = 'unavailable';
      sidecar.synchronizationStatus = 'unknown';
      sidecar.limitation = 'No video element was available when recording started.';
      updateLiveDiagnostics();
      return;
    }
    if (!sidecar.resolution && video.videoWidth > 0 && video.videoHeight > 0) {
      sidecar.resolution = {
        width: video.videoWidth,
        height: video.videoHeight,
      };
    }

    let previousPresentedFrames: number | undefined;
    let previousMediaTimeSeconds: number | undefined;

    const pushObservation = (
      observedPerformanceNowMs: number,
      mediaTimeSeconds: number,
      method: RecordedCameraTimingObservation['observationMethod'],
      mediaTimestampSource: RecordedCameraTimingObservation['mediaTimestampSource'],
      metadata?: VideoFrameCallbackMetadataLike,
    ) => {
      if (!isRecordingRef.current || !sidecarRef.current) return;
      const observation = createCameraTimingObservation({
        recordingId: sidecar.recordingId,
        cameraRole,
        sequence: sidecarRef.current.observations.length,
        experimentStartPerformanceNowMs: sidecar.experimentStartPerformanceNowMs,
        browserObservedPerformanceNowMs: observedPerformanceNowMs,
        browserObservedWallClockMs: Date.now(),
        mediaTimeSeconds,
        observationMethod: method,
        mediaTimestampSource,
        presentedFrames: metadata?.presentedFrames,
        previousPresentedFrames,
        previousMediaTimeSeconds,
        presentationTimePerformanceNowMs: metadata?.presentationTime,
        expectedDisplayTimePerformanceNowMs: metadata?.expectedDisplayTime,
        processingDurationMs: metadata?.processingDuration === undefined
          ? undefined
          : metadata.processingDuration * 1000,
      });
      sidecarRef.current.observations.push(observation);
      if (
        startupTiming
        && startupTiming.firstTimingObservationExperimentTimeMs === undefined
      ) {
        startupTiming.firstTimingObservationExperimentTimeMs =
          observation.experimentTimeMs;
      }
      previousPresentedFrames = metadata?.presentedFrames;
      previousMediaTimeSeconds = mediaTimeSeconds;
      updateLiveDiagnostics();
    };

    if (typeof video.requestVideoFrameCallback === 'function') {
      sidecar.metadataAvailability = 'frame_specific';
      sidecar.synchronizationStatus = 'unverified';
      sidecar.limitation = undefined;
      const schedule = () => {
        const id = video.requestVideoFrameCallback((_now, rawMetadata) => {
          if (!isRecordingRef.current) return;
          const metadata = (rawMetadata ?? {}) as VideoFrameCallbackMetadataLike;
          const hasMediaTime = Number.isFinite(metadata.mediaTime);
          pushObservation(
            performance.now(),
            hasMediaTime ? metadata.mediaTime! : video.currentTime,
            'request_video_frame_callback',
            hasMediaTime ? 'rvfc_media_time' : 'video_current_time',
            metadata,
          );
          schedule();
        });
        observerRef.current = { kind: 'rvfc', id, video };
      };
      schedule();
      return;
    }

    sidecar.metadataAvailability = 'fallback_current_time';
    sidecar.synchronizationStatus = 'unverified';
    sidecar.limitation =
      'requestVideoFrameCallback is unavailable; observations use requestAnimationFrame and video.currentTime and are not frame-specific.';
    let lastMediaTime = -1;
    const scheduleFallback = () => {
      const id = requestAnimationFrame(() => {
        if (!isRecordingRef.current) return;
        if (video.currentTime !== lastMediaTime) {
          lastMediaTime = video.currentTime;
          pushObservation(
            performance.now(),
            video.currentTime,
            'request_animation_frame_current_time',
            'video_current_time',
          );
        }
        scheduleFallback();
      });
      observerRef.current = { kind: 'raf', id, video };
    };
    scheduleFallback();
  }, [updateLiveDiagnostics]);

  const startRecording = useCallback(() => {
    if (!stream1 || !stream2) {
      setError('Both camera streams must be active before recording.');
      return;
    }
    if (isRecordingRef.current) return;

    const mimeType = pickMimeType();
    const mediaRecorderOptions = mimeType ? { mimeType } : {};
    const wallClockStart = Date.now();
    const experimentStartPerformanceNowMs = performance.now();
    const recordingId = `stereo_video_${wallClockStart}`;
    const cameraAId =
      options.cameraA?.cameraId
      || stream1.getVideoTracks()[0]?.getSettings().deviceId
      || stream1.getVideoTracks()[0]?.label
      || 'camera_a_unknown';
    const cameraBId =
      options.cameraB?.cameraId
      || stream2.getVideoTracks()[0]?.getSettings().deviceId
      || stream2.getVideoTracks()[0]?.label
      || 'camera_b_unknown';
    startWallClockRef.current = wallClockStart;
    experimentStartRef.current = experimentStartPerformanceNowMs;
    recordingIdRef.current = recordingId;
    clockMetadataRef.current = createExperimentClockMetadata(
      experimentStartPerformanceNowMs,
    );
    lastDiagnosticsUpdateRef.current = 0;
    cameraEncodingFailureRef.current = { cameraA: false, cameraB: false };
    recordingErrorsRef.current = [];
    chunks1Ref.current = [];
    chunks2Ref.current = [];
    startupInstrumentationRef.current = {
      recordingId,
      experimentStartPerformanceNowMs,
      cameraA: {},
      cameraB: {},
      notes: [
        'Times are relative to the shared performance.now() origin.',
        'MediaRecorder events and video-frame callbacks are browser/main-thread observations, not camera exposure timestamps.',
      ],
    };
    cameraASidecarRef.current = createUnavailableCameraTimingSidecar(
      recordingId,
      'camera_a',
      cameraAId,
      experimentStartPerformanceNowMs,
      'Timing observer has not started.',
    );
    cameraBSidecarRef.current = createUnavailableCameraTimingSidecar(
      recordingId,
      'camera_b',
      cameraBId,
      experimentStartPerformanceNowMs,
      'Timing observer has not started.',
    );
    const cameraASettings = stream1.getVideoTracks()[0]?.getSettings();
    const cameraBSettings = stream2.getVideoTracks()[0]?.getSettings();
    cameraASidecarRef.current.resolution = cameraASettings?.width && cameraASettings?.height
      ? { width: cameraASettings.width, height: cameraASettings.height }
      : undefined;
    cameraASidecarRef.current.nominalFrameRate = cameraASettings?.frameRate;
    cameraASidecarRef.current.trackReportedFrameRate = cameraASettings?.frameRate;
    cameraASidecarRef.current.requestedFrameRate =
      requestedFrameRateFromTrack(stream1.getVideoTracks()[0]);
    cameraBSidecarRef.current.resolution = cameraBSettings?.width && cameraBSettings?.height
      ? { width: cameraBSettings.width, height: cameraBSettings.height }
      : undefined;
    cameraBSidecarRef.current.nominalFrameRate = cameraBSettings?.frameRate;
    cameraBSidecarRef.current.trackReportedFrameRate = cameraBSettings?.frameRate;
    cameraBSidecarRef.current.requestedFrameRate =
      requestedFrameRateFromTrack(stream2.getVideoTracks()[0]);
    const significantGapThresholdMs =
      options.significantGapThresholdMs ?? DEFAULT_SIGNIFICANT_GAP_THRESHOLD_MS;
    cameraASidecarRef.current.significantGapThresholdMs = significantGapThresholdMs;
    cameraBSidecarRef.current.significantGapThresholdMs = significantGapThresholdMs;
    let recorderA: MediaRecorder | null = null;
    let recorderB: MediaRecorder | null = null;

    try {
      recorderA = new MediaRecorder(stream1, mediaRecorderOptions);
      recorderB = new MediaRecorder(stream2, mediaRecorderOptions);

      recorderA.ondataavailable = event => {
        if (event.data.size > 0) {
          chunks1Ref.current.push(event.data);
          const timing = startupInstrumentationRef.current?.cameraA;
          if (timing && timing.firstDataAvailableExperimentTimeMs === undefined) {
            timing.firstDataAvailableExperimentTimeMs =
              performance.now() - experimentStartPerformanceNowMs;
          }
        }
      };
      recorderB.ondataavailable = event => {
        if (event.data.size > 0) {
          chunks2Ref.current.push(event.data);
          const timing = startupInstrumentationRef.current?.cameraB;
          if (timing && timing.firstDataAvailableExperimentTimeMs === undefined) {
            timing.firstDataAvailableExperimentTimeMs =
              performance.now() - experimentStartPerformanceNowMs;
          }
        }
      };
      recorderA.onstart = () => {
        const timing = startupInstrumentationRef.current?.cameraA;
        if (timing) {
          timing.startEventExperimentTimeMs =
            performance.now() - experimentStartPerformanceNowMs;
        }
      };
      recorderB.onstart = () => {
        const timing = startupInstrumentationRef.current?.cameraB;
        if (timing) {
          timing.startEventExperimentTimeMs =
            performance.now() - experimentStartPerformanceNowMs;
        }
      };
      recorderA.onerror = () => {
        const message = 'Camera A MediaRecorder reported an encoding error.';
        cameraEncodingFailureRef.current.cameraA = true;
        recordingErrorsRef.current.push(message);
        setError(message);
        setRecordingDiagnostics(previous => ({
          ...previous,
          cameraAStatus: 'error',
        }));
      };
      recorderB.onerror = () => {
        const message = 'Camera B MediaRecorder reported an encoding error.';
        cameraEncodingFailureRef.current.cameraB = true;
        recordingErrorsRef.current.push(message);
        setError(message);
        setRecordingDiagnostics(previous => ({
          ...previous,
          cameraBStatus: 'error',
        }));
      };

      rec1Ref.current = recorderA;
      rec2Ref.current = recorderB;
      isRecordingRef.current = true;

      // Both encoders and both timing observers use the same monotonic origin.
      startupInstrumentationRef.current.cameraA.startCallExperimentTimeMs =
        performance.now() - experimentStartPerformanceNowMs;
      recorderA.start(100);
      startupInstrumentationRef.current.cameraB.startCallExperimentTimeMs =
        performance.now() - experimentStartPerformanceNowMs;
      recorderB.start(100);
      startTimingObserver(
        options.cameraA?.videoRef?.current ?? null,
        'camera_a',
        cameraASidecarRef.current,
        cameraAObserverRef,
      );
      startTimingObserver(
        options.cameraB?.videoRef?.current ?? null,
        'camera_b',
        cameraBSidecarRef.current,
        cameraBObserverRef,
      );

      setIsRecording(true);
      setError(null);
      updateLiveDiagnostics('recording', 'recording');
    } catch (caughtError) {
      isRecordingRef.current = false;
      cancelObserver(cameraAObserverRef.current);
      cancelObserver(cameraBObserverRef.current);
      cameraAObserverRef.current = null;
      cameraBObserverRef.current = null;
      stopMediaRecorderSafely(recorderA);
      stopMediaRecorderSafely(recorderB);
      rec1Ref.current = null;
      rec2Ref.current = null;
      const message = `Failed to start recording: ${(caughtError as Error).message}`;
      recordingErrorsRef.current.push(message);
      setError(message);
      setIsRecording(false);
      setRecordingDiagnostics({
        recordingId: recordingIdRef.current,
        cameraAStatus: 'error',
        cameraBStatus: 'error',
        cameraAObservedFrameCount: cameraASidecarRef.current?.observations.length ?? 0,
        cameraBObservedFrameCount: cameraBSidecarRef.current?.observations.length ?? 0,
        cameraARequestedFps: cameraASidecarRef.current?.requestedFrameRate,
        cameraBRequestedFps: cameraBSidecarRef.current?.requestedFrameRate,
        cameraASkippedPresentationFrames: 0,
        cameraBSkippedPresentationFrames: 0,
        cameraAEncodedFpsAvailable: false,
        cameraBEncodedFpsAvailable: false,
        durationMs: Math.max(0, performance.now() - experimentStartRef.current),
        cameraAMetadataAvailability:
          cameraASidecarRef.current?.metadataAvailability ?? 'unavailable',
        cameraBMetadataAvailability:
          cameraBSidecarRef.current?.metadataAvailability ?? 'unavailable',
        synchronizationStatus: 'unknown',
      });
    }
  }, [
    stream1,
    stream2,
    options,
    cancelObserver,
    startTimingObserver,
    updateLiveDiagnostics,
  ]);

  const stopRecording = useCallback((): Promise<StereoVideoRecording | null> => (
    new Promise(resolve => {
      const recorderA = rec1Ref.current;
      const recorderB = rec2Ref.current;
      if (!recorderA || !recorderB || !isRecordingRef.current) {
        resolve(null);
        return;
      }

      isRecordingRef.current = false;
      const duration = Math.max(0, performance.now() - experimentStartRef.current);
      cancelObserver(cameraAObserverRef.current);
      cancelObserver(cameraBObserverRef.current);
      cameraAObserverRef.current = null;
      cameraBObserverRef.current = null;
      updateLiveDiagnostics('stopping', 'stopping');

      let finalized = false;
      let cameraASettled = false;
      let cameraBSettled = false;
      let stopTimeout: ReturnType<typeof setTimeout> | null = null;

      const finalize = () => {
        if (finalized || !cameraASettled || !cameraBSettled) return;
        finalized = true;
        if (stopTimeout) clearTimeout(stopTimeout);

        const recordingId = recordingIdRef.current;
        const clockMetadata = clockMetadataRef.current;
        const cameraATiming = cameraASidecarRef.current;
        const cameraBTiming = cameraBSidecarRef.current;
        if (!recordingId || !clockMetadata || !cameraATiming || !cameraBTiming) {
          setError('Recording timing metadata was unavailable during finalization.');
          setIsRecording(false);
          rec1Ref.current = null;
          rec2Ref.current = null;
          resolve(null);
          return;
        }

        const resolvedMimeType = recorderA.mimeType || 'video/webm';
        const cameraAEncodingStatus = cameraEncodingFailureRef.current.cameraA
          ? 'failed'
          : 'complete';
        const cameraBEncodingStatus = cameraEncodingFailureRef.current.cameraB
          ? 'failed'
          : 'complete';
        const recording = createStereoVideoRecording({
          recordingId,
          name: `StereoCapture_${new Date(startWallClockRef.current).toLocaleString()}`,
          startTime: startWallClockRef.current,
          duration,
          cam1Blob: new Blob(chunks1Ref.current, { type: resolvedMimeType }),
          cam2Blob: new Blob(chunks2Ref.current, { type: resolvedMimeType }),
          mimeType: resolvedMimeType,
          experimentSessionId: options.experimentSessionId,
          clockMetadata,
          cameraATiming,
          cameraBTiming,
          pairingToleranceMs:
            options.pairingToleranceMs ?? DEFAULT_PAIRING_TOLERANCE_MS,
          startupInstrumentation: startupInstrumentationRef.current ?? undefined,
          cameraAEncodingStatus,
          cameraBEncodingStatus,
          errors: [...recordingErrorsRef.current],
        });

        setRecordings(previous => [recording, ...previous]);
        setIsRecording(false);
        setRecordingDiagnostics({
          recordingId,
          cameraAStatus:
            cameraAEncodingStatus === 'complete' ? 'complete' : 'error',
          cameraBStatus:
            cameraBEncodingStatus === 'complete' ? 'complete' : 'error',
          cameraAObservedFrameCount: recording.cameraATiming.summary.observedFrameCount,
          cameraBObservedFrameCount: recording.cameraBTiming.summary.observedFrameCount,
          cameraARequestedFps: recording.cameraATiming.requestedFrameRate,
          cameraBRequestedFps: recording.cameraBTiming.requestedFrameRate,
          cameraABrowserObservedCallbackFps:
            recording.cameraATiming.summary.browserObservedCallbackFps,
          cameraBBrowserObservedCallbackFps:
            recording.cameraBTiming.summary.browserObservedCallbackFps,
          cameraASkippedPresentationFrames:
            recording.cameraATiming.summary.skippedFrameCount,
          cameraBSkippedPresentationFrames:
            recording.cameraBTiming.summary.skippedFrameCount,
          cameraAEncodedFpsAvailable:
            recording.cameraATiming.encodedVideoMetrics.status === 'measured_externally',
          cameraBEncodedFpsAvailable:
            recording.cameraBTiming.encodedVideoMetrics.status === 'measured_externally',
          durationMs: recording.duration,
          cameraAMetadataAvailability: recording.cameraATiming.metadataAvailability,
          cameraBMetadataAvailability: recording.cameraBTiming.metadataAvailability,
          synchronizationStatus: recording.synchronizationDiagnostics.status,
        });
        rec1Ref.current = null;
        rec2Ref.current = null;
        resolve(recording);
      };

      const settleCameraA = (failed: boolean, message?: string) => {
        if (cameraASettled) return;
        cameraASettled = true;
        if (failed) cameraEncodingFailureRef.current.cameraA = true;
        if (message) recordingErrorsRef.current.push(message);
        finalize();
      };
      const settleCameraB = (failed: boolean, message?: string) => {
        if (cameraBSettled) return;
        cameraBSettled = true;
        if (failed) cameraEncodingFailureRef.current.cameraB = true;
        if (message) recordingErrorsRef.current.push(message);
        finalize();
      };

      stopTimeout = setTimeout(() => {
        if (!cameraASettled) {
          settleCameraA(true, 'Camera A MediaRecorder stop timed out.');
        }
        if (!cameraBSettled) {
          settleCameraB(true, 'Camera B MediaRecorder stop timed out.');
        }
      }, RECORDER_STOP_TIMEOUT_MS);

      recorderA.onstop = () => settleCameraA(cameraEncodingFailureRef.current.cameraA);
      recorderB.onstop = () => settleCameraB(cameraEncodingFailureRef.current.cameraB);
      recorderA.onerror = () => settleCameraA(
        true,
        'Camera A MediaRecorder errored while stopping.',
      );
      recorderB.onerror = () => settleCameraB(
        true,
        'Camera B MediaRecorder errored while stopping.',
      );

      if (recorderA.state === 'inactive') {
        settleCameraA(cameraEncodingFailureRef.current.cameraA);
      } else {
        try {
          recorderA.stop();
        } catch (caughtError) {
          settleCameraA(
            true,
            `Camera A MediaRecorder stop failed: ${(caughtError as Error).message}`,
          );
        }
      }
      if (recorderB.state === 'inactive') {
        settleCameraB(cameraEncodingFailureRef.current.cameraB);
      } else {
        try {
          recorderB.stop();
        } catch (caughtError) {
          settleCameraB(
            true,
            `Camera B MediaRecorder stop failed: ${(caughtError as Error).message}`,
          );
        }
      }

    })
  ), [
    cancelObserver,
    options.experimentSessionId,
    options.pairingToleranceMs,
    updateLiveDiagnostics,
  ]);

  const downloadRecording = useCallback((recording: StereoVideoRecording) => {
    const extension = recording.mimeType.includes('mp4') ? 'mp4' : 'webm';
    const safeName = recording.name.replace(/[^a-z0-9]/gi, '_');
    downloadBlob(recording.cam1Blob, `${safeName}_cam1.${extension}`);
    downloadBlob(recording.cam2Blob, `${safeName}_cam2.${extension}`);
    downloadJson(recording.cameraATiming, `${safeName}_camera_a_timing.json`);
    downloadJson(recording.cameraBTiming, `${safeName}_camera_b_timing.json`);
    downloadJson(recording.clockMetadata, `${safeName}_recording_clock.json`);
    downloadJson(
      recording.synchronizationDiagnostics,
      `${safeName}_camera_sync_diagnostics.json`,
    );
  }, []);

  const deleteRecording = useCallback((id: string) => {
    setRecordings(previous => previous.filter(recording => recording.id !== id));
  }, []);

  return {
    isRecording,
    recordings,
    error,
    recordingDiagnostics,
    startRecording,
    stopRecording,
    downloadRecording,
    deleteRecording,
  };
}
