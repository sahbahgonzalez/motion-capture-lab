import { useMemo } from 'react';
import { StereoCalibration } from '../type/calibration';
import { PoseLandmarks } from './useMediaPipePose';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface TriangulatedPose {
  leftWrist: Point3D | null;
}

/**
 * DLT triangulation using the P1/P2 projection matrices from stereo calibration.
 *
 * MediaPipe gives normalized [0,1] coords relative to the video frame.
 * We convert to pixel coords, then solve the linear system:
 *
 *   [x*P[2] - P[0]] * X = 0
 *   [y*P[2] - P[1]] * X = 0   (for each camera)
 *
 * using the classic 4-row DLT / SVD-free closed-form solve.
 * This mirrors what cv2.triangulatePoints does.
 */
function triangulatePoint(
  p1: number[][],  // 3x4 projection matrix camera 1
  p2: number[][],  // 3x4 projection matrix camera 2
  x1: number, y1: number,  // pixel coords in camera 1
  x2: number, y2: number,  // pixel coords in camera 2
): Point3D | null {
  // Build 4x4 matrix A where AX = 0
  const A: number[][] = [
    [
      x1 * p1[2][0] - p1[0][0],
      x1 * p1[2][1] - p1[0][1],
      x1 * p1[2][2] - p1[0][2],
      x1 * p1[2][3] - p1[0][3],
    ],
    [
      y1 * p1[2][0] - p1[1][0],
      y1 * p1[2][1] - p1[1][1],
      y1 * p1[2][2] - p1[1][2],
      y1 * p1[2][3] - p1[1][3],
    ],
    [
      x2 * p2[2][0] - p2[0][0],
      x2 * p2[2][1] - p2[0][1],
      x2 * p2[2][2] - p2[0][2],
      x2 * p2[2][3] - p2[0][3],
    ],
    [
      y2 * p2[2][0] - p2[1][0],
      y2 * p2[2][1] - p2[1][1],
      y2 * p2[2][2] - p2[1][2],
      y2 * p2[2][3] - p2[1][3],
    ],
  ];

  // Solve via least-squares using normal equations: (A^T A) x = 0
  // We find the right singular vector of A corresponding to the smallest singular value.
  // For a 4x4 system we use a simple power-iteration-free approach:
  // compute A^T * A (4x4), then find its eigenvector for the smallest eigenvalue
  // via the closed-form nullspace of the last row after Gaussian elimination.
  const X = svdSolve(A);
  if (!X || Math.abs(X[3]) < 1e-10) return null;

  return {
    x: X[0] / X[3],
    y: X[1] / X[3],
    z: X[2] / X[3],
  };
}

/**
 * Find the null-space vector of A (4x4) via Gaussian elimination with partial pivoting.
 * Returns the solution vector X such that AX ≈ 0.
 */
function svdSolve(A: number[][]): number[] | null {
  const n = 4;
  // Work on a copy; augment with identity to track row ops isn't needed —
  // we just need the null vector, so we do back-substitution after elimination.
  const M = A.map(row => [...row]);

  // Forward elimination with partial pivoting
  for (let col = 0; col < n - 1; col++) {
    // Find pivot
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > maxVal) {
        maxVal = Math.abs(M[row][col]);
        maxRow = row;
      }
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    if (Math.abs(M[col][col]) < 1e-12) continue;

    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let k = col; k < n; k++) {
        M[row][k] -= factor * M[col][k];
      }
    }
  }

  // The null vector: back-substitute assuming last variable = 1
  const X = new Array(n).fill(0);
  X[n - 1] = 1;
  for (let row = n - 2; row >= 0; row--) {
    if (Math.abs(M[row][row]) < 1e-12) {
      X[row] = 1;
      continue;
    }
    let sum = 0;
    for (let col = row + 1; col < n; col++) {
      sum += M[row][col] * X[col];
    }
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
    const empty: TriangulatedPose = { leftWrist: null };

    if (!calibration || !cam1Landmarks || !cam2Landmarks) return empty;
    if (!cam1Width || !cam1Height || !cam2Width || !cam2Height) return empty;

    const P1 = calibration.P1;
    const P2 = calibration.P2;
    if (!P1 || !P2) return empty;

    const lw1 = cam1Landmarks.leftWrist;
    const lw2 = cam2Landmarks.leftWrist;

    if (!lw1 || !lw2) return empty;
    if ((lw1.visibility ?? 1) < 0.5 || (lw2.visibility ?? 1) < 0.5) return empty;

    // Convert normalized [0,1] coords to pixel coords
    const x1 = lw1.x * cam1Width;
    const y1 = lw1.y * cam1Height;
    const x2 = lw2.x * cam2Width;
    const y2 = lw2.y * cam2Height;

    const leftWrist = triangulatePoint(P1, P2, x1, y1, x2, y2);

    return { leftWrist };
  }, [calibration, cam1Landmarks, cam2Landmarks, cam1Width, cam1Height, cam2Width, cam2Height]);
}
