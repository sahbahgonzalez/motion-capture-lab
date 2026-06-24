import { useMemo } from 'react';
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

function triangulatePoint(
  p1: number[][], p2: number[][],
  x1: number, y1: number,
  x2: number, y2: number,
): Point3D | null {
  const A: number[][] = [
    [x1*p1[2][0]-p1[0][0], x1*p1[2][1]-p1[0][1], x1*p1[2][2]-p1[0][2], x1*p1[2][3]-p1[0][3]],
    [y1*p1[2][0]-p1[1][0], y1*p1[2][1]-p1[1][1], y1*p1[2][2]-p1[1][2], y1*p1[2][3]-p1[1][3]],
    [x2*p2[2][0]-p2[0][0], x2*p2[2][1]-p2[0][1], x2*p2[2][2]-p2[0][2], x2*p2[2][3]-p2[0][3]],
    [y2*p2[2][0]-p2[1][0], y2*p2[2][1]-p2[1][1], y2*p2[2][2]-p2[1][2], y2*p2[2][3]-p2[1][3]],
  ];

  const X = svdSolve(A);
  if (!X || Math.abs(X[3]) < 1e-10) return null;

  return { x: X[0]/X[3], y: X[1]/X[3], z: X[2]/X[3] };
}

function svdSolve(A: number[][]): number[] | null {
  const n = 4;
  const M = A.map(row => [...row]);

  for (let col = 0; col < n - 1; col++) {
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > maxVal) { maxVal = Math.abs(M[row][col]); maxRow = row; }
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) continue;
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let k = col; k < n; k++) M[row][k] -= factor * M[col][k];
    }
  }

  const X = new Array(n).fill(0);
  X[n - 1] = 1;
  for (let row = n - 2; row >= 0; row--) {
    if (Math.abs(M[row][row]) < 1e-12) { X[row] = 1; continue; }
    let sum = 0;
    for (let col = row + 1; col < n; col++) sum += M[row][col] * X[col];
    X[row] = -sum / M[row][row];
  }

  return X;
}

export function useTriangulation(
  calibration: StereoCalibration | null,
  cam1Landmarks: PoseLandmarks | null,
  cam2Landmarks: PoseLandmarks | null,
  cam1Width: number,
  cam1Height: number,
  cam2Width: number,
  cam2Height: number,
): TriangulatedPose {
  return useMemo(() => {
    const empty = Object.fromEntries(LANDMARK_KEYS.map(k => [k, null])) as TriangulatedPose;

    if (!calibration || !cam1Landmarks || !cam2Landmarks) return empty;
    if (!cam1Width || !cam1Height || !cam2Width || !cam2Height) return empty;

    const P1 = calibration.P1;
    const P2 = calibration.P2;
    if (!P1 || !P2) return empty;

    const result = { ...empty };

    for (const key of LANDMARK_KEYS) {
      const lm1 = cam1Landmarks[key];
      const lm2 = cam2Landmarks[key];
      if (!lm1 || !lm2) continue;
      if ((lm1.visibility ?? 1) < 0.5 || (lm2.visibility ?? 1) < 0.5) continue;
      result[key] = triangulatePoint(
        P1, P2,
        lm1.x * cam1Width, lm1.y * cam1Height,
        lm2.x * cam2Width, lm2.y * cam2Height,
      );
    }

    return result;
  }, [calibration, cam1Landmarks, cam2Landmarks, cam1Width, cam1Height, cam2Width, cam2Height]);
}
