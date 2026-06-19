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
  const [currentRecording, setCurrentRecording] = useState<MotionRecording | null>(null);
  const [recordings, setRecordings] = useState<MotionRecording[]>([]);
  
  const recordingStartTime = useRef<number>(0);
  const frameCounter = useRef<number>(0);
  const framesBuffer = useRef<MotionFrame[]>([]);

  const startRecording = useCallback((metadata?: MotionRecording['metadata']) => {
    const startTime = Date.now();
    recordingStartTime.current = startTime;
    frameCounter.current = 0;
    framesBuffer.current = [];
    
    setIsRecording(true);
    setCurrentRecording({
      id: `recording_${startTime}`,
      name: `Motion_${new Date(startTime).toLocaleString()}`,
      startTime,
      duration: 0,
      frames: [],
      frameRate: 0,
      metadata: metadata || {},
    });
  }, []);

  const stopRecording = useCallback(() => {
    if (!isRecording) return null;

    const endTime = Date.now();
    const duration = endTime - recordingStartTime.current;
    const frameRate = framesBuffer.current.length / (duration / 1000);

    const completedRecording: MotionRecording = {
      id: currentRecording!.id,
      name: currentRecording!.name,
      startTime: recordingStartTime.current,
      duration,
      frames: [...framesBuffer.current],
      frameRate,
      metadata: currentRecording!.metadata,
    };

    setRecordings(prev => [...prev, completedRecording]);
    setIsRecording(false);
    setCurrentRecording(null);
    framesBuffer.current = [];
    
    return completedRecording;
  }, [isRecording, currentRecording]);

  const recordFrame = useCallback((landmarks: PoseLandmarks) => {
    if (!isRecording) return;

    const timestamp = Date.now() - recordingStartTime.current;
    const frame: MotionFrame = {
      timestamp,
      landmarks,
      frameNumber: frameCounter.current++,
    };

    framesBuffer.current.push(frame);
    
    // Update current recording preview
    setCurrentRecording(prev => prev ? {
      ...prev,
      duration: timestamp,
      frames: [...framesBuffer.current],
      frameRate: framesBuffer.current.length / (timestamp / 1000),
    } : null);
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

  return {
    isRecording,
    currentRecording,
    recordings,
    startRecording,
    stopRecording,
    recordFrame,
    deleteRecording,
    clearAllRecordings,
    exportRecording,
    exportAllRecordings,
  };
}
