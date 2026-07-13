import { useRef, useState, useEffect, useCallback, type RefObject } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { useDualMediaPipePose } from '../hooks/useDualMediaPipePose';
import { useTriangulation, LANDMARK_KEYS, SKELETON_CONNECTIONS, type TriangulatedPose } from '../hooks/useTriangulation';
import { useCameraCalibration } from '../hooks/useCameraCalibration';
import { useStereoMotionRecorder } from '../hooks/useStereoMotionRecorder';
import { MotionDataVisualizer } from './MotionDataVisualizer';
import { type MotionRecording } from '../hooks/useMotionRecorder';
import { StereoCalibration } from '../type/calibration';
import { PoseLandmarks } from '../hooks/useMediaPipePose';
import { Upload, Eye, EyeOff, Circle, Square, Download, Trash2, BarChart3 } from 'lucide-react';

interface TriangulationViewProps {
  camera1Ref: RefObject<HTMLVideoElement | null>;
  camera2Ref: RefObject<HTMLVideoElement | null>;
  camera1Stream: MediaStream | null;
  camera2Stream: MediaStream | null;
  isBothCamerasActive: boolean;
  preloadedCalibration?: StereoCalibration | null;
}

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

// ── 3D Skeleton SVG ───────────────────────────────────────────────────────────
// Projects the triangulated 3D points into a 2D view (front: X/Y, side: Z/Y).
// Normalises to fit within the SVG canvas with a small margin.

interface SkeletonViewProps {
  pose3D: TriangulatedPose;
  view: 'front' | 'side' | 'top';
  width: number;
  height: number;
}

