import { useState, useCallback } from 'react';
import { StereoCalibration, CalibrationCapture, IntrinsicCalibration } from '../type/calibration';

declare global {
  interface Window {
    cv: any;
  }
}

// Build 3D object points for a checkerboard pattern
// Inner corners: (cols-1) x (rows-1), Z=0 (flat board)
function buildObjectPoints(
  cv: any,
  numCorners: number,
  checkerboardRows: number,
  checkerboardCols: number,
  squareSize: number
): any {
  const objPts = new cv.Mat(numCorners, 1, cv.CV_32FC3);
  const innerCols = checkerboardCols - 1;
  for (let i = 0; i < checkerboardRows - 1; i++) {
    for (let j = 0; j < innerCols; j++) {
      const idx = i * innerCols + j;
      objPts.data32F[idx * 3 + 0] = j * squareSize;
      objPts.data32F[idx * 3 + 1] = i * squareSize;
      objPts.data32F[idx * 3 + 2] = 0;
    }
  }
  return objPts;
}

// Convert JS number[][] corners to OpenCV Mat (CV_32FC2)
function cornersToMat(cv: any, corners: number[][]): any {
  const mat = new cv.Mat(corners.length, 1, cv.CV_32FC2);
  for (let i = 0; i < corners.length; i++) {
    mat.data32F[i * 2 + 0] = corners[i][0];
    mat.data32F[i * 2 + 1] = corners[i][1];
  }
  return mat;
}

// Extract a 3x3 matrix from a cv.Mat
function matTo3x3(mat: any): number[][] {
  return [
    [mat.data64F[0], mat.data64F[1], mat.data64F[2]],
    [mat.data64F[3], mat.data64F[4], mat.data64F[5]],
    [mat.data64F[6], mat.data64F[7], mat.data64F[8]],
  ];
}

// Extract a 3x4 matrix from a cv.Mat
function matTo3x4(mat: any): number[][] {
  return [
    [mat.data64F[0], mat.data64F[1], mat.data64F[2], mat.data64F[3]],
    [mat.data64F[4], mat.data64F[5], mat.data64F[6], mat.data64F[7]],
    [mat.data64F[8], mat.data64F[9], mat.data64F[10], mat.data64F[11]],
  ];
}

// Extract distortion coefficients as a flat array
function matToDistCoeffs(mat: any): number[] {
  const result: number[] = [];
  const n = mat.rows * mat.cols;
  for (let i = 0; i < n; i++) {
    result.push(mat.data64F[i]);
  }
  return result;
}

