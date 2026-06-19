import { useRef, useState, useEffect, type RefObject } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useDualMediaPipePose } from '../hooks/useDualMediaPipePose';
import { useTriangulation } from '../hooks/useTriangulation';
import { useCameraCalibration } from '../hooks/useCameraCalibration';
import { StereoCalibration } from '../type/calibration';
import { Upload, Activity, Eye, EyeOff } from 'lucide-react';

interface TriangulationViewProps {
  camera1Ref: RefObject<HTMLVideoElement | null>;
  camera2Ref: RefObject<HTMLVideoElement | null>;
  camera1Stream: MediaStream | null;
  camera2Stream: MediaStream | null;
  isBothCamerasActive: boolean;
  preloadedCalibration?: StereoCalibration | null;
}

function CoordDisplay({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div className="flex flex-col items-center bg-gray-800 rounded-lg p-4 flex-1">
      <span className={`text-xs font-bold uppercase tracking-widest mb-1 ${color}`}>{label}</span>
      <span className="text-3xl font-mono font-bold text-white">
        {value !== null ? value.toFixed(1) : '—'}
      </span>
      <span className="text-xs text-gray-500 mt-1">mm</span>
    </div>
  );
}

export function TriangulationView({
  camera1Ref,
  camera2Ref,
  camera1Stream,
  camera2Stream,
  isBothCamerasActive,
  preloadedCalibration,
}: TriangulationViewProps) {
  const { loadCalibration, calibrationResult } = useCameraCalibration();
  const calibFileRef = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showFeeds, setShowFeeds] = useState(true);

  // Stable video refs — only set srcObject when the stream instance changes,
  // not on every render (which would black out the feed each frame).
  const displayVideo1Ref = useRef<HTMLVideoElement | null>(null);
  const displayVideo2Ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (displayVideo1Ref.current && camera1Stream) {
      displayVideo1Ref.current.srcObject = camera1Stream;
    }
  }, [camera1Stream]);

  useEffect(() => {
    if (displayVideo2Ref.current && camera2Stream) {
      displayVideo2Ref.current.srcObject = camera2Stream;
    }
  }, [camera2Stream]);

  const calibration = calibrationResult ?? preloadedCalibration ?? null;

  const videoEl1 = camera1Ref.current;
  const videoEl2 = camera2Ref.current;

  const { camera1Landmarks, camera2Landmarks, isLoaded: poseLoaded, error: poseError } = useDualMediaPipePose(
    videoEl1,
    videoEl2,
    isBothCamerasActive,
  );

  const cam1W = videoEl1?.videoWidth ?? 1280;
  const cam1H = videoEl1?.videoHeight ?? 720;
  const cam2W = videoEl2?.videoWidth ?? 1280;
  const cam2H = videoEl2?.videoHeight ?? 720;

  const { leftWrist } = useTriangulation(
    calibration,
    camera1Landmarks,
    camera2Landmarks,
    cam1W, cam1H,
    cam2W, cam2H,
  );

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
  };

  const isTracking = leftWrist !== null;

  return (
    <div className="space-y-6">

      {/* Status bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Badge className={poseLoaded ? 'bg-green-700' : 'bg-yellow-700'}>
          {poseLoaded ? 'MediaPipe Ready' : 'Loading MediaPipe...'}
        </Badge>
        <Badge className={calibration ? 'bg-green-700' : 'bg-red-700'}>
          {calibration ? 'Calibration Loaded' : 'No Calibration'}
        </Badge>
        <Badge className={isBothCamerasActive ? 'bg-green-700' : 'bg-gray-700'}>
          {isBothCamerasActive ? 'Both Cameras Active' : 'Cameras Offline'}
        </Badge>
        <Badge className={isTracking ? 'bg-blue-600 animate-pulse' : 'bg-gray-700'}>
          {isTracking ? 'Tracking' : 'No Detection'}
        </Badge>
      </div>

      {poseError && (
        <Card className="bg-red-900/20 border-red-700 p-3 text-sm text-red-300">{poseError}</Card>
      )}

      {/* Calibration loader (if not already loaded) */}
      {!calibration && (
        <Card className="bg-gray-900 border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-3">Load Stereo Calibration</h3>
          <p className="text-sm text-gray-400 mb-4">
            Load the <code className="text-green-400 bg-gray-800 px-1 rounded">stereo_calibration.json</code> file
            produced by the Python calibration script.
          </p>
          <Button onClick={() => calibFileRef.current?.click()} variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Load stereo_calibration.json
          </Button>
          <input ref={calibFileRef} type="file" accept=".json" onChange={handleLoadCalibration} className="hidden" />
          {loadError && (
            <div className="mt-3 bg-red-900/40 border border-red-700 rounded p-3 text-sm text-red-300 whitespace-pre-wrap">
              {loadError}
            </div>
          )}
        </Card>
      )}

      {/* Live X/Y/Z display — left wrist */}
      <Card className="bg-gray-900 border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-400" />
            Left Wrist — 3D Position
          </h3>
          {calibration?.stereoReprojectionError != null && (
            <span className="text-xs text-gray-500">
              Stereo error: {calibration.stereoReprojectionError.toFixed(3)} px
            </span>
          )}
        </div>

        <div className="flex gap-3 mb-4">
          <CoordDisplay label="X" value={leftWrist?.x ?? null} color="text-red-400" />
          <CoordDisplay label="Y" value={leftWrist?.y ?? null} color="text-green-400" />
          <CoordDisplay label="Z" value={leftWrist?.z ?? null} color="text-blue-400" />
        </div>

        {!isBothCamerasActive && (
          <p className="text-sm text-yellow-400">⚠️ Start both cameras in the Camera Setup tab first.</p>
        )}
        {isBothCamerasActive && !calibration && (
          <p className="text-sm text-yellow-400">⚠️ Load a calibration file above to enable triangulation.</p>
        )}
        {isBothCamerasActive && calibration && !isTracking && poseLoaded && (
          <p className="text-sm text-gray-500">Move your left wrist into view of both cameras...</p>
        )}
      </Card>

      {/* Camera feeds with pose overlay */}
      <Card className="bg-gray-900 border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Camera Feeds</h3>
          <Button variant="outline" size="sm" onClick={() => setShowFeeds(v => !v)}>
            {showFeeds ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
            {showFeeds ? 'Hide' : 'Show'}
          </Button>
        </div>

        {showFeeds && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: 'Camera 1', stream: camera1Stream, lm: camera1Landmarks, videoRef: displayVideo1Ref, w: cam1W, h: cam1H },
              { label: 'Camera 2', stream: camera2Stream, lm: camera2Landmarks, videoRef: displayVideo2Ref, w: cam2W, h: cam2H },
            ].map(({ label, stream, lm, videoRef, w, h }, i) => (
              <div key={i}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-400">{label}</p>
                  {lm?.leftWrist && (lm.leftWrist.visibility ?? 1) > 0.5 && (
                    <span className="text-xs text-green-400">
                      wrist ({(lm.leftWrist.x * w).toFixed(0)}, {(lm.leftWrist.y * h).toFixed(0)}) px
                    </span>
                  )}
                </div>
                <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                  <video
                    ref={videoRef}
                    autoPlay playsInline muted
                    className="w-full h-full object-contain"
                  />
                  {lm?.leftWrist && (lm.leftWrist.visibility ?? 1) > 0.5 && (
                    <div
                      className="absolute w-4 h-4 rounded-full bg-red-500 border-2 border-white shadow-lg"
                      style={{
                        left: `calc(${lm.leftWrist.x * 100}% - 8px)`,
                        top: `calc(${lm.leftWrist.y * 100}% - 8px)`,
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                  {!stream && (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
                      {label} not active
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
