import type {PoseLandmarkerResult} from '@mediapipe/tasks-vision';
import type {PoseLandmarks} from '../hooks/useMediaPipePose';
export function poseLandmarkerResultToLandmarks(result:PoseLandmarkerResult):PoseLandmarks|null {
      if (!result.landmarks || result.landmarks.length === 0) return null;
      const lm = result.landmarks[0];
      return {
        nose:          { x: lm[0].x,  y: lm[0].y,  z: lm[0].z,  visibility: lm[0].visibility },
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
}
