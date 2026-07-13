import { useEffect, useRef, useState, useCallback } from 'react';
import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';

export interface LandmarkPoint {
  x: number; // Normalized coordinate (0-1)
  y: number; // Normalized coordinate (0-1)
  z: number; // Depth coordinate
  visibility?: number; // Likelihood landmark is visible and not occluded (0-1)
}

export interface PoseLandmarks {
  nose: LandmarkPoint;
  leftEye: LandmarkPoint;
  rightEye: LandmarkPoint;
  leftEar: LandmarkPoint;
  rightEar: LandmarkPoint;
  leftShoulder: LandmarkPoint;
  rightShoulder: LandmarkPoint;
  leftElbow: LandmarkPoint;
  rightElbow: LandmarkPoint;
  leftWrist: LandmarkPoint;
  rightWrist: LandmarkPoint;
  leftHip: LandmarkPoint;
  rightHip: LandmarkPoint;
  leftKnee: LandmarkPoint;
  rightKnee: LandmarkPoint;
  leftAnkle: LandmarkPoint;
  rightAnkle: LandmarkPoint;
}

interface UseMediaPipePoseOptions {
  onPoseDetected?: (landmarks: PoseLandmarks) => void;
  enableDrawing?: boolean;
}

export function useMediaPipePose(
  videoRef: React.RefObject<HTMLVideoElement>,
  canvasRef: React.RefObject<HTMLCanvasElement>,
  options: UseMediaPipePoseOptions = {}
) {
  const [isReady, setIsReady] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [currentLandmarks, setCurrentLandmarks] = useState<PoseLandmarks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const isDetectingRef = useRef<boolean>(false);
  const optionsRef = useRef(options);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Update options ref when options change
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Initialize MediaPipe Pose
  useEffect(() => {
    let mounted = true;

    const initializePose = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU', // Use GPU for optimal performance
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        if (mounted) {
          poseLandmarkerRef.current = poseLandmarker;
          setIsReady(true);
        }
      } catch (err) {
        console.error('Failed to initialize MediaPipe Pose:', err);
        if (mounted) {
          setError('Failed to load pose detection. Please refresh the page.');
        }
      }
    };

    initializePose();

    return () => {
      mounted = false;
      if (poseLandmarkerRef.current) {
        poseLandmarkerRef.current.close();
      }
    };
  }, []);

  // Start detection loop
  const startDetection = useCallback(() => {
    if (!isReady) {
      console.warn('MediaPipe not initialized yet');
      return;
    }
    
    if (!poseLandmarkerRef.current) {
      console.warn('PoseLandmarker not available');
      return;
    }

    if (!videoRef.current) {
      // Silently return if video not ready yet
      return;
    }

    if (!canvasRef.current) {
      // Silently return if canvas not ready yet - will retry when ready
      return;
    }

    // Check if video has dimensions and is ready to play
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
      // Retry after a short delay
      setTimeout(() => startDetection(), 200);
      return;
    }

    console.log('Starting MediaPipe detection - all elements ready:', {
      width: video.videoWidth,
      height: video.videoHeight,
      readyState: video.readyState,
      hasCanvas: !!canvasRef.current
    });

    setIsDetecting(true);
    isDetectingRef.current = true;

    const detectPose = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const poseLandmarker = poseLandmarkerRef.current;

      if (!video || !canvas || !poseLandmarker) {
        return;
      }

      // Double check video is still ready
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        animationFrameRef.current = requestAnimationFrame(detectPose);
        return;
      }

      // Set canvas size to match video if not already set
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      try {
        const startTimeMs = performance.now();

        // Skip if same frame as last time
        if (video.currentTime === lastVideoTimeRef.current) {
          animationFrameRef.current = requestAnimationFrame(detectPose);
          return;
        }
        lastVideoTimeRef.current = video.currentTime;

        // Draw to offscreen canvas before detection so detectForVideo never
        // acquires the video element's GPU texture directly — without this,
        // any other <video> showing the same MediaStream goes black.
        if (!offscreenCanvasRef.current ||
            offscreenCanvasRef.current.width !== video.videoWidth ||
            offscreenCanvasRef.current.height !== video.videoHeight) {
          const oc = document.createElement('canvas');
          oc.width = video.videoWidth;
          oc.height = video.videoHeight;
          offscreenCanvasRef.current = oc;
        }
        const octx = offscreenCanvasRef.current.getContext('2d');
        if (octx) octx.drawImage(video, 0, 0);

        const results = poseLandmarker.detectForVideo(offscreenCanvasRef.current, startTimeMs);

        // Clear canvas
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // Draw landmarks if enabled
          if (optionsRef.current.enableDrawing && results.landmarks && results.landmarks.length > 0) {
            const drawingUtils = new DrawingUtils(ctx);
            
            for (const landmark of results.landmarks) {
              drawingUtils.drawLandmarks(landmark, {
                radius: 4,
                color: '#00FF00',
                fillColor: '#00FF00',
              });
              drawingUtils.drawConnectors(
                landmark,
                PoseLandmarker.POSE_CONNECTIONS,
                { color: '#00FF00', lineWidth: 2 }
              );
            }
          }
        }

        // Extract pose landmarks
        if (results.landmarks && results.landmarks.length > 0) {
          const landmarks = results.landmarks[0];

          // Map MediaPipe landmarks to our format with visibility scores
          // MediaPipe landmark indices: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
          const poseLandmarks: PoseLandmarks = {
            nose: { ...landmarks[0], visibility: landmarks[0].visibility },
            leftEye: { ...landmarks[1], visibility: landmarks[1].visibility },
            rightEye: { ...landmarks[2], visibility: landmarks[2].visibility },
            leftEar: { ...landmarks[3], visibility: landmarks[3].visibility },
            rightEar: { ...landmarks[4], visibility: landmarks[4].visibility },
            leftShoulder: { ...landmarks[11], visibility: landmarks[11].visibility },
            rightShoulder: { ...landmarks[12], visibility: landmarks[12].visibility },
            leftElbow: { ...landmarks[13], visibility: landmarks[13].visibility },
            rightElbow: { ...landmarks[14], visibility: landmarks[14].visibility },
            leftWrist: { ...landmarks[15], visibility: landmarks[15].visibility },
            rightWrist: { ...landmarks[16], visibility: landmarks[16].visibility },
            leftHip: { ...landmarks[23], visibility: landmarks[23].visibility },
            rightHip: { ...landmarks[24], visibility: landmarks[24].visibility },
            leftKnee: { ...landmarks[25], visibility: landmarks[25].visibility },
            rightKnee: { ...landmarks[26], visibility: landmarks[26].visibility },
            leftAnkle: { ...landmarks[27], visibility: landmarks[27].visibility },
            rightAnkle: { ...landmarks[28], visibility: landmarks[28].visibility },
          };

          setCurrentLandmarks(poseLandmarks);
          optionsRef.current.onPoseDetected?.(poseLandmarks);
        }
      } catch (err) {
        console.error('Pose detection error:', err);
      }

      if (isDetectingRef.current) {
        animationFrameRef.current = requestAnimationFrame(detectPose);
      }
    };

    detectPose();
  }, [isReady, videoRef, canvasRef]);

  const stopDetection = useCallback(() => {
    setIsDetecting(false);
    isDetectingRef.current = false;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  return {
    isReady,
    isDetecting,
    currentLandmarks,
    error,
    startDetection,
    stopDetection,
  };
}