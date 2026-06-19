import { useState, useEffect, useCallback, useRef } from 'react';
import { PoseLandmarker, FilesetResolver, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { PoseLandmarks } from './useMediaPipePose';

export interface DualPoseLandmarkData {
  timestamp: number;
  cameraId: number;
  frameId: number;
  landmarkId: number;
  landmarkName: keyof PoseLandmarks;
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface SynchronizedFrame {
  timestamp: number;
  frameId: number;
  camera1: {
    landmarks: PoseLandmarks | null;
    videoWidth: number;
    videoHeight: number;
  };
  camera2: {
    landmarks: PoseLandmarks | null;
    videoWidth: number;
    videoHeight: number;
  };
}

export function useDualMediaPipePose(
  videoElement1: HTMLVideoElement | null,
  videoElement2: HTMLVideoElement | null,
  isActive: boolean
) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [camera1Landmarks, setCamera1Landmarks] = useState<PoseLandmarks | null>(null);
  const [camera2Landmarks, setCamera2Landmarks] = useState<PoseLandmarks | null>(null);
  const [recordedData, setRecordedData] = useState<DualPoseLandmarkData[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poseLandmarker1Ref = useRef<PoseLandmarker | null>(null);
  const poseLandmarker2Ref = useRef<PoseLandmarker | null>(null);
  const animationFrameId1Ref = useRef<number | null>(null);
  const animationFrameId2Ref = useRef<number | null>(null);
  const frameCounter1Ref = useRef<number>(0);
  const frameCounter2Ref = useRef<number>(0);
  const lastTimestamp1Ref = useRef<number>(0);
  const lastTimestamp2Ref = useRef<number>(0);
  const recordingStartTimeRef = useRef<number>(0);
  // Offscreen canvases so detectForVideo never touches the video element's GPU texture directly,
  // which would black out all display copies of the same MediaStream.
  const offscreenCanvas1Ref = useRef<HTMLCanvasElement | null>(null);
  const offscreenCanvas2Ref = useRef<HTMLCanvasElement | null>(null);

  const landmarkNames: Array<keyof PoseLandmarks> = [
    'nose',
    'leftShoulder',
    'rightShoulder',
    'leftElbow',
    'rightElbow',
    'leftWrist',
    'rightWrist',
    'leftHip',
    'rightHip',
    'leftKnee',
    'rightKnee',
    'leftAnkle',
    'rightAnkle',
  ];

  // Initialize MediaPipe Pose Landmarkers
  useEffect(() => {
    const initPoseLandmarker = async () => {
      try {
        // Note: You may see OpenGL warnings in console from MediaPipe's C++ code.
        // These are harmless and expected - they come from GPU delegate initialization.
        // See CONSOLE_WARNINGS.md for details.
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        const poseLandmarker1 = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        const poseLandmarker2 = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        poseLandmarker1Ref.current = poseLandmarker1;
        poseLandmarker2Ref.current = poseLandmarker2;
        setIsLoaded(true);
      } catch (err) {
        setError('Failed to initialize MediaPipe: ' + (err as Error).message);
      }
    };

    initPoseLandmarker();

    return () => {
      poseLandmarker1Ref.current?.close();
      poseLandmarker2Ref.current?.close();
    };
  }, []);

  // Convert MediaPipe result to our landmark format
  const convertToLandmarks = useCallback((result: PoseLandmarkerResult): PoseLandmarks | null => {
    if (!result.landmarks || result.landmarks.length === 0) {
      return null;
    }

    const landmarks = result.landmarks[0];

    return {
      nose: {
        x: landmarks[0].x,
        y: landmarks[0].y,
        z: landmarks[0].z,
        visibility: landmarks[0].visibility,
      },
      leftShoulder: {
        x: landmarks[11].x,
        y: landmarks[11].y,
        z: landmarks[11].z,
        visibility: landmarks[11].visibility,
      },
      rightShoulder: {
        x: landmarks[12].x,
        y: landmarks[12].y,
        z: landmarks[12].z,
        visibility: landmarks[12].visibility,
      },
      leftElbow: {
        x: landmarks[13].x,
        y: landmarks[13].y,
        z: landmarks[13].z,
        visibility: landmarks[13].visibility,
      },
      rightElbow: {
        x: landmarks[14].x,
        y: landmarks[14].y,
        z: landmarks[14].z,
        visibility: landmarks[14].visibility,
      },
      leftWrist: {
        x: landmarks[15].x,
        y: landmarks[15].y,
        z: landmarks[15].z,
        visibility: landmarks[15].visibility,
      },
      rightWrist: {
        x: landmarks[16].x,
        y: landmarks[16].y,
        z: landmarks[16].z,
        visibility: landmarks[16].visibility,
      },
      leftHip: {
        x: landmarks[23].x,
        y: landmarks[23].y,
        z: landmarks[23].z,
        visibility: landmarks[23].visibility,
      },
      rightHip: {
        x: landmarks[24].x,
        y: landmarks[24].y,
        z: landmarks[24].z,
        visibility: landmarks[24].visibility,
      },
      leftKnee: {
        x: landmarks[25].x,
        y: landmarks[25].y,
        z: landmarks[25].z,
        visibility: landmarks[25].visibility,
      },
      rightKnee: {
        x: landmarks[26].x,
        y: landmarks[26].y,
        z: landmarks[26].z,
        visibility: landmarks[26].visibility,
      },
      leftAnkle: {
        x: landmarks[27].x,
        y: landmarks[27].y,
        z: landmarks[27].z,
        visibility: landmarks[27].visibility,
      },
      rightAnkle: {
        x: landmarks[28].x,
        y: landmarks[28].y,
        z: landmarks[28].z,
        visibility: landmarks[28].visibility,
      },
    };
  }, []);

  // Process frame from camera 1
  const processFrame1 = useCallback(() => {
    if (
      !videoElement1 ||
      !poseLandmarker1Ref.current ||
      !isActive ||
      videoElement1.readyState < 2
    ) {
      animationFrameId1Ref.current = requestAnimationFrame(processFrame1);
      return;
    }

    const timestamp = performance.now();

    // Draw video to offscreen canvas so detectForVideo never holds the video's
    // GPU texture, which would black out all display copies of this MediaStream.
    const w = videoElement1.videoWidth;
    const h = videoElement1.videoHeight;
    if (!offscreenCanvas1Ref.current || offscreenCanvas1Ref.current.width !== w || offscreenCanvas1Ref.current.height !== h) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      offscreenCanvas1Ref.current = c;
    }
    const ctx1 = offscreenCanvas1Ref.current.getContext('2d');
    if (ctx1) ctx1.drawImage(videoElement1, 0, 0, w, h);

    // Detect pose from canvas
    const result = poseLandmarker1Ref.current.detectForVideo(offscreenCanvas1Ref.current, timestamp);
    const landmarks = convertToLandmarks(result);

    setCamera1Landmarks(landmarks);

    // Record data if recording
    if (isRecording && landmarks) {
      const relativeTimestamp = timestamp - recordingStartTimeRef.current;
      const frameId = frameCounter1Ref.current;

      landmarkNames.forEach((landmarkName, landmarkId) => {
        const landmark = landmarks[landmarkName];
        setRecordedData((prev) => [
          ...prev,
          {
            timestamp: relativeTimestamp,
            cameraId: 1,
            frameId,
            landmarkId,
            landmarkName,
            x: landmark.x,
            y: landmark.y,
            z: landmark.z,
            visibility: landmark.visibility ?? 1.0,
          },
        ]);
      });

      frameCounter1Ref.current++;
    }

    lastTimestamp1Ref.current = timestamp;
    animationFrameId1Ref.current = requestAnimationFrame(processFrame1);
  }, [videoElement1, isActive, convertToLandmarks, isRecording, landmarkNames]);

  // Process frame from camera 2
  const processFrame2 = useCallback(() => {
    if (
      !videoElement2 ||
      !poseLandmarker2Ref.current ||
      !isActive ||
      videoElement2.readyState < 2
    ) {
      animationFrameId2Ref.current = requestAnimationFrame(processFrame2);
      return;
    }

    const timestamp = performance.now();

    const w2 = videoElement2.videoWidth;
    const h2 = videoElement2.videoHeight;
    if (!offscreenCanvas2Ref.current || offscreenCanvas2Ref.current.width !== w2 || offscreenCanvas2Ref.current.height !== h2) {
      const c = document.createElement('canvas');
      c.width = w2;
      c.height = h2;
      offscreenCanvas2Ref.current = c;
    }
    const ctx2 = offscreenCanvas2Ref.current.getContext('2d');
    if (ctx2) ctx2.drawImage(videoElement2, 0, 0, w2, h2);

    const result = poseLandmarker2Ref.current.detectForVideo(offscreenCanvas2Ref.current, timestamp);
    const landmarks = convertToLandmarks(result);

    setCamera2Landmarks(landmarks);

    // Record data if recording
    if (isRecording && landmarks) {
      const relativeTimestamp = timestamp - recordingStartTimeRef.current;
      const frameId = frameCounter2Ref.current;

      landmarkNames.forEach((landmarkName, landmarkId) => {
        const landmark = landmarks[landmarkName];
        setRecordedData((prev) => [
          ...prev,
          {
            timestamp: relativeTimestamp,
            cameraId: 2,
            frameId,
            landmarkId,
            landmarkName,
            x: landmark.x,
            y: landmark.y,
            z: landmark.z,
            visibility: landmark.visibility ?? 1.0,
          },
        ]);
      });

      frameCounter2Ref.current++;
    }

    lastTimestamp2Ref.current = timestamp;
    animationFrameId2Ref.current = requestAnimationFrame(processFrame2);
  }, [videoElement2, isActive, convertToLandmarks, isRecording, landmarkNames]);

  // Start/stop pose detection
  useEffect(() => {
    if (isLoaded && isActive && videoElement1 && videoElement2) {
      setIsRunning(true);
      processFrame1();
      processFrame2();
    } else {
      setIsRunning(false);
      if (animationFrameId1Ref.current) {
        cancelAnimationFrame(animationFrameId1Ref.current);
      }
      if (animationFrameId2Ref.current) {
        cancelAnimationFrame(animationFrameId2Ref.current);
      }
    }

    return () => {
      if (animationFrameId1Ref.current) {
        cancelAnimationFrame(animationFrameId1Ref.current);
      }
      if (animationFrameId2Ref.current) {
        cancelAnimationFrame(animationFrameId2Ref.current);
      }
    };
  }, [isLoaded, isActive, videoElement1, videoElement2, processFrame1, processFrame2]);

  const startRecording = useCallback(() => {
    setIsRecording(true);
    setRecordedData([]);
    frameCounter1Ref.current = 0;
    frameCounter2Ref.current = 0;
    recordingStartTimeRef.current = performance.now();
  }, []);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
  }, []);

  const clearRecordedData = useCallback(() => {
    setRecordedData([]);
    frameCounter1Ref.current = 0;
    frameCounter2Ref.current = 0;
  }, []);

  const exportRecordedData = useCallback(() => {
    const csv = [
      'timestamp,camera_id,frame_id,landmark_id,landmark_name,x,y,z,visibility',
      ...recordedData.map(
        (d) =>
          `${d.timestamp},${d.cameraId},${d.frameId},${d.landmarkId},${d.landmarkName},${d.x},${d.y},${d.z},${d.visibility}`
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dual_camera_pose_data_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [recordedData]);

  return {
    isLoaded,
    isRunning,
    camera1Landmarks,
    camera2Landmarks,
    isRecording,
    recordedData,
    startRecording,
    stopRecording,
    clearRecordedData,
    exportRecordedData,
    error,
  };
}
