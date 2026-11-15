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
  observedFrameRate?: number;
  meanObservationIntervalMs?: number;
  observationIntervalStdDevMs?: number;
  frameGapCount: number;
  skippedFrameCount: number;
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
  experimentStartPerformanceNowMs: number;
  metadataAvailability: CameraTimingMetadataAvailability;
  synchronizationStatus: SynchronizationStatus;
  limitation?: string;
  observations: RecordedCameraTimingObservation[];
  summary: CameraTimingSummary;
}

export interface StereoSynchronizationDiagnostics {
  recordingId: string;
  status: SynchronizationStatus;
  basis: 'nearest_browser_presentation_observation';
  browserPresentationAlignmentOnly: true;
  hardwareExposureSynchronizationVerified: false;
  pairedObservationCount: number;
  meanBrowserObservationOffsetMs?: number;
  maxAbsoluteBrowserObservationOffsetMs?: number;
  meanMediaTimeOffsetMs?: number;
  maxAbsoluteMediaTimeOffsetMs?: number;
  timingUncertaintyMs?: number;
  cameraPairMetadata: CameraPairTimingMetadata;
  limitations: string[];
}

export interface StereoRecordingDiagnostics {
  recordingId: string | null;
  cameraAStatus: CameraRecordingStatus;
  cameraBStatus: CameraRecordingStatus;
  cameraAObservedFrameCount: number;
  cameraBObservedFrameCount: number;
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
): CameraTimingSummary {
  if (observations.length === 0) {
    return {
      observedFrameCount: 0,
      frameGapCount: 0,
      skippedFrameCount: 0,
    };
  }

  const first = observations[0];
  const last = observations[observations.length - 1];
  const experimentIntervals = observations.slice(1).map(
    (observation, index) => observation.experimentTimeMs - observations[index].experimentTimeMs,
  );
  const meanInterval = calculateMean(experimentIntervals);
  const mediaElapsedSeconds = last.mediaTimeSeconds - first.mediaTimeSeconds;

  return {
    observedFrameCount: observations.length,
    firstExperimentTimeMs: first.experimentTimeMs,
    lastExperimentTimeMs: last.experimentTimeMs,
    firstMediaTimeSeconds: first.mediaTimeSeconds,
    lastMediaTimeSeconds: last.mediaTimeSeconds,
    observedFrameRate: observations.length >= 2 && mediaElapsedSeconds > 0
      ? (observations.length - 1) / mediaElapsedSeconds
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
  };
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
  };
}

