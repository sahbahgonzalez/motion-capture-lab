import { useState, useEffect, useCallback, useRef } from 'react';
import type React from 'react';
import { PoseLandmarker, FilesetResolver, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { PoseLandmarks } from './useMediaPipePose';

// requestVideoFrameCallback is not yet in the standard TypeScript DOM lib.
declare global {
  interface HTMLVideoElement {
    requestVideoFrameCallback(
      callback: (now: DOMHighResTimeStamp, metadata: unknown) => void,
    ): number;
    cancelVideoFrameCallback(handle: number): void;
  }
}

const SUPPORTS_RVFC =
  typeof HTMLVideoElement !== 'undefined' &&
  'requestVideoFrameCallback' in HTMLVideoElement.prototype;

export function useDualMediaPipePose(
  videoElement1: HTMLVideoElement | null,
  videoElement2: HTMLVideoElement | null,
  isActive: boolean,
  // Fired exactly once per completed stereo processing cycle — inside the
  // video-frame callback, before any React state update, so it always runs
  // at most once per genuine new camera frame.
  onStereoFrame?: React.MutableRefObject<
    ((lm1: PoseLandmarks | null, lm2: PoseLandmarks | null) => void) | null
  >,
) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [camera1Landmarks, setCamera1Landmarks] = useState<PoseLandmarks | null>(null);
  const [camera2Landmarks, setCamera2Landmarks] = useState<PoseLandmarks | null>(null);
  const [error, setError] = useState<string | null>(null);

  const poseLandmarker1Ref = useRef<PoseLandmarker | null>(null);
  const poseLandmarker2Ref = useRef<PoseLandmarker | null>(null);
  const loopHandleRef = useRef<number | null>(null);
  const offscreenCanvas1Ref = useRef<HTMLCanvasElement | null>(null);
  const offscreenCanvas2Ref = useRef<HTMLCanvasElement | null>(null);
  // Used only by the rAF fallback to skip duplicate camera frames.
  const lastVideoTime1Ref = useRef<number>(-1);

  // Live refs — keep the processing loop free of stale closures without
  // needing to restart it when these values change.
  const isActiveRef = useRef(isActive);
  const videoEl1Ref = useRef(videoElement1);
  const videoEl2Ref = useRef(videoElement2);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => { videoEl1Ref.current = videoElement1; }, [videoElement1]);
  useEffect(() => { videoEl2Ref.current = videoElement2; }, [videoElement2]);

  // ── Initialization ────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
        );
        const opts = {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU' as const,
          },
          runningMode: 'VIDEO' as const,
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        };
        const [lm1, lm2] = await Promise.all([
          PoseLandmarker.createFromOptions(vision, opts),
          PoseLandmarker.createFromOptions(vision, opts),
        ]);
        if (!mounted) { lm1.close(); lm2.close(); return; }
        poseLandmarker1Ref.current = lm1;
        poseLandmarker2Ref.current = lm2;
        setIsLoaded(true);
      } catch (err) {
        if (mounted) setError('Failed to initialize MediaPipe: ' + (err as Error).message);
      }
    };

    init();
    return () => {
      mounted = false;
      poseLandmarker1Ref.current?.close();
      poseLandmarker2Ref.current?.close();
    };
  }, []);

  // ── Landmark conversion ───────────────────────────────────────────────────
  const convertToLandmarks = useCallback(
    (result: PoseLandmarkerResult): PoseLandmarks | null => {
      if (!result.landmarks || result.landmarks.length === 0) return null;
      const lm = result.landmarks[0];
      return {
        nose:          { x: lm[0].x,  y: lm[0].y,  z: lm[0].z,  visibility: lm[0].visibility },
        leftEye:       { x: lm[1].x,  y: lm[1].y,  z: lm[1].z,  visibility: lm[1].visibility },
        rightEye:      { x: lm[2].x,  y: lm[2].y,  z: lm[2].z,  visibility: lm[2].visibility },
        leftEar:       { x: lm[3].x,  y: lm[3].y,  z: lm[3].z,  visibility: lm[3].visibility },
        rightEar:      { x: lm[4].x,  y: lm[4].y,  z: lm[4].z,  visibility: lm[4].visibility },
        leftShoulder:  { x: lm[11].x, y: lm[11].y, z: lm[11].z, visibility: lm[11].visibility },
        rightShoulder: { x: lm[12].x, y: lm[12].y, z: lm[12].z, visibility: lm[12].visibility },
        leftElbow:     { x: lm[13].x, y: lm[13].y, z: lm[13].z, visibility: lm[13].visibility },
        rightElbow:    { x: lm[14].x, y: lm[14].y, z: lm[14].z, visibility: lm[14].visibility },
        leftWrist:     { x: lm[15].x, y: lm[15].y, z: lm[15].z, visibility: lm[15].visibility },
        rightWrist:    { x: lm[16].x, y: lm[16].y, z: lm[16].z, visibility: lm[16].visibility },
        leftHip:       { x: lm[23].x, y: lm[23].y, z: lm[23].z, visibility: lm[23].visibility },
        rightHip:      { x: lm[24].x, y: lm[24].y, z: lm[24].z, visibility: lm[24].visibility },
        leftKnee:      { x: lm[25].x, y: lm[25].y, z: lm[25].z, visibility: lm[25].visibility },
        rightKnee:     { x: lm[26].x, y: lm[26].y, z: lm[26].z, visibility: lm[26].visibility },
        leftAnkle:     { x: lm[27].x, y: lm[27].y, z: lm[27].z, visibility: lm[27].visibility },
        rightAnkle:    { x: lm[28].x, y: lm[28].y, z: lm[28].z, visibility: lm[28].visibility },
      };
    },
    [],
  );

  // ── Core stereo processing ────────────────────────────────────────────────
  // Runs cam1 detect → cam2 detect in sequence, then fires onStereoFrame and
  // updates React display state. Called at most once per genuine new cam1 frame.
  const processStereoFrame = useCallback(
    (timestamp: number) => {
      const v1 = videoEl1Ref.current;
      const v2 = videoEl2Ref.current;
      let lm1: PoseLandmarks | null = null;
      let lm2: PoseLandmarks | null = null;

      if (v1 && poseLandmarker1Ref.current && v1.readyState >= 2) {
        const w = v1.videoWidth, h = v1.videoHeight;
        if (
          !offscreenCanvas1Ref.current ||
          offscreenCanvas1Ref.current.width !== w ||
          offscreenCanvas1Ref.current.height !== h
        ) {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          offscreenCanvas1Ref.current = c;
        }
        const ctx = offscreenCanvas1Ref.current.getContext('2d');
        if (ctx) {
          ctx.drawImage(v1, 0, 0, w, h);
          lm1 = convertToLandmarks(
            poseLandmarker1Ref.current.detectForVideo(offscreenCanvas1Ref.current, timestamp),
          );
        }
      }

      if (v2 && poseLandmarker2Ref.current && v2.readyState >= 2) {
        const w = v2.videoWidth, h = v2.videoHeight;
        if (
          !offscreenCanvas2Ref.current ||
          offscreenCanvas2Ref.current.width !== w ||
          offscreenCanvas2Ref.current.height !== h
        ) {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          offscreenCanvas2Ref.current = c;
        }
        const ctx = offscreenCanvas2Ref.current.getContext('2d');
        if (ctx) {
          ctx.drawImage(v2, 0, 0, w, h);
          lm2 = convertToLandmarks(
            poseLandmarker2Ref.current.detectForVideo(offscreenCanvas2Ref.current, timestamp),
          );
        }
      }

      // Per-frame callback runs synchronously here — before setState — so
      // triangulation and recording happen exactly once per stereo cycle.
      onStereoFrame?.current?.(lm1, lm2);

      // One batched React update per stereo frame for the 2D overlay display.
      setCamera1Landmarks(lm1);
      setCamera2Landmarks(lm2);
    },
    [convertToLandmarks, onStereoFrame],
  );

  // ── Frame scheduling: rVFC (preferred) or rAF + currentTime dedup ─────────
  useEffect(() => {
    if (!isLoaded || !isActive || !videoElement1 || !videoElement2) {
      setIsRunning(false);
      return;
    }

    setIsRunning(true);
    lastVideoTime1Ref.current = -1;
    let active = true;

    const schedule = () => {
      if (!active) return;
      const v1 = videoEl1Ref.current;
      if (!v1) return;

      if (SUPPORTS_RVFC) {
        // Fire exactly when the video element presents a new decoded frame.
        loopHandleRef.current = v1.requestVideoFrameCallback((now) => {
          if (!active) return;
          processStereoFrame(now);
          schedule();
        });
      } else {
        // Fallback: rAF loop with currentTime guard to skip duplicate frames.
        loopHandleRef.current = requestAnimationFrame(() => {
          if (!active) return;
          const v = videoEl1Ref.current;
          if (v && v.currentTime !== lastVideoTime1Ref.current) {
            lastVideoTime1Ref.current = v.currentTime;
            processStereoFrame(performance.now());
          }
          schedule();
        });
      }
    };

    schedule();

    return () => {
      active = false;
      setIsRunning(false);
      if (loopHandleRef.current !== null) {
        if (SUPPORTS_RVFC) {
          videoElement1.cancelVideoFrameCallback(loopHandleRef.current);
        } else {
          cancelAnimationFrame(loopHandleRef.current);
        }
        loopHandleRef.current = null;
      }
    };
  }, [isLoaded, isActive, videoElement1, videoElement2, processStereoFrame]);

  return {
    isLoaded,
    isRunning,
    camera1Landmarks,
    camera2Landmarks,
    error,
  };
}
