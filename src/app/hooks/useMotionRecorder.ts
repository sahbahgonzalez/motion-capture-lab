import { useState, useRef, useCallback } from 'react';
import { PoseLandmarks } from './useMediaPipePose';

export interface MotionFrame {
  timestamp: number; // milliseconds since recording start
  landmarks: PoseLandmarks;
  frameNumber: number;
}

export type RecordingClockMode = 'wall-clock-relative' | 'explicit-experiment';

export interface MotionRecordingMetadata {
  exerciseType?: string;
  notes?: string;
  deviceInfo?: string;
  /**
   * Optional for old serialized recordings. New recordings always populate it.
   * Explicit experiment recordings must declare this mode at startRecording().
   */
  clockMode?: RecordingClockMode;
  /** Required when clockMode is explicit-experiment. */
  experimentSessionId?: string;
  /** Identifies the authoritative clock metadata within the experiment schema. */
  experimentClockReference?: 'ExperimentSession.clock';
}

export interface MotionRecording {
  id: string;
  name: string;
  startTime: number; // Unix timestamp
  duration: number; // milliseconds
  frames: MotionFrame[];
  frameRate: number; // average FPS
  metadata: MotionRecordingMetadata;
}

export type MotionFrameRecordFailureReason =
  | 'not_recording'
  | 'invalid_timestamp'
  | 'non_monotonic_timestamp'
  | 'clock_mode_mismatch'
  | 'missing_experiment_session';

export type MotionFrameRecordResult =
  | { accepted: true; frame: MotionFrame }
  | {
      accepted: false;
      reason: MotionFrameRecordFailureReason;
      experimentTimeMs?: number;
      previousTimestampMs?: number;
    };

/**
 * Pure frame constructor shared by the legacy and explicit timestamp paths.
 * Explicit experiment timestamps must be finite, non-negative, and strictly
 * increasing. The legacy path retains its existing Date.now()-relative behavior.
 */
export function createMotionFrame(
  landmarks: PoseLandmarks,
  timestampMs: number,
  frameNumber: number,
  previousTimestampMs: number | null,
  requireStrictMonotonicTimestamp: boolean,
): MotionFrameRecordResult {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    return {
      accepted: false,
      reason: 'invalid_timestamp',
      experimentTimeMs: timestampMs,
      previousTimestampMs: previousTimestampMs ?? undefined,
    };
  }

  if (
    requireStrictMonotonicTimestamp
    && previousTimestampMs !== null
    && timestampMs <= previousTimestampMs
  ) {
    return {
      accepted: false,
      reason: 'non_monotonic_timestamp',
      experimentTimeMs: timestampMs,
      previousTimestampMs,
    };
  }

  return {
    accepted: true,
    frame: {
      timestamp: timestampMs,
      landmarks,
      frameNumber,
    },
  };
}

export function calculateRecordingFrameRate(
  clockMode: RecordingClockMode,
  frameCount: number,
  elapsedMs: number,
): number {
  if (clockMode === 'explicit-experiment') {
    return frameCount >= 2 && elapsedMs > 0
      ? (frameCount - 1) / (elapsedMs / 1000)
      : 0;
  }
  // Preserve the legacy calculation exactly for existing live workflows.
  return frameCount / (elapsedMs / 1000);
}

