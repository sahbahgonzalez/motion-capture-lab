import { useState, useRef, type RefObject } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useCameraCalibration } from '../hooks/useCameraCalibration';
import { useOpenCV } from '../hooks/useOpenCV';
import { CalibrationCapture, CalibrationImage } from '../type/calibration';
import {
  Camera,
  CheckCircle2,
  Download,
  Upload,
  Trash2,
  Grid3x3,
  Terminal,
  FolderOpen,
  Play,
  Loader2,
  AlertCircle,
} from 'lucide-react';

interface CalibrationViewProps {
  camera1Stream: MediaStream | null;
  camera2Stream: MediaStream | null;
  camera1Ref: RefObject<HTMLVideoElement | null>;
  camera2Ref: RefObject<HTMLVideoElement | null>;
  isBothCamerasActive: boolean;
}

async function detectCornersFromDataURL(
  dataURL: string,
  patternSize: { width: number; height: number },
  cv: any,
): Promise<{ found: boolean; corners?: number[][]; width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      try {
        const src = cv.matFromImageData(imageData);
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        const corners = new cv.Mat();
        const found = cv.findChessboardCorners(
          gray,
          new cv.Size(patternSize.width, patternSize.height),
          corners,
          cv.CALIB_CB_ADAPTIVE_THRESH + cv.CALIB_CB_NORMALIZE_IMAGE,
        );

        if (found) {
          const criteria = new cv.TermCriteria(
            cv.TERM_CRITERIA_EPS + cv.TERM_CRITERIA_MAX_ITER, 30, 0.001,
          );
          cv.cornerSubPix(gray, corners, new cv.Size(11, 11), new cv.Size(-1, -1), criteria);
          const cornerArray: number[][] = [];
          for (let i = 0; i < corners.rows; i++) {
            cornerArray.push([corners.data32F[i * 2], corners.data32F[i * 2 + 1]]);
          }
          src.delete(); gray.delete(); corners.delete();
          resolve({ found: true, corners: cornerArray, width: img.width, height: img.height });
        } else {
          src.delete(); gray.delete(); corners.delete();
          resolve({ found: false, width: img.width, height: img.height });
        }
      } catch {
        resolve({ found: false, width: img.width, height: img.height });
      }
    };
    img.onerror = () => resolve({ found: false, width: 0, height: 0 });
    img.src = dataURL;
  });
}

