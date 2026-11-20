import { useSyncExternalStore, useCallback } from 'react';
import {subscribeOpenCVRuntime,getOpenCVRuntimeState,retryOpenCVRuntime,calibrationCapabilities} from '../utils/openCVRuntime';

declare global {
  interface Window {
    cv: any;
  }
}

export function useOpenCV() {
  const {isLoaded,isLoading,error}=useSyncExternalStore(subscribeOpenCVRuntime,getOpenCVRuntimeState,getOpenCVRuntimeState);

  const detectCheckerboard = useCallback(
    (
      imageData: ImageData,
      patternSize: { width: number; height: number }
    ): { found: boolean; corners?: number[][]; error?: string } => {
      if (!isLoaded || !window.cv) {
        return { found: false, error: 'OpenCV not loaded' };
      }

      try {
        const cv = window.cv;

        // Convert ImageData to cv.Mat
        const src = cv.matFromImageData(imageData);
        const gray = new cv.Mat();

        // Convert to grayscale
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        // Find chessboard corners
        const corners = new cv.Mat();
        const patternSizeCV = new cv.Size(patternSize.width, patternSize.height);

        const found = cv.findChessboardCorners(
          gray,
          patternSizeCV,
          corners,
          cv.CALIB_CB_ADAPTIVE_THRESH + cv.CALIB_CB_NORMALIZE_IMAGE
        );

        if (found) {
          // Refine corner positions for sub-pixel accuracy
          const criteria = new cv.TermCriteria(
            cv.TermCriteria_EPS + cv.TermCriteria_MAX_ITER,
            30,
            0.001
          );

          cv.cornerSubPix(gray, corners, new cv.Size(11, 11), new cv.Size(-1, -1), criteria);

          // Extract corner coordinates
          const cornerArray: number[][] = [];
          for (let i = 0; i < corners.rows; i++) {
            cornerArray.push([corners.data32F[i * 2], corners.data32F[i * 2 + 1]]);
          }

          // Cleanup
          src.delete();
          gray.delete();
          corners.delete();

          console.log(`✅ Found ${cornerArray.length} corners`);
          return { found: true, corners: cornerArray };
        } else {
          // Cleanup
          src.delete();
          gray.delete();
          corners.delete();

          console.log('❌ No checkerboard corners found');
          return { found: false };
        }
      } catch (err) {
        console.error('❌ Checkerboard detection error:', err);
        return { found: false, error: (err as Error).message };
      }
    },
    [isLoaded]
  );

  return {
    isLoaded,
    calibrationReady: isLoaded && calibrationCapabilities(window.cv).ready,
    missingCalibrationBindings: calibrationCapabilities(typeof window==='undefined'?null:window.cv).missing,
    isLoading,
    error,
    detectCheckerboard,
    retry: retryOpenCVRuntime,
  };
}