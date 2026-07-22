import { useCallback } from 'react';
import { useMotionRecorder } from './useMotionRecorder';
import { PoseLandmarks } from './useMediaPipePose';
import { TriangulatedPose, LANDMARK_KEYS } from './useTriangulation';

export function useStereoMotionRecorder() {
  const recorder = useMotionRecorder();

  // Destructure stable values instead of depending on the whole recorder object.
  // recorder is a new object reference on every render, so [recorder] would
  // recreate these callbacks every render — causing any useEffect that depends
  // on them to fire on every re-render rather than only on new stereo frames.
  const { isRecording, recordFrame } = recorder;

  const recordStereoFrame = useCallback(
    (pose3Dmm: TriangulatedPose, cam1Landmarks: PoseLandmarks | null) => {
      if (!isRecording) return;
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
      recordFrame(landmarks);
    },
    [isRecording, recordFrame],
  );

  const recordBackProjectedFrame = useCallback(
    (backProjected2Dmm: TriangulatedPose, cam1Landmarks: PoseLandmarks | null) => {
      if (!isRecording) return;
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
      recordFrame(landmarks);
    },
    [isRecording, recordFrame],
  );

  return { ...recorder, recordStereoFrame, recordBackProjectedFrame };
}