export function CalibrationView({
  camera1Stream,
  camera2Stream,
  camera1Ref,
  camera2Ref,
  isBothCamerasActive,
}: CalibrationViewProps) {
  const {
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
  } = useCameraCalibration();

  const { isLoaded: cvLoaded, isLoading: cvLoading } = useOpenCV();

  const [checkerboardRows, setCheckerboardRows] = useState(5);
  const [checkerboardCols, setCheckerboardCols] = useState(8);
  const [squareSize, setSquareSize] = useState(25);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [calibError, setCalibError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);

  const canvas1Ref = useRef<HTMLCanvasElement>(null);
  const canvas2Ref = useRef<HTMLCanvasElement>(null);
  const calibFileRef = useRef<HTMLInputElement>(null);
  const capturesFileRef = useRef<HTMLInputElement>(null);

  const captureFrame = () => {
    const v1 = camera1Ref.current;
    const v2 = camera2Ref.current;
    if (!v1 || !v2 || !canvas1Ref.current || !canvas2Ref.current) return;

    const c1 = canvas1Ref.current;
    const c2 = canvas2Ref.current;
    const ctx1 = c1.getContext('2d');
    const ctx2 = c2.getContext('2d');
    if (!ctx1 || !ctx2) return;

    const w1 = v1.videoWidth, h1 = v1.videoHeight;
    const w2 = v2.videoWidth, h2 = v2.videoHeight;
    if (!w1 || !h1 || !w2 || !h2) return;

    c1.width = w1; c1.height = h1;
    c2.width = w2; c2.height = h2;
    ctx1.drawImage(v1, 0, 0);
    ctx2.drawImage(v2, 0, 0);

    const ts = Date.now();

    const image1: CalibrationImage = {
      id: `cam1_${ts}`,
      cameraId: 1,
      timestamp: ts,
      imageData: c1.toDataURL('image/jpeg', 0.85),
      cornersDetected: false,
      imageWidth: w1,
      imageHeight: h1,
    };

    const image2: CalibrationImage = {
      id: `cam2_${ts}`,
      cameraId: 2,
      timestamp: ts,
      imageData: c2.toDataURL('image/jpeg', 0.85),
      cornersDetected: false,
      imageWidth: w2,
      imageHeight: h2,
    };

    addCapture({
      id: `capture_${ts}`,
      timestamp: ts,
      camera1Image: image1,
      camera2Image: image2,
      bothCornersDetected: false,
    });
  };

  const exportCaptures = () => {
    const payload = {
      checkerboardConfig: { rows: checkerboardRows, cols: checkerboardCols, squareSize },
      capturedAt: new Date().toISOString(),
      captures,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `captures_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadCalibration = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        loadCalibration(ev.target?.result as string);
      } catch (err) {
        setLoadError((err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImportCaptures = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadError(null);
    setImportStatus(null);
    setCalibError(null);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (!parsed.captures || !Array.isArray(parsed.captures)) {
          throw new Error('Not a captures file — expected a JSON with a "captures" array.');
        }

        const config = parsed.checkerboardConfig;
        const rows = config?.rows ?? checkerboardRows;
        const cols = config?.cols ?? checkerboardCols;
        const sq = config?.squareSize ?? squareSize;
        if (config) {
          setCheckerboardRows(rows);
          setCheckerboardCols(cols);
          setSquareSize(sq);
        }

        const rawCaptures: CalibrationCapture[] = parsed.captures;

        if (!cvLoaded || !window.cv) {
          importCaptures(rawCaptures);
          setImportStatus(
            `Loaded ${rawCaptures.length} captures. OpenCV not ready yet — wait for it to finish loading, then try again.`,
          );
          return;
        }

        const cv = window.cv;
        const patternSize = { width: cols - 1, height: rows - 1 };

        setImportProgress({ done: 0, total: rawCaptures.length });
        setImportStatus('Detecting checkerboard corners in each image…');

        const processed: CalibrationCapture[] = [];
        let bothDetected = 0;

        for (let i = 0; i < rawCaptures.length; i++) {
          const cap = rawCaptures[i];
          setImportProgress({ done: i + 1, total: rawCaptures.length });

          const [r1, r2] = await Promise.all([
            detectCornersFromDataURL(cap.camera1Image.imageData, patternSize, cv),
            detectCornersFromDataURL(cap.camera2Image.imageData, patternSize, cv),
          ]);

          processed.push({
            ...cap,
            camera1Image: {
              ...cap.camera1Image,
              cornersDetected: r1.found,
              corners: r1.corners,
              imageWidth: r1.width || cap.camera1Image.imageWidth,
              imageHeight: r1.height || cap.camera1Image.imageHeight,
            },
            camera2Image: {
              ...cap.camera2Image,
              cornersDetected: r2.found,
              corners: r2.corners,
              imageWidth: r2.width || cap.camera2Image.imageWidth,
              imageHeight: r2.height || cap.camera2Image.imageHeight,
            },
            bothCornersDetected: r1.found && r2.found,
          });

          if (r1.found && r2.found) bothDetected++;
          await new Promise(r => setTimeout(r, 0));
        }

        importCaptures(processed);
        setImportProgress(null);
        setImportStatus(
          `Imported ${processed.length} captures — ${bothDetected} have corners detected in both cameras.` +
          (bothDetected >= 10
            ? ' Ready to calibrate!'
            : ` Need at least 10 good pairs (${10 - bothDetected} more needed).`),
        );
      } catch (err) {
        setImportProgress(null);
        setLoadError((err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const runCalibration = async () => {
    setCalibError(null);
    try {
      await performCalibration(checkerboardRows, checkerboardCols, squareSize);
    } catch (err) {
      setCalibError((err as Error).message);
    }
  };

  const goodCaptures = captures.filter(c => c.bothCornersDetected).length;

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <Card className="bg-gray-900 border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
          <Grid3x3 className="h-5 w-5" />
          Stereo Calibration
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-sm font-semibold text-blue-300 mb-2">In-browser (recommended)</p>
            <ol className="space-y-1 text-xs text-gray-300 list-decimal list-inside">
              <li>Set checkerboard config below</li>
              <li>Capture 15–20 frames, or <strong>Import Captures JSON</strong></li>
              <li>Click <strong>Run Calibration</strong></li>
              <li>Save the result and load it in 3D Reconstruction</li>
            </ol>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-sm font-semibold text-gray-300 mb-2">Python script</p>
            <div className="bg-gray-950 rounded p-2 font-mono text-xs text-green-300 space-y-1">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Terminal className="h-3 w-3" /> terminal
              </div>
              <div>pip install opencv-python numpy</div>
              <div>python calibrate_stereo.py --json captures.json \</div>
              <div className="pl-4">--rows {checkerboardRows} --cols {checkerboardCols} --square {squareSize}</div>
            </div>
          </div>
        </div>
      </Card>

      {/* Checkerboard settings */}
      <Card className="bg-gray-900 border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Checkerboard Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label className="text-gray-300">Inner Rows</Label>
            <Input
              type="number"
              value={checkerboardRows}
              onChange={(e) => setCheckerboardRows(parseInt(e.target.value))}
              className="bg-gray-800 border-gray-700 text-white mt-1"
              min={3} max={15}
            />
            <p className="text-xs text-gray-500 mt-1">Squares − 1 vertically</p>
          </div>
          <div>
            <Label className="text-gray-300">Inner Cols</Label>
            <Input
              type="number"
              value={checkerboardCols}
              onChange={(e) => setCheckerboardCols(parseInt(e.target.value))}
              className="bg-gray-800 border-gray-700 text-white mt-1"
              min={3} max={15}
            />
            <p className="text-xs text-gray-500 mt-1">Squares − 1 horizontally</p>
          </div>
          <div>
            <Label className="text-gray-300">Square Size (mm)</Label>
            <Input
              type="number"
              value={squareSize}
              onChange={(e) => setSquareSize(parseInt(e.target.value))}
              className="bg-gray-800 border-gray-700 text-white mt-1"
              min={1} max={100}
            />
            <p className="text-xs text-gray-500 mt-1">Physical size of each square</p>
          </div>
        </div>
      </Card>

      {/* Live feeds */}
      <Card className="bg-gray-900 border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Camera className="h-5 w-5" />
          Live Feeds
        </h3>
        {!isBothCamerasActive && (
          <p className="text-sm text-yellow-400 mb-3">⚠️ Both cameras must be active to capture.</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {[
            { label: 'Camera 1', stream: camera1Stream },
            { label: 'Camera 2', stream: camera2Stream },
          ].map(({ label, stream }, i) => (
            <div key={i}>
              <p className="text-sm text-gray-400 mb-2">{label}</p>
              <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                <video
                  ref={(el) => { if (el && stream) el.srcObject = stream; }}
                  autoPlay playsInline muted
                  className="w-full h-full object-contain"
                  style={{ transform: 'scaleX(-1)' }}
                />
                {!stream && (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
                    {label} not active
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <Button onClick={captureFrame} disabled={!isBothCamerasActive} className="bg-blue-600 hover:bg-blue-700">
          <Camera className="h-4 w-4 mr-2" />
          Capture Frame
        </Button>
      </Card>

      {/* Captured frames */}
      <Card className="bg-gray-900 border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Captured Frames</h3>
            <p className="text-sm text-gray-400">
              {captures.length} pairs &mdash; {goodCaptures} with corners in both cameras
              {captures.length > 0 && goodCaptures < 10 && (
                <span className="text-yellow-400"> (need {10 - goodCaptures} more)</span>
              )}
              {goodCaptures >= 10 && (
                <span className="text-green-400"> ✓ ready</span>
              )}
            </p>
          </div>
          {captures.length > 0 && (
            <Button onClick={clearCaptures} variant="outline" size="sm">
              <Trash2 className="h-4 w-4 mr-2" />
              Clear
            </Button>
          )}
        </div>

        {captures.length > 0 && (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {captures.map((cap, idx) => (
              <div key={cap.id} className="flex gap-2 items-center p-2 rounded border border-gray-700">
                <span className="text-xs text-gray-500 w-5 shrink-0">{idx + 1}</span>
                <div className="flex gap-2 flex-1">
                  <img src={cap.camera1Image.imageData} alt="cam1" className="flex-1 h-16 object-cover rounded" />
                  <img src={cap.camera2Image.imageData} alt="cam2" className="flex-1 h-16 object-cover rounded" />
                </div>
                <div className="shrink-0 text-xs text-center w-16">
                  {cap.bothCornersDetected ? (
                    <span className="text-green-400">✓ both</span>
                  ) : (
                    <span className="text-red-400">
                      {cap.camera1Image.cornersDetected ? '✓' : '✗'}/{cap.camera2Image.cornersDetected ? '✓' : '✗'}
                    </span>
                  )}
                </div>
                <button onClick={() => removeCapture(cap.id)} className="bg-red-600 hover:bg-red-700 rounded p-1 shrink-0">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Import / Export / Calibrate */}
      <Card className="bg-gray-900 border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Import / Export / Calibrate</h3>

        <div className="flex gap-3 flex-wrap mb-4">
          <Button
            onClick={() => capturesFileRef.current?.click()}
            variant="outline"
            className="border-blue-600 text-blue-300 hover:bg-blue-900/30"
            disabled={!!importProgress}
          >
            {importProgress ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FolderOpen className="h-4 w-4 mr-2" />}
            {importProgress
              ? `Detecting corners ${importProgress.done}/${importProgress.total}…`
              : 'Import Captures JSON'}
          </Button>
          <input ref={capturesFileRef} type="file" accept=".json" onChange={handleImportCaptures} className="hidden" />

          <Button onClick={exportCaptures} disabled={captures.length === 0} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export Captures JSON
          </Button>

          <Button
            onClick={runCalibration}
            disabled={goodCaptures < 10 || isCalibrating || !cvLoaded}
            className="bg-green-700 hover:bg-green-600 disabled:opacity-50"
            title={
              !cvLoaded ? 'OpenCV not ready' :
              goodCaptures < 10 ? `Need ${10 - goodCaptures} more good pairs` : ''
            }
          >
            {isCalibrating
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <Play className="h-4 w-4 mr-2" />}
            {isCalibrating ? 'Calibrating…' : 'Run Calibration'}
          </Button>

          <Button onClick={() => calibFileRef.current?.click()} variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Load stereo_calibration.json
          </Button>
          <input ref={calibFileRef} type="file" accept=".json" onChange={handleLoadCalibration} className="hidden" />
        </div>

        {cvLoading && (
          <p className="text-xs text-yellow-400 flex items-center gap-1 mb-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading OpenCV.js…
          </p>
        )}
        {importStatus && (
          <div className="mt-2 bg-blue-900/30 border border-blue-700 rounded p-3 text-sm text-blue-200">
            {importStatus}
          </div>
        )}
        {loadError && (
          <div className="mt-2 bg-red-900/40 border border-red-700 rounded p-3 text-sm text-red-300 whitespace-pre-wrap flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {loadError}
          </div>
        )}
        {calibError && (
          <div className="mt-2 bg-red-900/40 border border-red-700 rounded p-3 text-sm text-red-300 whitespace-pre-wrap flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {calibError}
          </div>
        )}
      </Card>

      {/* Calibration result */}
      {calibrationResult?.camera1 && calibrationResult?.camera2 && (
        <Card className="bg-gray-900 border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Calibration Ready
            </h3>
            <Button onClick={() => saveCalibration()} className="bg-green-700 hover:bg-green-600" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Save stereo_calibration.json
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-gray-800 p-3 rounded">
              <div className="text-sm text-gray-400">Camera 1 Error</div>
              <div className="text-2xl font-bold text-white">
                {calibrationResult.camera1.reprojectionError?.toFixed(3) ?? '—'} px
              </div>
            </div>
            <div className="bg-gray-800 p-3 rounded">
              <div className="text-sm text-gray-400">Camera 2 Error</div>
              <div className="text-2xl font-bold text-white">
                {calibrationResult.camera2.reprojectionError?.toFixed(3) ?? '—'} px
              </div>
            </div>
            <div className="bg-gray-800 p-3 rounded">
              <div className="text-sm text-gray-400">Stereo Error</div>
              <div className="text-2xl font-bold text-white">
                {calibrationResult.stereoReprojectionError?.toFixed(3) ?? '—'} px
              </div>
            </div>
          </div>
          <p className="text-sm text-gray-400">
            Save the file above, then load it in the <strong className="text-white">3D Reconstruction</strong> tab.
          </p>
          {calibrationResult.calibrationDate && (
            <div className="text-xs text-gray-500 mt-2">
              Calibrated: {new Date(calibrationResult.calibrationDate).toLocaleString()}
            </div>
          )}
        </Card>
      )}

      <canvas ref={canvas1Ref} style={{ display: 'none' }} />
      <canvas ref={canvas2Ref} style={{ display: 'none' }} />
    </div>
  );
}