export function useCameraCalibration() {
  const [captures, setCaptures] = useState<CalibrationCapture[]>([]);
  const [calibrationResult, setCalibrationResult] = useState<StereoCalibration | null>(null);
  const [isCalibrating, setIsCalibrating] = useState(false);

  const addCapture = useCallback((capture: CalibrationCapture) => {
    setCaptures((prev) => [...prev, capture]);
    console.log(`📸 Added calibration capture ${capture.id}. Total: ${captures.length + 1}`);
  }, [captures.length]);

  const removeCapture = useCallback((captureId: string) => {
    setCaptures((prev) => prev.filter((c) => c.id !== captureId));
    console.log(`🗑️ Removed calibration capture ${captureId}`);
  }, []);

  const clearCaptures = useCallback(() => {
    setCaptures([]);
    console.log('🗑️ Cleared all calibration captures');
  }, []);

  const importCaptures = useCallback((newCaptures: CalibrationCapture[]) => {
    setCaptures(newCaptures);
    console.log(`📂 Imported ${newCaptures.length} captures`);
  }, []);

  const performCalibration = useCallback(
    async (
      checkerboardRows: number,
      checkerboardCols: number,
      squareSize: number
    ): Promise<StereoCalibration | null> => {
      if (captures.length < 10) {
        console.warn('⚠️ Need at least 10 good capture pairs for calibration');
        return null;
      }

      setIsCalibrating(true);
      console.log('🔬 Starting stereo calibration with', captures.length, 'image pairs...');

      // Defer to next tick so React can update UI state
      await new Promise((resolve) => setTimeout(resolve, 0));

      const cv = window.cv;
      if (!cv || !cv.Mat) {
        setIsCalibrating(false);
        throw new Error('OpenCV.js is not loaded');
      }

      const mats: any[] = [];
      const track = (m: any) => { mats.push(m); return m; };
      const cleanup = () => mats.forEach((m) => { try { m.delete(); } catch (_) {} });

      try {
        // Filter captures where both cameras detected corners
        const validCaptures = captures.filter(
          (c) =>
            c.bothCornersDetected &&
            c.camera1Image.corners &&
            c.camera1Image.corners.length > 0 &&
            c.camera2Image.corners &&
            c.camera2Image.corners.length > 0
        );

        if (validCaptures.length < 10) {
          throw new Error(
            `Not enough valid captures: need 10+, have ${validCaptures.length}. Make sure corners are detected in both cameras.`
          );
        }

        console.log(`✅ Using ${validCaptures.length} valid capture pairs`);

        const numCorners = (checkerboardRows - 1) * (checkerboardCols - 1);

        // Determine image size from first valid capture
        const imgW = validCaptures[0].camera1Image.imageWidth ?? 1280;
        const imgH = validCaptures[0].camera1Image.imageHeight ?? 720;
        const imageSize = new cv.Size(imgW, imgH);
        track(imageSize);

        // Build object/image point vectors for calibrateCamera
        const objPoints1 = track(new cv.MatVector());
        const imgPoints1 = track(new cv.MatVector());
        const objPoints2 = track(new cv.MatVector());
        const imgPoints2 = track(new cv.MatVector());

        for (const cap of validCaptures) {
          const objPts = track(buildObjectPoints(cv, numCorners, checkerboardRows, checkerboardCols, squareSize));
          const corners1 = track(cornersToMat(cv, cap.camera1Image.corners!));
          const corners2 = track(cornersToMat(cv, cap.camera2Image.corners!));

          // Each camera needs its own copy of the object points
          const objPts2copy = track(buildObjectPoints(cv, numCorners, checkerboardRows, checkerboardCols, squareSize));

          objPoints1.push_back(objPts);
          imgPoints1.push_back(corners1);
          objPoints2.push_back(objPts2copy);
          imgPoints2.push_back(corners2);
        }

        // --- Individual camera calibration ---
        console.log('📷 Calibrating camera 1...');
        const K1 = track(new cv.Mat());
        const dist1 = track(new cv.Mat());
        const rvecs1 = track(new cv.MatVector());
        const tvecs1 = track(new cv.MatVector());

        const err1 = cv.calibrateCamera(objPoints1, imgPoints1, imageSize, K1, dist1, rvecs1, tvecs1);
        console.log(`  Camera 1 reprojection error: ${err1.toFixed(4)} px`);

        console.log('📷 Calibrating camera 2...');
        const K2 = track(new cv.Mat());
        const dist2 = track(new cv.Mat());
        const rvecs2 = track(new cv.MatVector());
        const tvecs2 = track(new cv.MatVector());

        const err2 = cv.calibrateCamera(objPoints2, imgPoints2, imageSize, K2, dist2, rvecs2, tvecs2);
        console.log(`  Camera 2 reprojection error: ${err2.toFixed(4)} px`);

        // --- Stereo calibration ---
        console.log('🔗 Running stereo calibration...');
        const R = track(new cv.Mat());
        const T = track(new cv.Mat());
        const E = track(new cv.Mat());
        const F = track(new cv.Mat());

        // Use CALIB_FIX_INTRINSIC to keep the individually-calibrated intrinsics fixed
        // and only optimize the extrinsic parameters
        const stereoFlags = cv.CALIB_FIX_INTRINSIC;

        const stereoErr = cv.stereoCalibrate(
          objPoints1,
          imgPoints1,
          imgPoints2,
          K1,
          dist1,
          K2,
          dist2,
          imageSize,
          R,
          T,
          E,
          F,
          stereoFlags
        );

        console.log(`  Stereo reprojection error: ${stereoErr.toFixed(4)} px`);

        // --- Stereo rectification ---
        console.log('🔲 Computing rectification...');
        const R1 = track(new cv.Mat());
        const R2 = track(new cv.Mat());
        const P1 = track(new cv.Mat());
        const P2 = track(new cv.Mat());
        const Q = track(new cv.Mat());

        cv.stereoRectify(
          K1, dist1,
          K2, dist2,
          imageSize,
          R, T,
          R1, R2, P1, P2, Q,
          cv.CALIB_ZERO_DISPARITY,
          0,        // alpha=0: crop to valid pixels
          imageSize
        );

        // Extract translation as a flat vector
        const Tvec: number[] = [];
        for (let i = 0; i < T.rows * T.cols; i++) {
          Tvec.push(T.data64F[i]);
        }

        const result: StereoCalibration = {
          camera1: {
            K: matTo3x3(K1),
            distortion: matToDistCoeffs(dist1),
            imageWidth: imgW,
            imageHeight: imgH,
            reprojectionError: err1,
          },
          camera2: {
            K: matTo3x3(K2),
            distortion: matToDistCoeffs(dist2),
            imageWidth: imgW,
            imageHeight: imgH,
            reprojectionError: err2,
          },
          extrinsic: {
            R: matTo3x3(R),
            T: Tvec,
            E: matTo3x3(E),
            F: matTo3x3(F),
          },
          P1: matTo3x4(P1),
          P2: matTo3x4(P2),
          stereoReprojectionError: stereoErr,
          calibrationDate: new Date().toISOString(),
          checkerboardConfig: {
            rows: checkerboardRows,
            cols: checkerboardCols,
            squareSize,
          },
        };

        console.log('✅ Stereo calibration complete!');
        console.log(`  Camera 1 reprojection error: ${result.camera1.reprojectionError.toFixed(4)} px`);
        console.log(`  Camera 2 reprojection error: ${result.camera2.reprojectionError.toFixed(4)} px`);
        console.log(`  Stereo reprojection error:   ${result.stereoReprojectionError.toFixed(4)} px`);
        console.log('  Translation (baseline):', result.extrinsic.T);

        cleanup();
        setCalibrationResult(result);
        setIsCalibrating(false);
        return result;
      } catch (err) {
        cleanup();
        console.error('❌ Calibration failed:', err);
        setIsCalibrating(false);
        throw err;
      }
    },
    [captures]
  );

  const saveCalibration = useCallback(
    (filename?: string) => {
      if (!calibrationResult) {
        console.warn('⚠️ No calibration to save');
        return;
      }

      const json = JSON.stringify(calibrationResult, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `stereo_calibration_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);

      console.log('💾 Saved calibration to', a.download);
    },
    [calibrationResult]
  );

  const loadCalibration = useCallback((json: string) => {
    try {
      const parsed = JSON.parse(json);

      if (parsed.captures || parsed.capturedAt) {
        throw new Error(
          'This is a captures export, not a calibration file.\n\n' +
          'Go to the Calibration tab → click "Import Captures JSON" to load this file, ' +
          'detect corners, and run calibration in-browser.\n\n' +
          'Then save the result and load it here as stereo_calibration.json.'
        );
      }

      if (!parsed.camera1 || !parsed.camera2 || parsed.stereoReprojectionError == null) {
        throw new Error('Invalid calibration file — missing required fields (camera1, camera2, stereoReprojectionError).');
      }
      if (!parsed.P1 || !parsed.P2) {
        throw new Error(
          'Invalid calibration file — missing P1/P2 projection matrices.\n' +
          'Make sure you used the Python calibration script that outputs stereo_calibration.json with P1 and P2 fields.'
        );
      }

      const calibration: StereoCalibration = parsed;
      setCalibrationResult(calibration);
      console.log('📂 Loaded calibration from file');
      console.log('  Calibration date:', calibration.calibrationDate);
      console.log('  Stereo error:', calibration.stereoReprojectionError);
      return calibration;
    } catch (err) {
      console.error('❌ Failed to load calibration:', err);
      throw err;
    }
  }, []);

  return {
    captures,
    addCapture,
    removeCapture,
    clearCaptures,
    importCaptures,
    calibrationResult,
    isCalibrating,
    performCalibration,
    saveCalibration,
    loadCalibration,
  };
}
