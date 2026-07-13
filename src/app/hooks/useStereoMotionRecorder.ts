import { useCallback } from 'react';
import { useMotionRecorder } from './useMotionRecorder';
import { PoseLandmarks } from './useMediaPipePose';
import { TriangulatedPose, LANDMARK_KEYS } from './useTriangulation';

/**
 * Wraps useMotionRecorder for the 3D stereo pipeline.
 *
 * Both pose3Dmm and backProjected2Dmm are in millimetres, so jitter variance
 * is physically meaningful and directly comparable between the two labs —
 * no normalization or scale factors applied.
 *
 * Visibility comes from camera 1 MediaPipe confidence. Joints that failed
 * triangulation get visibility=0 so they are flagged as occluded in quality metrics.
 */
export function useStereoMotionRecorder() {
  const recorder = useMotionRecorder();

  /**
   * Record a frame using the stereo-triangulated 3D position (mm).
   * Use for the 3D lab jitter metrics.
   */
  const recordStereoFrame = useCallback(
    (pose3Dmm: TriangulatedPose, cam1Landmarks: PoseLandmarks | null) => {
      if (!recorder.isRecording) return;

      const landmarks = {} as PoseLandmarks;
      for (const key of LANDMARK_KEYS) {
        const pt = pose3Dmm[key];
        const lm = cam1Landmarks?.[key];
        landmarks[key] = {
          x: pt?.x ?? 0,
          y: pt?.y ?? 0,
          z: pt?.z ?? 0,
          visibility: pt !== null ? (lm?.visibility ?? 1) : 0,
        };
      }

      recorder.recordFrame(landmarks);
    },
    [recorder],
  );

  /**
   * Record a frame using camera 1's 2D detection back-projected to mm.
   * Use for the 2D lab jitter metrics so variance is in the same unit (mm)
   * as the 3D lab and directly comparable.
   */
  const recordBackProjectedFrame = useCallback(
    (backProjected2Dmm: TriangulatedPose, cam1Landmarks: PoseLandmarks | null) => {
      if (!recorder.isRecording) return;

      const landmarks = {} as PoseLandmarks;
      for (const key of LANDMARK_KEYS) {
        const pt = backProjected2Dmm[key];
        const lm = cam1Landmarks?.[key];
        landmarks[key] = {
          x: pt?.x ?? 0,
          y: pt?.y ?? 0,
          z: pt?.z ?? 0,
          visibility: pt !== null ? (lm?.visibility ?? 1) : 0,
        };
      }

      recorder.recordFrame(landmarks);
    },
    [recorder],
  );

  return { ...recorder, recordStereoFrame, recordBackProjectedFrame };
}