function SkeletonView({ pose3D, view, width, height }: SkeletonViewProps) {
  const PAD = 24;

  // Collect all tracked points and project to 2D based on view
  const project = (key: keyof PoseLandmarks) => {
    const pt = pose3D[key];
    if (!pt) return null;
    if (view === 'front') return { px: pt.x, py: pt.y };   // X right, Y down
    if (view === 'side')  return { px: pt.z, py: pt.y };   // Z right (depth), Y down
    return { px: pt.x, py: pt.z };                          // top: X right, Z down
  };

  const projected = LANDMARK_KEYS.map(k => ({ key: k, pt: project(k) })).filter(d => d.pt !== null) as
    { key: keyof PoseLandmarks; pt: { px: number; py: number } }[];

  if (projected.length === 0) {
    return (
      <svg width={width} height={height}>
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="#4b5563" fontSize="13">
          No joints detected
        </text>
      </svg>
    );
  }

  // Bounding box
  const xs = projected.map(d => d.pt.px);
  const ys = projected.map(d => d.pt.py);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const scaleX = (width  - PAD * 2) / rangeX;
  const scaleY = (height - PAD * 2) / rangeY;
  const scale  = Math.min(scaleX, scaleY);

  const toSVG = (px: number, py: number) => ({
    x: PAD + (px - minX) * scale + ((width  - PAD * 2) - rangeX * scale) / 2,
    y: PAD + (py - minY) * scale + ((height - PAD * 2) - rangeY * scale) / 2,
  });

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      {/* Connections */}
      {SKELETON_CONNECTIONS.map(([a, b]) => {
        const pa = project(a);
        const pb = project(b);
        if (!pa || !pb) return null;
        const svgA = toSVG(pa.px, pa.py);
        const svgB = toSVG(pb.px, pb.py);
        return (
          <line key={`${a}-${b}`}
            x1={svgA.x} y1={svgA.y} x2={svgB.x} y2={svgB.y}
            stroke="rgba(255,255,255,0.5)" strokeWidth="4" strokeLinecap="round"
          />
        );
      })}

      {/* Joints */}
      {projected.map(({ key, pt }) => {
        const { x, y } = toSVG(pt.px, pt.py);
        return (
          <circle key={key}
            cx={x} cy={y} r={5}
            fill={LANDMARK_COLORS[key]}
            stroke="rgba(0,0,0,0.6)" strokeWidth="1.5"
          />
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m.toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
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
  const [recordingName, setRecordingName] = useState('');
  const [analyzerRecording, setAnalyzerRecording] = useState<MotionRecording | null>(null);

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

  const { pose: pose3D, backProjected2D } = useTriangulation(
    calibration, camera1Landmarks, camera2Landmarks,
    cam1W, cam1H, cam2W, cam2H,
  );

  const {
    isRecording,
    currentRecording,
    recordings,
    startRecording,
    stopRecording,
    recordStereoFrame,
    deleteRecording,
    clearAllRecordings,
    exportRecording,
  } = useStereoMotionRecorder();

  useEffect(() => {
    if (isRecording && camera1Landmarks)
      recordStereoFrame(pose3D, camera1Landmarks);
  }, [pose3D, isRecording, camera1Landmarks, recordStereoFrame]);

  const handleStartRecording = useCallback(() => {
    startRecording({ notes: '3D stereo recording', deviceInfo: navigator.userAgent });
  }, [startRecording]);

  const handleStopRecording = useCallback(() => {
    stopRecording();
    setRecordingName('');
  }, [stopRecording]);

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

      {/* ── Status bar ───────────────────────────────────────────── */}
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
        {isRecording && (
          <Badge className="bg-red-600 animate-pulse flex items-center gap-1">
            <Circle className="h-2 w-2 fill-white" />
            REC {formatDuration(currentRecording?.duration ?? 0)}
          </Badge>
        )}
        {calibration?.stereoReprojectionError != null && (
          <span className="text-xs text-gray-500 ml-auto">
            Stereo error: {calibration.stereoReprojectionError.toFixed(3)} px
          </span>
        )}
      </div>

      {poseError && (
        <Card className="bg-red-900/20 border-red-700 p-3 text-sm text-red-300">{poseError}</Card>
      )}

      {/* ── Calibration loader ───────────────────────────────────── */}
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

      {/* ── Camera feeds ─────────────────────────────────────────── */}
      <Card className="bg-gray-900 border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-white text-sm">Camera Feeds</h3>
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
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-400">{label}</p>
                  {lm && (
                    <span className="text-xs text-green-400">
                      {LANDMARK_KEYS.filter(k => lm[k] && (lm[k]!.visibility ?? 1) > 0.5).length} visible
                    </span>
                  )}
                </div>
                <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />

                  {isRecording && (
                    <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-600/90 px-2 py-0.5 rounded-full">
                      <Circle className="h-2 w-2 fill-white animate-pulse" />
                      <span className="text-xs font-bold text-white">REC</span>
                    </div>
                  )}

                  {lm && w > 0 && h > 0 && (
                    <svg className="absolute inset-0 w-full h-full"
                      viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet"
                      style={{ pointerEvents: 'none' }}
                    >
                      {SKELETON_CONNECTIONS.map(([a, b]) => {
                        const pa = lm[a]; const pb = lm[b];
                        if (!pa || !pb || (pa.visibility ?? 1) < 0.5 || (pb.visibility ?? 1) < 0.5) return null;
                        return <line key={`${a}-${b}`} x1={pa.x*w} y1={pa.y*h} x2={pb.x*w} y2={pb.y*h}
                          stroke="rgba(255,255,255,0.55)" strokeWidth="3" strokeLinecap="round" />;
                      })}
                      {LANDMARK_KEYS.map(key => {
                        const pt = lm[key];
                        if (!pt || (pt.visibility ?? 1) < 0.5) return null;
                        const tracked = pose3D[key] !== null;
                        return <circle key={key} cx={pt.x*w} cy={pt.y*h}
                          r={tracked ? 5 : 3} fill={LANDMARK_COLORS[key]}
                          stroke={tracked ? 'white' : 'transparent'} strokeWidth="1.5"
                          opacity={tracked ? 1 : 0.5} />;
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

      {/* ── 3D Reconstruction + Recording ────────────────────────── */}
      <Card className="bg-gray-900 border-gray-700 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-white">3D Skeleton Reconstruction</h3>
          <div className="flex items-center gap-2">
            {!isRecording ? (
              <>
                <Input
                  placeholder="Recording name (optional)"
                  value={recordingName}
                  onChange={e => setRecordingName(e.target.value)}
                  className="bg-gray-800 border-gray-700 text-white w-48 h-8 text-sm"
                />
                <Button
                  onClick={handleStartRecording}
                  disabled={!isBothCamerasActive || !calibration || !poseLoaded}
                  className="bg-red-600 hover:bg-red-700 h-8 text-sm"
                >
                  <Circle className="h-3 w-3 mr-1.5" />
                  Record
                </Button>
              </>
            ) : (
              <Button onClick={handleStopRecording} className="bg-gray-600 hover:bg-gray-700 h-8 text-sm">
                <Square className="h-3 w-3 mr-1.5" />
                Stop · {formatDuration(currentRecording?.duration ?? 0)}
              </Button>
            )}
          </div>
        </div>

        {/* Front view — full width */}
        <div className="bg-gray-950 rounded-lg border border-gray-800 flex items-center justify-center mb-4"
          style={{ height: 360 }}>
          <SkeletonView pose3D={pose3D} view="front" width={800} height={350} />
        </div>

        {!isBothCamerasActive && (
          <p className="text-sm text-yellow-400">⚠️ Start both cameras in Camera Setup first.</p>
        )}
        {isBothCamerasActive && !calibration && (
          <p className="text-sm text-yellow-400">⚠️ Load a calibration file above to enable reconstruction.</p>
        )}
        {isBothCamerasActive && calibration && trackedCount === 0 && poseLoaded && (
          <p className="text-sm text-gray-500">Move into view of both cameras...</p>
        )}
      </Card>

      {/* ── Recordings list ──────────────────────────────────────── */}
      {recordings.length > 0 && (
        <Card className="bg-gray-900 border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">3D Recordings</h3>
            <Button variant="outline" size="sm" onClick={clearAllRecordings}
              className="border-gray-700 text-gray-400 hover:bg-red-900/20 h-7 text-xs">
              <Trash2 className="h-3 w-3 mr-1" /> Clear All
            </Button>
          </div>
          <div className="space-y-2">
            {recordings.map(rec => (
              <div key={rec.id} className="flex items-center gap-3 p-3 rounded bg-gray-800 border border-gray-700">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{rec.name}</div>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <Badge variant="secondary" className="bg-gray-700 text-gray-300 text-xs">{formatDuration(rec.duration)}</Badge>
                    <Badge variant="secondary" className="bg-gray-700 text-gray-300 text-xs">{rec.frames.length} frames</Badge>
                    <Badge variant="secondary" className="bg-gray-700 text-gray-300 text-xs">{rec.frameRate.toFixed(1)} FPS</Badge>
                    <Badge variant="secondary" className="bg-blue-900/40 text-blue-300 text-xs">3D · mm</Badge>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => setAnalyzerRecording(rec)}
                    className="border-gray-600 text-white hover:bg-gray-700 h-7 text-xs">
                    <BarChart3 className="h-3 w-3 mr-1" /> Analyze
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => exportRecording(rec)}
                    className="border-gray-600 text-white hover:bg-gray-700 h-7 w-7 p-0">
                    <Download className="h-3 w-3" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => deleteRecording(rec.id)}
                    className="border-gray-600 text-white hover:bg-red-900/30 h-7 w-7 p-0">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {analyzerRecording && (
        <MotionDataVisualizer recording={analyzerRecording} onClose={() => setAnalyzerRecording(null)} />
      )}
    </div>
  );
}