export function useMotionRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [currentRecordingMetadata, setCurrentRecordingMetadata] = useState<{ id: string; name: string; startTime: number } | null>(null);
  const [recordings, setRecordings] = useState<MotionRecording[]>([]);
  const [currentFrameCount, setCurrentFrameCount] = useState(0);
  const [currentDuration, setCurrentDuration] = useState(0);
  
  const isRecordingRef = useRef(false);
  const recordingStartTime = useRef<number>(0);
  const frameCounter = useRef<number>(0);
  const framesBuffer = useRef<MotionFrame[]>([]);
  const activeRecordingRef = useRef<{ id: string; name: string; startTime: number } | null>(null);
  const currentMetadataRef = useRef<MotionRecordingMetadata>({});
  const lastDisplayUpdateRef = useRef<number>(0);
  const debugMetricsRef = useRef({ frameBufferPushCalls: 0 });
  const recordingClockModeRef = useRef<RecordingClockMode | null>(null);
  const firstRecordedTimestampRef = useRef<number | null>(null);
  const lastRecordedTimestampRef = useRef<number | null>(null);

  const startRecording = useCallback((metadata?: MotionRecordingMetadata) => {
    if (isRecordingRef.current) return;
    const clockMode = metadata?.clockMode ?? 'wall-clock-relative';
    if (clockMode === 'explicit-experiment' && !metadata?.experimentSessionId) {
      console.warn('[MOTION RECORDER] Explicit experiment recording requires experimentSessionId');
      return;
    }

    const startTime = Date.now();
    const recordingIdentity = {
      id: `recording_${startTime}`,
      name: `Motion_${new Date(startTime).toLocaleString()}`,
      startTime,
    };
    const normalizedMetadata: MotionRecordingMetadata = {
      ...metadata,
      clockMode,
      ...(clockMode === 'explicit-experiment'
        ? { experimentClockReference: 'ExperimentSession.clock' as const }
        : {
            experimentSessionId: undefined,
            experimentClockReference: undefined,
          }),
    };

    isRecordingRef.current = true;
    activeRecordingRef.current = recordingIdentity;
    recordingStartTime.current = startTime;
    frameCounter.current = 0;
    framesBuffer.current = [];
    debugMetricsRef.current.frameBufferPushCalls = 0;
    currentMetadataRef.current = normalizedMetadata;
    lastDisplayUpdateRef.current = 0;
    recordingClockModeRef.current = clockMode;
    firstRecordedTimestampRef.current = null;
    lastRecordedTimestampRef.current = null;
    
    setCurrentRecordingMetadata(recordingIdentity);
    setCurrentFrameCount(0);
    setCurrentDuration(0);
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    const activeRecording = activeRecordingRef.current;
    if (!isRecordingRef.current || !activeRecording) return null;

    // Close synchronously so hot-path callbacks after stop cannot append frames,
    // even before React applies the state update below.
    isRecordingRef.current = false;
    activeRecordingRef.current = null;

    const endTime = Date.now();
    const wallClockDuration = endTime - recordingStartTime.current;
    const firstTimestamp = firstRecordedTimestampRef.current;
    const lastTimestamp = lastRecordedTimestampRef.current;
    const clockMode = recordingClockModeRef.current ?? 'wall-clock-relative';
    const duration = clockMode === 'explicit-experiment'
      ? (
          firstTimestamp !== null && lastTimestamp !== null
            ? lastTimestamp - firstTimestamp
            : 0
        )
      : wallClockDuration;
    const frameRate = calculateRecordingFrameRate(
      clockMode,
      framesBuffer.current.length,
      duration,
    );

    const completedRecording: MotionRecording = {
      id: activeRecording.id,
      name: activeRecording.name,
      startTime: recordingStartTime.current,
      duration,
      frames: [...framesBuffer.current],
      frameRate,
      metadata: currentMetadataRef.current,
    };

    setRecordings(prev => [...prev, completedRecording]);
    setIsRecording(false);
    setCurrentRecordingMetadata(null);
    setCurrentFrameCount(0);
    setCurrentDuration(0);
    framesBuffer.current = [];
    recordingClockModeRef.current = null;
    firstRecordedTimestampRef.current = null;
    lastRecordedTimestampRef.current = null;
    
    return completedRecording;
  }, []);

  const appendFrame = useCallback((
    landmarks: PoseLandmarks,
    timestamp: number,
    clockMode: RecordingClockMode,
  ): MotionFrameRecordResult => {
    if (!isRecordingRef.current) return { accepted: false, reason: 'not_recording' };

    const activeClockMode = recordingClockModeRef.current;
    if (activeClockMode !== null && activeClockMode !== clockMode) {
      const rejected: MotionFrameRecordResult = {
        accepted: false,
        reason: 'clock_mode_mismatch',
        experimentTimeMs: timestamp,
        previousTimestampMs: lastRecordedTimestampRef.current ?? undefined,
      };
      console.warn('[MOTION RECORDER] Rejected frame from a different clock mode', rejected);
      return rejected;
    }
    if (
      clockMode === 'explicit-experiment'
      && !currentMetadataRef.current.experimentSessionId
    ) {
      const rejected: MotionFrameRecordResult = {
        accepted: false,
        reason: 'missing_experiment_session',
        experimentTimeMs: timestamp,
        previousTimestampMs: lastRecordedTimestampRef.current ?? undefined,
      };
      console.warn('[MOTION RECORDER] Rejected unassociated experiment frame', rejected);
      return rejected;
    }

    const result = createMotionFrame(
      landmarks,
      timestamp,
      frameCounter.current,
      lastRecordedTimestampRef.current,
      clockMode === 'explicit-experiment',
    );
    if (!result.accepted) {
      console.warn('[MOTION RECORDER] Rejected timestamped frame', result);
      return result;
    }

    debugMetricsRef.current.frameBufferPushCalls += 1;
    framesBuffer.current.push(result.frame);
    frameCounter.current += 1;
    recordingClockModeRef.current = clockMode;
    const firstRecordedTimestamp = firstRecordedTimestampRef.current ?? timestamp;
    firstRecordedTimestampRef.current = firstRecordedTimestamp;
    lastRecordedTimestampRef.current = timestamp;

    // Throttle display updates to ~4Hz — the frame data is already in the ref.
    // Calling setState every frame triggers a full re-render of the consumer
    // component on every detection cycle, cutting throughput roughly in half.
    const now = Date.now();
    if (now - lastDisplayUpdateRef.current > 250) {
      lastDisplayUpdateRef.current = now;
      setCurrentFrameCount(framesBuffer.current.length);
      setCurrentDuration(
        clockMode === 'explicit-experiment'
          ? timestamp - firstRecordedTimestamp
          : timestamp,
      );
    }
    return result;
  }, []);

  const recordFrame = useCallback((landmarks: PoseLandmarks) => {
    const timestamp = Date.now() - recordingStartTime.current;
    appendFrame(landmarks, timestamp, 'wall-clock-relative');
  }, [appendFrame]);

  /**
   * Standardized experiment path. The supplied experimentTimeMs is stored
   * exactly and is never replaced by Date.now().
   */
  const recordFrameAtTime = useCallback((
    landmarks: PoseLandmarks,
    experimentTimeMs: number,
  ): MotionFrameRecordResult => (
    appendFrame(landmarks, experimentTimeMs, 'explicit-experiment')
  ), [appendFrame]);

  const deleteRecording = useCallback((id: string) => {
    setRecordings(prev => prev.filter(rec => rec.id !== id));
  }, []);

  const clearAllRecordings = useCallback(() => {
    setRecordings([]);
  }, []);

  const exportRecording = useCallback((recording: MotionRecording) => {
    const dataStr = JSON.stringify(recording, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `${recording.name.replace(/[^a-z0-9]/gi, '_')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  const exportAllRecordings = useCallback(() => {
    const dataStr = JSON.stringify(recordings, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `motion_capture_sessions_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [recordings]);

  // Compute current recording info from refs for consumers that need it
  const currentRecording: MotionRecording | null = currentRecordingMetadata && isRecording ? {
    id: currentRecordingMetadata.id,
    name: currentRecordingMetadata.name,
    startTime: recordingStartTime.current,
    duration: currentDuration,
    frames: framesBuffer.current,
    frameRate: currentDuration > 0 ? framesBuffer.current.length / (currentDuration / 1000) : 0,
    metadata: currentMetadataRef.current,
  } : null;

  return {
    isRecording,
    currentRecording,
    recordings,
    currentFrameCount,
    currentDuration,
    startRecording,
    stopRecording,
    recordFrame,
    recordFrameAtTime,
    deleteRecording,
    clearAllRecordings,
    exportRecording,
    exportAllRecordings,
    debugMetrics: debugMetricsRef,
  };
}
