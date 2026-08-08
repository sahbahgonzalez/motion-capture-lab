import { useState, useRef, useCallback } from 'react';
import { PoseLandmarks } from './useMediaPipePose';

export interface MotionFrame {
  timestamp: number; // milliseconds since recording start
  landmarks: PoseLandmarks;
  frameNumber: number;
}

export interface MotionRecording {
  id: string;
  name: string;
  startTime: number; // Unix timestamp
  duration: number; // milliseconds
  frames: MotionFrame[];
  frameRate: number; // average FPS
  metadata: {
    exerciseType?: string;
    notes?: string;
    deviceInfo?: string;
  };
}

export function useMotionRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [currentRecordingMetadata, setCurrentRecordingMetadata] = useState<{ id: string; name: string; startTime: number } | null>(null);
  const [recordings, setRecordings] = useState<MotionRecording[]>([]);
  const [currentFrameCount, setCurrentFrameCount] = useState(0);
  const [currentDuration, setCurrentDuration] = useState(0);
  
  const recordingStartTime = useRef<number>(0);
  const frameCounter = useRef<number>(0);
  const framesBuffer = useRef<MotionFrame[]>([]);
  const currentMetadataRef = useRef<MotionRecording['metadata']>({});
  const lastDisplayUpdateRef = useRef<number>(0);
  const debugMetricsRef = useRef({ frameBufferPushCalls: 0 });

  const startRecording = useCallback((metadata?: MotionRecording['metadata']) => {
    const startTime = Date.now();
    recordingStartTime.current = startTime;
    frameCounter.current = 0;
    framesBuffer.current = [];
    debugMetricsRef.current.frameBufferPushCalls = 0;
    currentMetadataRef.current = metadata || {};
    lastDisplayUpdateRef.current = 0;
    
    setCurrentRecordingMetadata({
      id: `recording_${startTime}`,
      name: `Motion_${new Date(startTime).toLocaleString()}`,
      startTime,
    });
    setCurrentFrameCount(0);
    setCurrentDuration(0);
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    if (!isRecording || !currentRecordingMetadata) return null;

    const endTime = Date.now();
    const duration = endTime - recordingStartTime.current;
    const frameRate = framesBuffer.current.length / (duration / 1000);

    const completedRecording: MotionRecording = {
      id: currentRecordingMetadata.id,
      name: currentRecordingMetadata.name,
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
    
    return completedRecording;
  }, [isRecording, currentRecordingMetadata]);

  const recordFrame = useCallback((landmarks: PoseLandmarks) => {
    if (!isRecording) return;

    const timestamp = Date.now() - recordingStartTime.current;
    const frame: MotionFrame = {
      timestamp,
      landmarks,
      frameNumber: frameCounter.current++,
    };

    debugMetricsRef.current.frameBufferPushCalls += 1;
    framesBuffer.current.push(frame);

    // Throttle display updates to ~4Hz — the frame data is already in the ref.
    // Calling setState every frame triggers a full re-render of the consumer
    // component on every detection cycle, cutting throughput roughly in half.
    const now = Date.now();
    if (now - lastDisplayUpdateRef.current > 250) {
      lastDisplayUpdateRef.current = now;
      setCurrentFrameCount(framesBuffer.current.length);
      setCurrentDuration(timestamp);
    }
  }, [isRecording]);

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
    deleteRecording,
    clearAllRecordings,
    exportRecording,
    exportAllRecordings,
    debugMetrics: debugMetricsRef,
  };
}