function nearestObservation(
  target: RecordedCameraTimingObservation,
  candidates: RecordedCameraTimingObservation[],
): RecordedCameraTimingObservation | null {
  let nearest: RecordedCameraTimingObservation | null = null;
  let nearestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.experimentTimeMs - target.experimentTimeMs);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function buildSynchronizationDiagnostics(
  recordingId: string,
  cameraA: CameraTimingSidecar,
  cameraB: CameraTimingSidecar,
): StereoSynchronizationDiagnostics {
  const browserOffsets: number[] = [];
  const mediaOffsets: number[] = [];

  for (const observationA of cameraA.observations) {
    const observationB = nearestObservation(observationA, cameraB.observations);
    if (!observationB) continue;
    browserOffsets.push(observationB.experimentTimeMs - observationA.experimentTimeMs);
    mediaOffsets.push((observationB.mediaTimeSeconds - observationA.mediaTimeSeconds) * 1000);
  }

  const maxAbs = (values: number[]): number | undefined => (
    values.length > 0 ? Math.max(...values.map(Math.abs)) : undefined
  );
  const maxBrowserOffset = maxAbs(browserOffsets);
  const bothFrameSpecific =
    cameraA.metadataAvailability === 'frame_specific'
    && cameraB.metadataAvailability === 'frame_specific';
  const status: SynchronizationStatus =
    cameraA.observations.length === 0 || cameraB.observations.length === 0
      ? 'unknown'
      : 'unverified';

  return {
    recordingId,
    status,
    basis: 'nearest_browser_presentation_observation',
    browserPresentationAlignmentOnly: true,
    hardwareExposureSynchronizationVerified: false,
    pairedObservationCount: browserOffsets.length,
    meanBrowserObservationOffsetMs: calculateMean(browserOffsets),
    maxAbsoluteBrowserObservationOffsetMs: maxBrowserOffset,
    meanMediaTimeOffsetMs: calculateMean(mediaOffsets),
    maxAbsoluteMediaTimeOffsetMs: maxAbs(mediaOffsets),
    timingUncertaintyMs: maxBrowserOffset,
    cameraPairMetadata: {
      status,
      cameraBMediaTimeBasis: cameraB.metadataAvailability === 'frame_specific'
        ? 'camera_b_frame_callback'
        : 'observed_current_time',
      cameraBFrameSynchronizationVerified: false,
      estimatedOffsetMs: calculateMean(mediaOffsets),
      uncertaintyMs: maxBrowserOffset,
      notes: 'Browser presentation observations only; camera exposure synchronization is not verified.',
    },
    limitations: [
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
}

export function createStereoVideoRecording(
  input: CreateRecordingInput,
): StereoVideoRecording {
  const cameraATiming: CameraTimingSidecar = {
    ...input.cameraATiming,
    summary: summarizeCameraTiming(input.cameraATiming.observations),
  };
  const cameraBTiming: CameraTimingSidecar = {
    ...input.cameraBTiming,
    summary: summarizeCameraTiming(input.cameraBTiming.observations),
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
    ),
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
    setRecordingDiagnostics({
      recordingId: recordingIdRef.current,
      cameraAStatus,
      cameraBStatus,
      cameraAObservedFrameCount: cameraA?.observations.length ?? 0,
      cameraBObservedFrameCount: cameraB?.observations.length ?? 0,
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
    if (observer.kind === 'rvfc') {
      observer.video.cancelVideoFrameCallback(observer.id);
    } else {
      cancelAnimationFrame(observer.id);
    }
  }, []);

  const startTimingObserver = useCallback((
    video: HTMLVideoElement | null,
    cameraRole: 'camera_a' | 'camera_b',
    sidecar: CameraTimingSidecar,
    observerRef: MutableRefObject<TimingObserverHandle | null>,
  ) => {
    const sidecarRef = cameraRole === 'camera_a' ? cameraASidecarRef : cameraBSidecarRef;
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
      previousPresentedFrames = metadata?.presentedFrames;
      previousMediaTimeSeconds = mediaTimeSeconds;
      updateLiveDiagnostics();
    };

    if (typeof video.requestVideoFrameCallback === 'function') {
      sidecar.metadataAvailability = 'frame_specific';
      sidecar.synchronizationStatus = 'unverified';
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

    try {
      const recorderA = new MediaRecorder(stream1, mediaRecorderOptions);
      const recorderB = new MediaRecorder(stream2, mediaRecorderOptions);
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

      chunks1Ref.current = [];
      chunks2Ref.current = [];
      recorderA.ondataavailable = event => {
        if (event.data.size > 0) chunks1Ref.current.push(event.data);
      };
      recorderB.ondataavailable = event => {
        if (event.data.size > 0) chunks2Ref.current.push(event.data);
      };
      recorderA.onerror = () => {
        setError('Camera A MediaRecorder reported an encoding error.');
        setRecordingDiagnostics(previous => ({
          ...previous,
          cameraAStatus: 'error',
        }));
      };
      recorderB.onerror = () => {
        setError('Camera B MediaRecorder reported an encoding error.');
        setRecordingDiagnostics(previous => ({
          ...previous,
          cameraBStatus: 'error',
        }));
      };

      rec1Ref.current = recorderA;
      rec2Ref.current = recorderB;
      startWallClockRef.current = wallClockStart;
      experimentStartRef.current = experimentStartPerformanceNowMs;
      recordingIdRef.current = recordingId;
      clockMetadataRef.current = createExperimentClockMetadata(
        experimentStartPerformanceNowMs,
      );
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
      cameraBSidecarRef.current.resolution = cameraBSettings?.width && cameraBSettings?.height
        ? { width: cameraBSettings.width, height: cameraBSettings.height }
        : undefined;
      cameraBSidecarRef.current.nominalFrameRate = cameraBSettings?.frameRate;
      isRecordingRef.current = true;

      // Both encoders and both timing observers use the same monotonic origin.
      recorderA.start(100);
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
      setError(`Failed to start recording: ${(caughtError as Error).message}`);
      setRecordingDiagnostics(previous => ({
        ...previous,
        cameraAStatus: 'error',
        cameraBStatus: 'error',
      }));
    }
  }, [stream1, stream2, options, startTimingObserver, updateLiveDiagnostics]);

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

      let stoppedCount = 0;
      const tryFinalize = () => {
        stoppedCount += 1;
        if (stoppedCount < 2) return;

        const recordingId = recordingIdRef.current;
        const clockMetadata = clockMetadataRef.current;
        const cameraATiming = cameraASidecarRef.current;
        const cameraBTiming = cameraBSidecarRef.current;
        if (!recordingId || !clockMetadata || !cameraATiming || !cameraBTiming) {
          setError('Recording timing metadata was unavailable during finalization.');
          setIsRecording(false);
          resolve(null);
          return;
        }

        const resolvedMimeType = recorderA.mimeType || 'video/webm';
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
        });

        setRecordings(previous => [recording, ...previous]);
        setIsRecording(false);
        setRecordingDiagnostics({
          recordingId,
          cameraAStatus: 'complete',
          cameraBStatus: 'complete',
          cameraAObservedFrameCount: recording.cameraATiming.summary.observedFrameCount,
          cameraBObservedFrameCount: recording.cameraBTiming.summary.observedFrameCount,
          durationMs: recording.duration,
          cameraAMetadataAvailability: recording.cameraATiming.metadataAvailability,
          cameraBMetadataAvailability: recording.cameraBTiming.metadataAvailability,
          synchronizationStatus: recording.synchronizationDiagnostics.status,
        });
        rec1Ref.current = null;
        rec2Ref.current = null;
        resolve(recording);
      };

      recorderA.onstop = tryFinalize;
      recorderB.onstop = tryFinalize;
      recorderA.stop();
      recorderB.stop();
    })
  ), [cancelObserver, options.experimentSessionId, updateLiveDiagnostics]);

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
