import { useCallback, useRef } from 'react';
import {
  useMotionRecorder,
  type MotionFrameRecordResult,
} from './useMotionRecorder';
import { PoseLandmarks } from './useMediaPipePose';
import { TriangulatedPose, LANDMARK_KEYS } from './useTriangulation';

/**
 * Existing stereo-to-MotionRecording adapter, exported so experiment tests and
 * future capture orchestration can reuse the exact same coordinate/visibility
 * conventions without duplicating conversion logic.
 */
export function triangulatedPoseToMotionLandmarks(
  pose3Dmm: TriangulatedPose,
  cam1Landmarks: PoseLandmarks | null,
): PoseLandmarks {
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
  return landmarks;
}

export function useStereoMotionRecorder() {
  const recorder = useMotionRecorder();
  const debugCountersRef = useRef({ recordStereoFrameCalls: 0, recordFrameCalls: 0 });

  // Destructure stable values instead of depending on the whole recorder object.
  // recorder is a new object reference on every render, so [recorder] would
  // recreate these callbacks every render — causing any useEffect that depends
  // on them to fire on every re-render rather than only on new stereo frames.
  const { recordFrame, recordFrameAtTime } = recorder;

  const recordStereoFrame = useCallback(
    (pose3Dmm: TriangulatedPose, cam1Landmarks: PoseLandmarks | null) => {
      debugCountersRef.current.recordStereoFrameCalls += 1;
      recordFrame(triangulatedPoseToMotionLandmarks(pose3Dmm, cam1Landmarks));
    },
    [recordFrame],
  );

  const recordStereoFrameAtTime = useCallback(
    (
      pose3Dmm: TriangulatedPose,
      cam1Landmarks: PoseLandmarks | null,
      experimentTimeMs: number,
    ): MotionFrameRecordResult => {
      debugCountersRef.current.recordStereoFrameCalls += 1;
      return recordFrameAtTime(
        triangulatedPoseToMotionLandmarks(pose3Dmm, cam1Landmarks),
        experimentTimeMs,
      );
    },
    [recordFrameAtTime],
  );

  const recordBackProjectedFrame = useCallback(
    (backProjected2Dmm: TriangulatedPose, cam1Landmarks: PoseLandmarks | null) => {
      recordFrame(triangulatedPoseToMotionLandmarks(backProjected2Dmm, cam1Landmarks));
    },
    [recordFrame],
  );

  const recordBackProjectedFrameAtTime = useCallback(
    (
      backProjected2Dmm: TriangulatedPose,
      cam1Landmarks: PoseLandmarks | null,
      experimentTimeMs: number,
    ): MotionFrameRecordResult => {
      return recordFrameAtTime(
        triangulatedPoseToMotionLandmarks(backProjected2Dmm, cam1Landmarks),
        experimentTimeMs,
      );
    },
    [recordFrameAtTime],
  );

  return {
    ...recorder,
    recordStereoFrame,
    recordStereoFrameAtTime,
    recordBackProjectedFrame,
    recordBackProjectedFrameAtTime,
    debugCounters: debugCountersRef,
  };
}
