// Camera calibration types for stereo vision

export interface IntrinsicCalibration {
  // Camera matrix (3x3)
  K: number[][];
  // Distortion coefficients [k1, k2, p1, p2, k3]
  distortion: number[];
  // Image size used for calibration
  imageWidth: number;
  imageHeight: number;
  // Reprojection error (lower is better)
  reprojectionError: number;
  /** Maps decoded raw normalized coordinates into the calibration image domain.
   * Optional only for legacy files whose orientation/crop provenance was not saved. */
  imageGeometry?: {
    observationSpace: 'raw_distorted';
    rawToCalibrationNormalized: number[][];
    /** Explicit assertion for a verified full-frame anisotropic resize, not a driver crop. */
    fullFrameResizeVerified?: boolean;
    description: string;
  };
}

export interface ExtrinsicCalibration {
  // Rotation matrix (3x3) from camera 1 to camera 2
  R: number[][];
  // Translation vector (3x1) from camera 1 to camera 2
  T: number[];
  // Essential matrix
  E: number[][];
  // Fundamental matrix
  F: number[][];
}

export interface StereoCalibration {
  camera1: IntrinsicCalibration;
  camera2: IntrinsicCalibration;
  extrinsic: ExtrinsicCalibration;
  // Legacy rectified projection matrices: NOT compatible with raw image pixels.
  P1?: number[][];
  P2?: number[][];
  R1?: number[][];
  R2?: number[][];
  projectionSpace?: 'rectified';
  units?: 'mm';
  // Quality metrics
  stereoReprojectionError: number;
  calibrationDate: string;
  checkerboardConfig: {
    rows: number;
    cols: number;
    squareSize: number; // in mm
  };
}

export interface CalibrationImage {
  id: string;
  cameraId: number;
  timestamp: number;
  imageData: string; // base64 encoded
  cornersDetected: boolean;
  detectionStatus?: 'unprocessed' | 'detected' | 'not_found' | 'processing_error';
  detectionError?: string | null;
  detectionPattern?: {rows:number;cols:number};
  cornerCount?: number;
  corners?: number[][]; // detected corner [x, y] coordinates
  imageWidth?: number;
  imageHeight?: number;
}

export interface CalibrationCapture {
  id: string;
  timestamp: number;
  camera1Image: CalibrationImage;
  camera2Image: CalibrationImage;
  bothCornersDetected: boolean;
}
