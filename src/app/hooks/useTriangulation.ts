import { Matrix, SVD } from 'ml-matrix';
import { StereoCalibration } from '../type/calibration';
import { PoseLandmarks } from './useMediaPipePose';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export type TriangulatedPose = {
  [K in keyof PoseLandmarks]: Point3D | null;
};

export const LANDMARK_KEYS: Array<keyof PoseLandmarks> = [
  'nose',
  'leftEye', 'rightEye',
  'leftEar', 'rightEar',
  'leftShoulder', 'rightShoulder',
  'leftElbow', 'rightElbow',
  'leftWrist', 'rightWrist',
  'leftHip', 'rightHip',
  'leftKnee', 'rightKnee',
  'leftAnkle', 'rightAnkle',
];

export const SKELETON_CONNECTIONS: Array<[keyof PoseLandmarks, keyof PoseLandmarks]> = [
  ['nose', 'leftEye'], ['nose', 'rightEye'],
  ['leftEye', 'leftEar'], ['rightEye', 'rightEar'],
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'],
];

/**
 * DLT triangulation via real SVD null-space extraction.
 *
 * Builds the 4×4 DLT matrix A from the two projection equations per camera:
 *   x1*(P1[2]·X) - P1[0]·X = 0
 *   y1*(P1[2]·X) - P1[1]·X = 0
 *   (same for camera 2)
 *
 * Then decomposes A with SVD (A = U · diag(S) · Vᵀ). The right singular
 * vector corresponding to the smallest singular value — the last column of V
 * since ml-matrix sorts S in descending order — is the least-squares solution
 * to the homogeneous system AX = 0. Dividing by the homogeneous coordinate W
 * yields the 3D Cartesian point.
 */
function triangulatePoint(
  p1: number[][], p2: number[][],
  x1: number, y1: number,
  x2: number, y2: number,
): Point3D | null {
  const A = new Matrix([
    [x1*p1[2][0]-p1[0][0], x1*p1[2][1]-p1[0][1], x1*p1[2][2]-p1[0][2], x1*p1[2][3]-p1[0][3]],
    [y1*p1[2][0]-p1[1][0], y1*p1[2][1]-p1[1][1], y1*p1[2][2]-p1[1][2], y1*p1[2][3]-p1[1][3]],
    [x2*p2[2][0]-p2[0][0], x2*p2[2][1]-p2[0][1], x2*p2[2][2]-p2[0][2], x2*p2[2][3]-p2[0][3]],
    [y2*p2[2][0]-p2[1][0], y2*p2[2][1]-p2[1][1], y2*p2[2][2]-p2[1][2], y2*p2[2][3]-p2[1][3]],
  ]);

  // SVD: A = U · diag(S) · Vᵀ, singular values sorted descending.
  // rightSingularVectors is V; its last column is the null vector.
  const svd = new SVD(A, { autoTranspose: true });
  const col = svd.rightSingularVectors.getColumn(3); // [X, Y, Z, W]
  const w = col[3];
  if (Math.abs(w) < 1e-10) return null;

  return { x: col[0] / w, y: col[1] / w, z: col[2] / w };
}

/**
 * Triangulate all landmarks for a stereo frame.
 * Pure function — safe to call inside rAF/rVFC callbacks outside React.
 */
export function triangulateAllLandmarks(
  calibration: StereoCalibration,
  cam1Landmarks: PoseLandmarks,
  cam2Landmarks: PoseLandmarks,
  cam1Width: number, cam1Height: number,
  cam2Width: number, cam2Height: number,
): TriangulatedPose {
  const empty = Object.fromEntries(LANDMARK_KEYS.map(k => [k, null])) as TriangulatedPose;
  const P1 = calibration.P1;
  const P2 = calibration.P2;
  if (!P1 || !P2) return empty;

  const pose = { ...empty };
  for (const key of LANDMARK_KEYS) {
    const lm1 = cam1Landmarks[key];
    const lm2 = cam2Landmarks[key];
    if (!lm1 || !lm2) continue;
    if ((lm1.visibility ?? 1) < 0.5 || (lm2.visibility ?? 1) < 0.5) continue;
    pose[key] = triangulatePoint(
      P1, P2,
      lm1.x * cam1Width, lm1.y * cam1Height,
      lm2.x * cam2Width, lm2.y * cam2Height,
    );
  }
  return pose;
}

export type { StereoCalibration };

// ── Legacy hook for components that use useMemo-based triangulation ───────────
// StereoVideoPlayback uses this for playback (not live capture), so the
// double-triangulation concern doesn't apply there.
import { useMemo } from 'react';

export function useTriangulation(
  calibration: StereoCalibration | null,
  cam1Landmarks: PoseLandmarks | null,
  cam2Landmarks: PoseLandmarks | null,
  cam1Width: number, cam1Height: number,
  cam2Width: number, cam2Height: number,
): { pose: TriangulatedPose } {
  return useMemo(() => {
    const empty = Object.fromEntries(LANDMARK_KEYS.map(k => [k, null])) as TriangulatedPose;
    if (!calibration || !cam1Landmarks || !cam2Landmarks) return { pose: empty };
    if (!cam1Width || !cam1Height || !cam2Width || !cam2Height) return { pose: empty };
    return { pose: triangulateAllLandmarks(calibration, cam1Landmarks, cam2Landmarks, cam1Width, cam1Height, cam2Width, cam2Height) };
  }, [calibration, cam1Landmarks, cam2Landmarks, cam1Width, cam1Height, cam2Width, cam2Height]);
}
