import { useState, useEffect, useCallback } from 'react';

declare global {
  interface Window {
    cv: any;
  }
}

export function useOpenCV() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if OpenCV is already loaded
    if (window.cv && window.cv.Mat && window.cv.findChessboardCorners) {
      console.log('✅ OpenCV.js already loaded (calib3d available)');
      setIsLoaded(true);
      return;
    }

    // Load OpenCV.js
    const loadOpenCV = async () => {
      setIsLoading(true);
      console.log('📦 Loading OpenCV.js...');

      try {
        const script = document.createElement('script');
        // Load OpenCV.js from local public directory
        script.src = '/opencv.js';
        script.async = true;

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            const missing = !window.cv ? 'cv not loaded'
              : !window.cv.Mat ? 'cv.Mat missing'
              : 'cv.findChessboardCorners missing';
            reject(new Error(`OpenCV.js init timeout: ${missing}`));
          }, 30000);

          const finish = () => {
            clearTimeout(timeout);
            if (typeof window.cv?.findChessboardCorners === 'function') {
              console.log('✅ OpenCV.js ready (calib3d confirmed)');
              resolve();
            } else {
              reject(new Error('OpenCV loaded but calib3d not available'));
            }
          };

          script.onload = () => {
            console.log('📦 OpenCV.js script loaded, waiting for WASM...');

            const tryAttach = () => {
              if (!window.cv) return false;
              // Already fully initialized
              if (typeof window.cv.findChessboardCorners === 'function') {
                finish();
                return true;
              }
              // WASM not done yet — hook onRuntimeInitialized
              window.cv['onRuntimeInitialized'] = finish;
              return true;
            };

            if (!tryAttach()) {
              const poll = setInterval(() => {
                if (tryAttach()) clearInterval(poll);
              }, 50);
            }
          };

          script.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('Failed to load OpenCV.js script'));
          };

          document.head.appendChild(script);
        });

        setIsLoaded(true);
        setIsLoading(false);
      } catch (err) {
        const errorMsg = 'Failed to load OpenCV.js: ' + (err as Error).message;
        console.error('❌', errorMsg);
        setError(errorMsg);
        setIsLoading(false);
      }
    };

    loadOpenCV();
  }, []);

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
            cv.TERM_CRITERIA_EPS + cv.TERM_CRITERIA_MAX_ITER,
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
    isLoading,
    error,
    detectCheckerboard,
  };
}