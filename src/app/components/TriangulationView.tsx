import { useRef, useState, useEffect, type RefObject } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useDualMediaPipePose } from '../hooks/useDualMediaPipePose';
import { useTriangulation, LANDMARK_KEYS, SKELETON_CONNECTIONS } from '../hooks/useTriangulation';
import { useCameraCalibration } from '../hooks/useCameraCalibration';
import { StereoCalibration } from '../type/calibration';
import { PoseLandmarks } from '../hooks/useMediaPipePose';
import { Upload, Activity, Eye, EyeOff } from 'lucide-react';

interface TriangulationViewProps {
  camera1Ref: RefObject<HTMLVideoElement | null>;
  camera2Ref: RefObject<HTMLVideoElement | null>;
  camera1Stream: MediaStream | null;
  camera2Stream: MediaStream | null;
  isBothCamerasActive: boolean;
  preloadedCalibration?: StereoCalibration | null;
}

const LANDMARK_LABELS: Record<keyof PoseLandmarks, string> = {
  nose: 'Nose',
  leftEye: 'L Eye', rightEye: 'R Eye',
  leftEar: 'L Ear', rightEar: 'R Ear',
  leftShoulder: 'L Shoulder', rightShoulder: 'R Shoulder',
  leftElbow: 'L Elbow', rightElbow: 'R Elbow',
  leftWrist: 'L Wrist', rightWrist: 'R Wrist',
  leftHip: 'L Hip', rightHip: 'R Hip',
  leftKnee: 'L Knee', rightKnee: 'R Knee',
  leftAnkle: 'L Ankle', rightAnkle: 'R Ankle',
};

const LANDMARK_COLORS: Record<keyof PoseLandmarks, string> = {
  nose: '#a78bfa', leftEye: '#a78bfa', rightEye: '#a78bfa',
  leftEar: '#a78bfa', rightEar: '#a78bfa',
  leftShoulder: '#34d399', rightShoulder: '#34d399',
  leftElbow: '#60a5fa', rightElbow: '#60a5fa',
  leftWrist: '#f87171', rightWrist: '#f87171',
  leftHip: '#fbbf24', rightHip: '#fbbf24',
  leftKnee: '#fb923c', rightKnee: '#fb923c',
  leftAnkle: '#e879f9', rightAnkle: '#e879f9',
};

