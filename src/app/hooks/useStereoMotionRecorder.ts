import { useCallback } from 'react';
import { useMotionRecorder } from './useMotionRecorder';
import { PoseLandmarks } from './useMediaPipePose';
import { TriangulatedPose, LANDMARK_KEYS } from './useTriangulation';

/**
 * Wraps useMotionRecorder for the 3D stereo pipeline.
 *
 * Converts a TriangulatedPose (x/y/z in mm) into a MotionFrame so that
 * every existing analysis function (jitter, occlusion, limb swap, depth)
 * works without modification — values are just in mm instead of [0,1].
 *
 * Visibility is taken from camera 1 landmarks so occlusion analysis
 * reflects real MediaPipe confidence, not triangulation success.
 * Joints that failed triangulation get visibility=0 so they are flagged
 * as occluded in the quality metrics.
 */
export function useStereoMotionRecorder() {
  const recorder = useMotionRecorder();

  const recordStereoFrame = useCallback(
    (pose3D: TriangulatedPose, cam1Landmarks: PoseLandmarks | null) => {
      if (!recorder.isRecording) return;

      const landmarks = {} as PoseLandmarks;

      for (const key of LANDMARK_KEYS) {
        const pt = pose3D[key];
        const lm = cam1Landmarks?.[key];
        landmarks[key] = {
          x: pt?.x ?? 0,
          y: pt?.y ?? 0,
          z: pt?.z ?? 0,
          // visibility=0 when not triangulated so occlusion metrics catch it
          visibility: pt !== null ? (lm?.visibility ?? 1) : 0,
        };
      }

      recorder.recordFrame(landmarks);
    },
    [recorder],
  );

  return { ...recorder, recordStereoFrame };
}