const GROUPS: { label: string; keys: Array<keyof PoseLandmarks> }[] = [
  { label: 'Head',      keys: ['nose', 'leftEye', 'rightEye', 'leftEar', 'rightEar'] },
  { label: 'Shoulders', keys: ['leftShoulder', 'rightShoulder'] },
  { label: 'Arms',      keys: ['leftElbow', 'rightElbow', 'leftWrist', 'rightWrist'] },
  { label: 'Hips',      keys: ['leftHip', 'rightHip'] },
  { label: 'Legs',      keys: ['leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'] },
];

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

  const displayVideo1Ref = useRef<HTMLVideoElement | null>(null);
  const displayVideo2Ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (displayVideo1Ref.current && camera1Stream)
      displayVideo1Ref.current.srcObject = camera1Stream;
  }, [camera1Stream]);

  useEffect(() => {
    if (displayVideo2Ref.current && camera2Stream)
      displayVideo2Ref.current.srcObject = camera2Stream;
  }, [camera2Stream]);

  const calibration = calibrationResult ?? preloadedCalibration ?? null;
  const videoEl1 = camera1Ref.current;
  const videoEl2 = camera2Ref.current;

  const { camera1Landmarks, camera2Landmarks, isLoaded: poseLoaded, error: poseError } =
    useDualMediaPipePose(videoEl1, videoEl2, isBothCamerasActive);

  const cam1W = videoEl1?.videoWidth ?? 1280;
  const cam1H = videoEl1?.videoHeight ?? 720;
  const cam2W = videoEl2?.videoWidth ?? 1280;
  const cam2H = videoEl2?.videoHeight ?? 720;

  const pose3D = useTriangulation(
    calibration, camera1Landmarks, camera2Landmarks,
    cam1W, cam1H, cam2W, cam2H,
  );

  const handleLoadCalibration = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try { loadCalibration(ev.target?.result as string); }
      catch (err) { setLoadError((err as Error).message); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const trackedCount = LANDMARK_KEYS.filter(k => pose3D[k] !== null).length;

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
        <Badge className={trackedCount > 0 ? 'bg-blue-600 animate-pulse' : 'bg-gray-700'}>
          {trackedCount > 0 ? `Tracking ${trackedCount}/${LANDMARK_KEYS.length} joints` : 'No Detection'}
        </Badge>
        {calibration?.stereoReprojectionError != null && (
          <span className="text-xs text-gray-500 ml-auto">
            Stereo error: {calibration.stereoReprojectionError.toFixed(3)} px
          </span>
        )}
      </div>

      {poseError && (
        <Card className="bg-red-900/20 border-red-700 p-3 text-sm text-red-300">{poseError}</Card>
      )}

      {/* Calibration loader */}
      {!calibration && (
        <Card className="bg-gray-900 border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-3">Load Stereo Calibration</h3>
          <p className="text-sm text-gray-400 mb-4">
            Load the <code className="text-green-400 bg-gray-800 px-1 rounded">stereo_calibration.json</code> produced
            by the Python calibration script.
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

      {/* 3D joint table */}
      <Card className="bg-gray-900 border-gray-700 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-400" />
            3D Joint Positions (mm)
          </h3>
          {calibration?.stereoReprojectionError != null && (
            <span className="text-xs text-gray-500">
              Stereo error: {calibration.stereoReprojectionError.toFixed(3)} px
            </span>
          )}
        </div>

        <div className="grid grid-cols-[140px_1fr_1fr_1fr] gap-x-2 mb-2 px-2">
          <div className="text-xs text-gray-500 uppercase tracking-wider">Joint</div>
          <div className="text-xs text-red-400 uppercase tracking-wider text-right">X</div>
          <div className="text-xs text-green-400 uppercase tracking-wider text-right">Y</div>
          <div className="text-xs text-blue-400 uppercase tracking-wider text-right">Z</div>
        </div>

        <div className="space-y-4">
          {GROUPS.map(group => (
            <div key={group.label}>
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-1 px-2 border-b border-gray-800 pb-1">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.keys.map(key => {
                  const pt = pose3D[key];
                  const color = LANDMARK_COLORS[key];
                  return (
                    <div
                      key={key}
                      className="grid grid-cols-[140px_1fr_1fr_1fr] gap-x-2 items-center px-2 py-1 rounded"
                      style={{ backgroundColor: pt ? 'rgba(255,255,255,0.03)' : 'transparent' }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: pt ? color : '#374151' }} />
                        <span className="text-xs text-gray-300">{LANDMARK_LABELS[key]}</span>
                      </div>
                      <div className="text-right font-mono text-sm text-white">
                        {pt ? pt.x.toFixed(1) : <span className="text-gray-600">—</span>}
                      </div>
                      <div className="text-right font-mono text-sm text-white">
                        {pt ? pt.y.toFixed(1) : <span className="text-gray-600">—</span>}
                      </div>
                      <div className="text-right font-mono text-sm text-white">
                        {pt ? pt.z.toFixed(1) : <span className="text-gray-600">—</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {!isBothCamerasActive && (
          <p className="text-sm text-yellow-400 mt-4">⚠️ Start both cameras in Camera Setup first.</p>
        )}
        {isBothCamerasActive && !calibration && (
          <p className="text-sm text-yellow-400 mt-4">⚠️ Load a calibration file above to enable triangulation.</p>
        )}
        {isBothCamerasActive && calibration && trackedCount === 0 && poseLoaded && (
          <p className="text-sm text-gray-500 mt-4">Move into view of both cameras...</p>
        )}
      </Card>

      {/* Camera feeds with skeleton overlay */}
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
            {([
              { label: 'Camera 1', stream: camera1Stream, lm: camera1Landmarks, videoRef: displayVideo1Ref, w: cam1W, h: cam1H },
              { label: 'Camera 2', stream: camera2Stream, lm: camera2Landmarks, videoRef: displayVideo2Ref, w: cam2W, h: cam2H },
            ] as const).map(({ label, stream, lm, videoRef, w, h }, i) => (
              <div key={i}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-400">{label}</p>
                  {lm && (
                    <span className="text-xs text-green-400">
                      {LANDMARK_KEYS.filter(k => lm[k] && (lm[k]!.visibility ?? 1) > 0.5).length} joints visible
                    </span>
                  )}
                </div>
                <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />

                  {lm && w > 0 && h > 0 && (
                    <svg
                      className="absolute inset-0 w-full h-full"
                      viewBox={`0 0 ${w} ${h}`}
                      preserveAspectRatio="xMidYMid meet"
                      style={{ pointerEvents: 'none' }}
                    >
                      {SKELETON_CONNECTIONS.map(([a, b]) => {
                        const pa = lm[a];
                        const pb = lm[b];
                        if (!pa || !pb || (pa.visibility ?? 1) < 0.5 || (pb.visibility ?? 1) < 0.5) return null;
                        return (
                          <line key={`${a}-${b}`}
                            x1={pa.x * w} y1={pa.y * h}
                            x2={pb.x * w} y2={pb.y * h}
                            stroke="rgba(255,255,255,0.35)" strokeWidth="2"
                          />
                        );
                      })}
                      {LANDMARK_KEYS.map(key => {
                        const pt = lm[key];
                        if (!pt || (pt.visibility ?? 1) < 0.5) return null;
                        const tracked = pose3D[key] !== null;
                        return (
                          <circle key={key}
                            cx={pt.x * w} cy={pt.y * h}
                            r={tracked ? 5 : 3}
                            fill={LANDMARK_COLORS[key]}
                            stroke={tracked ? 'white' : 'transparent'}
                            strokeWidth="1.5"
                            opacity={tracked ? 1 : 0.5}
                          />
                        );
                      })}
                    </svg>
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
