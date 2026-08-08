/**
 * FailureCorrectionPlayback
 *
 * Mirrors StereoVideoPlayback but inserts usePoseFailureCorrection between
 * triangulation and recording/display. StereoVideoPlayback is not modified.
 */
import { useRef, useState, useEffect, useCallback } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useDualMediaPipePose } from '../hooks/useDualMediaPipePose';
import { triangulateAllLandmarks, LANDMARK_KEYS, SKELETON_CONNECTIONS, type TriangulatedPose } from '../hooks/useTriangulation';
import {
  usePoseFailureCorrection,
  type JointFailureStatus,
  type FailureCorrectionConfig,
  DEFAULT_CONFIG,
} from '../hooks/usePoseFailureCorrection';
import { useStereoMotionRecorder } from '../hooks/useStereoMotionRecorder';
import { MotionDataVisualizer } from './MotionDataVisualizer';
import { type MotionRecording } from '../hooks/useMotionRecorder';
import { StereoCalibration } from '../type/calibration';
import { PoseLandmarks } from '../hooks/useMediaPipePose';
import {
  Play, Pause, RotateCcw, Circle, Square, Download, Trash2,
  BarChart3, Film, Upload, Settings,
} from 'lucide-react';

interface FailureCorrectionPlaybackProps {
  calibration: StereoCalibration | null;
}

const LANDMARK_COLORS: Record<keyof PoseLandmarks, string> = {
  nose: '#a78bfa',
  leftShoulder: '#34d399', rightShoulder: '#34d399',
  leftElbow: '#60a5fa', rightElbow: '#60a5fa',
  leftWrist: '#f87171', rightWrist: '#f87171',
  leftHip: '#fbbf24', rightHip: '#fbbf24',
  leftKnee: '#fb923c', rightKnee: '#fb923c',
  leftAnkle: '#e879f9', rightAnkle: '#e879f9',
};

// ── Skeleton SVG ─────────────────────────────────────────────────────────────
interface Bounds { minX: number; minY: number; rangeX: number; rangeY: number; }

function projectPose(pose3D: TriangulatedPose, view: 'front' | 'side' | 'top') {
  return LANDMARK_KEYS
    .map(k => {
      const pt = pose3D[k];
      if (!pt) return null;
      const px = view === 'side' ? pt.z : pt.x;
      const py = view === 'top'  ? pt.z : -pt.y;
      return { key: k as keyof PoseLandmarks, px, py };
    })
    .filter(Boolean) as { key: keyof PoseLandmarks; px: number; py: number }[];
}

function computeBounds(points: { px: number; py: number }[]): Bounds | null {
  if (points.length === 0) return null;
  const xs = points.map(p => p.px), ys = points.map(p => p.py);
  return {
    minX: Math.min(...xs), minY: Math.min(...ys),
    rangeX: Math.max(...xs) - Math.min(...xs) || 1,
    rangeY: Math.max(...ys) - Math.min(...ys) || 1,
  };
}

function SkeletonView({
  pose3D, view, width, height, label, labelColor = '#6b7280', sharedBounds,
}: {
  pose3D: TriangulatedPose; view: 'front' | 'side' | 'top';
  width: number; height: number; label?: string; labelColor?: string;
  sharedBounds?: Bounds | null;
}) {
  const PAD = 24;
  const projected = projectPose(pose3D, view);

  if (projected.length === 0) {
    return (
      <svg width={width} height={height}>
        {label && <text x={8} y={18} fill={labelColor} fontSize="11" fontWeight="600">{label}</text>}
        <text x={width/2} y={height/2} textAnchor="middle" fill="#4b5563" fontSize="13">No joints detected</text>
      </svg>
    );
  }

  const bounds = sharedBounds ?? computeBounds(projected)!;
  const { minX, minY, rangeX, rangeY } = bounds;
  const scale = Math.min((width - PAD*2) / rangeX, (height - PAD*2) / rangeY);
  const toSVG = (px: number, py: number) => ({
    x: PAD + (px - minX) * scale + ((width  - PAD*2) - rangeX*scale) / 2,
    y: PAD + (py - minY) * scale + ((height - PAD*2) - rangeY*scale) / 2,
  });

  const ptMap = Object.fromEntries(projected.map(p => [p.key, p]));

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      {label && <text x={8} y={18} fill={labelColor} fontSize="11" fontWeight="600">{label}</text>}
      {SKELETON_CONNECTIONS.map(([a, b]) => {
        const pa = ptMap[a], pb = ptMap[b];
        if (!pa || !pb) return null;
        const A = toSVG(pa.px, pa.py), B = toSVG(pb.px, pb.py);
        return <line key={`${a}-${b}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y}
          stroke="rgba(255,255,255,0.5)" strokeWidth="4" strokeLinecap="round" />;
      })}
      {projected.map(({ key, px, py }) => {
        const { x, y } = toSVG(px, py);
        return <circle key={key} cx={x} cy={y} r={5}
          fill={LANDMARK_COLORS[key]} stroke="rgba(0,0,0,0.6)" strokeWidth="1.5" />;
      })}
    </svg>
  );
}

// ── Joint status panel ────────────────────────────────────────────────────────
const FAILURE_LABEL: Record<string, string> = {
  none: 'NORMAL', light_jitter: 'LIGHT JITTER', heavy_jitter: 'HEAVY JITTER',
};
const FAILURE_COLOR: Record<string, string> = {
  none: 'text-green-400', light_jitter: 'text-yellow-400', heavy_jitter: 'text-orange-400',
};
const BODY_GROUPS: { label: string; joints: Array<keyof PoseLandmarks> }[] = [
  { label: 'Head',       joints: ['nose'] },
  { label: 'Arms',       joints: ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist'] },
  { label: 'Torso/Legs', joints: ['leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'] },
];

function JointStatusPanel({ statuses }: { statuses: JointFailureStatus[] }) {
  const byJoint = Object.fromEntries(statuses.map(s => [s.joint, s]));
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {BODY_GROUPS.map(group => (
        <div key={group.label} className="bg-gray-900 rounded-lg border border-gray-800 p-3">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{group.label}</div>
          <div className="space-y-1">
            {group.joints.map(joint => {
              const s = byJoint[joint];
              if (!s) return null;
              return (
                <div key={joint} className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 capitalize">
                    {joint.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                  <span className={`text-xs font-mono font-semibold ${s.reliable ? (FAILURE_COLOR[s.failureType] ?? 'text-gray-500') : 'text-gray-600'}`}>
                    {s.reliable ? (FAILURE_LABEL[s.failureType] ?? s.failureType) : 'NO DATA'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Config panel ──────────────────────────────────────────────────────────────
function ConfigPanel({ config, onChange }: {
  config: FailureCorrectionConfig;
  onChange: (k: keyof FailureCorrectionConfig, v: number) => void;
}) {
  const field = (label: string, key: keyof FailureCorrectionConfig, min: number, max: number, step: number, unit: string) => (
    <div className="flex items-center justify-between gap-4">
      <label className="text-xs text-gray-400 flex-1">{label}</label>
      <div className="flex items-center gap-2">
        <input type="range" min={min} max={max} step={step} value={config[key]}
          onChange={e => onChange(key, parseFloat(e.target.value))}
          className="w-28 accent-purple-500" />
        <span className="text-xs text-gray-300 tabular-nums w-20 text-right">{config[key]}{unit}</span>
      </div>
    </div>
  );
  return (
    <div className="space-y-3 pt-2">
      {field('Light jitter threshold', 'lightJitterThresholdMm', 20, 200, 5, ' mm')}
      {field('Heavy jitter threshold', 'heavyJitterThresholdMm', 50, 400, 10, ' mm')}
      {field('Normal smoothing α', 'normalSmoothingAlpha', 0.7, 1.0, 0.05, '')}
      {field('Light smoothing α', 'lightSmoothingAlpha', 0.1, 0.9, 0.05, '')}
      {field('Heavy smoothing α', 'heavySmoothingAlpha', 0.05, 0.6, 0.05, '')}
      {field('Spike factor', 'spikeFactor', 1.5, 8.0, 0.25, '×')}
      {field('History window', 'historyWindowLength', 2, 15, 1, ' frames')}
      {field('Recovery after (frames)', 'maxJitterFrames', 2, 30, 1, ' f')}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m.toString().padStart(2,'0')}:${(s % 60).toFixed(1).padStart(4,'0')}`;
}
function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m.toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}.${cs.toString().padStart(2,'0')}`;
}

// ── Main component ────────────────────────────────────────────────────────────
export function FailureCorrectionPlayback({ calibration: calibrationProp }: FailureCorrectionPlaybackProps) {
  const [localCalibration, setLocalCalibration] = useState<StereoCalibration | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const calibration = localCalibration ?? calibrationProp;

  const handleCalibrationFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        if (!parsed.camera1 || !parsed.camera2 || !parsed.P1 || !parsed.P2) {
          setCalibrationError('Invalid calibration file — missing required fields.');
          return;
        }
        setLocalCalibration(parsed as StereoCalibration);
        setCalibrationError(null);
      } catch {
        setCalibrationError('Could not parse calibration file.');
      }
    };
    reader.readAsText(file);
  }, []);

  const video1Ref = useRef<HTMLVideoElement | null>(null);
  const video2Ref = useRef<HTMLVideoElement | null>(null);
  const [video1El, setVideo1El] = useState<HTMLVideoElement | null>(null);
  const [video2El, setVideo2El] = useState<HTMLVideoElement | null>(null);
  const [url1, setUrl1] = useState<string | null>(null);
  const [url2, setUrl2] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [analyzerRecording, setAnalyzerRecording] = useState<MotionRecording | null>(null);
  const [vid1Ready, setVid1Ready] = useState(false);
  const [vid2Ready, setVid2Ready] = useState(false);
  const bothLoaded = vid1Ready && vid2Ready;

  const [showConfig, setShowConfig] = useState(false);
  const [configOverrides, setConfigOverrides] = useState<Partial<FailureCorrectionConfig>>({});
  const config: FailureCorrectionConfig = { ...DEFAULT_CONFIG, ...configOverrides };
  const handleConfigChange = useCallback((k: keyof FailureCorrectionConfig, v: number) => {
    setConfigOverrides(prev => ({ ...prev, [k]: v }));
  }, []);

  const [jointStatuses, setJointStatuses] = useState<JointFailureStatus[]>([]);
  const lastStatusUpdateRef = useRef(0);

  // Drift correction
  const DRIFT_THRESHOLD = 0.05;
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      const v1 = video1Ref.current, v2 = video2Ref.current;
      if (!v1 || !v2) return;
      const drift = Math.abs(v1.currentTime - v2.currentTime);
      if (drift > DRIFT_THRESHOLD) {
        if (v1.currentTime > v2.currentTime) v1.currentTime = v2.currentTime;
        else v2.currentTime = v1.currentTime;
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isPlaying]);

  useEffect(() => {
    const v = video1Ref.current;
    if (!v) return;
    const onTimeUpdate = () => setCurrentTime(v.currentTime);
    const onEnded = () => setIsPlaying(false);
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('ended', onEnded);
    return () => { v.removeEventListener('timeupdate', onTimeUpdate); v.removeEventListener('ended', onEnded); };
  }, [url1]);

  const loadFile = useCallback((file: File, camIndex: 1 | 2) => {
    const url = URL.createObjectURL(file);
    if (camIndex === 1) { if (url1) URL.revokeObjectURL(url1); setUrl1(url); setVid1Ready(false); setVideo1El(null); }
    else                { if (url2) URL.revokeObjectURL(url2); setUrl2(url); setVid2Ready(false); setVideo2El(null); }
    setIsPlaying(false);
    setCurrentTime(0);
  }, [url1, url2]);

  const handlePlay = useCallback(() => {
    const v1 = video1Ref.current, v2 = video2Ref.current;
    if (!v1 || !v2 || !bothLoaded) return;
    v1.play(); v2.play();
    setIsPlaying(true);
  }, [bothLoaded]);

  const handlePause = useCallback(() => {
    video1Ref.current?.pause();
    video2Ref.current?.pause();
    setIsPlaying(false);
  }, []);

  const handleRestart = useCallback(() => {
    const v1 = video1Ref.current, v2 = video2Ref.current;
    if (!v1 || !v2) return;
    v1.currentTime = 0; v2.currentTime = 0;
    setCurrentTime(0); setIsPlaying(false);
  }, []);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (video1Ref.current) video1Ref.current.currentTime = t;
    if (video2Ref.current) video2Ref.current.currentTime = t;
    setCurrentTime(t);
  }, []);

  const cam1W = video1El?.videoWidth  ?? 1280;
  const cam1H = video1El?.videoHeight ?? 720;
  const cam2W = video2El?.videoWidth  ?? 1280;
  const cam2H = video2El?.videoHeight ?? 720;

  const [rawPose, setRawPose] = useState<TriangulatedPose>(
    () => Object.fromEntries(LANDMARK_KEYS.map(k => [k, null])) as TriangulatedPose
  );
  const [correctedPose, setCorrectedPose] = useState<TriangulatedPose>(
    () => Object.fromEntries(LANDMARK_KEYS.map(k => [k, null])) as TriangulatedPose
  );

  // Failure correction
  const { correct, reset } = usePoseFailureCorrection(config);
  const correctRef = useRef(correct);
  useEffect(() => { correctRef.current = correct; }, [correct]);

  const calibrationRef = useRef(calibration);
  const isRecordingRef = useRef(false);
  const recordStereoFrameRef = useRef<(pose3Dmm: TriangulatedPose, cam1Landmarks: PoseLandmarks | null) => void>(() => {});
  useEffect(() => { calibrationRef.current = calibration; }, [calibration]);

  const onStereoFrameRef = useRef<
    ((lm1: PoseLandmarks | null, lm2: PoseLandmarks | null) => void) | null
  >(null);

  const {
    isRecording, currentRecording, recordings,
    startRecording, stopRecording, recordStereoFrame,
    deleteRecording, clearAllRecordings, exportRecording,
  } = useStereoMotionRecorder();
  useEffect(() => { recordStereoFrameRef.current = recordStereoFrame; }, [recordStereoFrame]);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);

  onStereoFrameRef.current = (lm1: PoseLandmarks | null, lm2: PoseLandmarks | null) => {
    if (!lm1 || !lm2 || !calibrationRef.current) return;

    const raw = triangulateAllLandmarks(
      calibrationRef.current,
      lm1,
      lm2,
      cam1W,
      cam1H,
      cam2W,
      cam2H,
    );

    const { correctedPose: corrected, jointStatuses: statuses } = correctRef.current(raw);

    if (isRecordingRef.current && recordStereoFrameRef.current) {
      recordStereoFrameRef.current(corrected, lm1);
    }

    setRawPose(raw);
    setCorrectedPose(corrected);

    const now = performance.now();
    if (now - lastStatusUpdateRef.current > 250) {
      lastStatusUpdateRef.current = now;
      setJointStatuses(statuses);
    }
  };

  const { camera1Landmarks, camera2Landmarks, isLoaded: poseLoaded } =
    useDualMediaPipePose(video1El, video2El, bothLoaded && isPlaying, onStereoFrameRef);

  // Reset correction history when playback restarts
  const handleRestartWithReset = useCallback(() => {
    reset();
    handleRestart();
  }, [reset, handleRestart]);

  const trackedRaw       = LANDMARK_KEYS.filter(k => rawPose[k]       !== null).length;
  const trackedCorrected = LANDMARK_KEYS.filter(k => correctedPose[k] !== null).length;
  const jitterCount      = jointStatuses.filter(s => s.failureType !== 'none' && s.reliable).length;

  return (
    <div className="space-y-6">

      {/* ── Status ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <Badge className={poseLoaded ? 'bg-green-700' : 'bg-yellow-700'}>
          {poseLoaded ? 'MediaPipe Ready' : 'Loading MediaPipe...'}
        </Badge>
        <Badge className={calibration ? 'bg-green-700' : 'bg-red-700'}>
          {calibration ? 'Calibration Loaded' : 'No Calibration'}
        </Badge>
        <Badge className={bothLoaded ? 'bg-green-700' : 'bg-gray-700'}>
          {bothLoaded ? 'Videos Loaded' : 'Load Both Videos'}
        </Badge>
        <Badge className={trackedCorrected > 0 ? 'bg-blue-600 animate-pulse' : 'bg-gray-700'}>
          {trackedCorrected > 0 ? `Tracking ${trackedCorrected}/${LANDMARK_KEYS.length} joints` : 'No Detection'}
        </Badge>
        {jitterCount > 0 && (
          <Badge className="bg-yellow-700">{jitterCount} joint{jitterCount !== 1 ? 's' : ''} corrected</Badge>
        )}
        {isRecording && (
          <Badge className="bg-red-600 animate-pulse flex items-center gap-1">
            <Circle className="h-2 w-2 fill-white" />
            REC {formatDuration(currentRecording?.duration ?? 0)}
          </Badge>
        )}

        <label className={`flex items-center gap-1.5 px-3 py-1 rounded border cursor-pointer text-xs transition-colors ml-auto
          ${calibration ? 'border-green-700 bg-green-900/20 text-green-300 hover:bg-green-900/40' : 'border-yellow-600 bg-yellow-900/20 text-yellow-300 hover:bg-yellow-900/40'}`}>
          <Upload className="h-3 w-3" />
          {calibration ? 'Replace calibration' : 'Load calibration file'}
          <input type="file" accept=".json" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleCalibrationFile(f); e.target.value = ''; }} />
        </label>
      </div>

      {calibrationError && (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">
          {calibrationError}
        </div>
      )}

      {/* ── File loaders ───────────────────────────────────────────── */}
      <Card className="bg-gray-900 border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Film className="h-4 w-4" /> Load Stereo Video Files
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Load the two camera videos recorded simultaneously. Correction history is reset on Restart.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {([1, 2] as const).map(cam => {
            const loaded = cam === 1 ? vid1Ready : vid2Ready;
            return (
              <div key={cam}>
                <label className="block text-xs text-gray-400 mb-1">Camera {cam}</label>
                <label className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer text-sm transition-colors
                  ${loaded ? 'border-green-600 bg-green-900/20 text-green-300' : 'border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                  <Film className="h-4 w-4 shrink-0" />
                  {loaded ? `Camera ${cam} loaded` : `Choose camera ${cam} video`}
                  <input type="file" accept="video/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f, cam); e.target.value = ''; }} />
                </label>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── Video players ──────────────────────────────────────────── */}
      {(url1 || url2) && (
        <Card className="bg-gray-900 border-gray-700 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {([
              { url: url1, ref: video1Ref, setEl: setVideo1El, label: 'Camera 1', lm: camera1Landmarks, w: cam1W, h: cam1H, setReady: setVid1Ready },
              { url: url2, ref: video2Ref, setEl: setVideo2El, label: 'Camera 2', lm: camera2Landmarks, w: cam2W, h: cam2H, setReady: setVid2Ready },
            ] as const).map(({ url, ref, setEl, label, lm, w, h, setReady }) => (
              <div key={label}>
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                  {url ? (
                    <video
                      ref={el => { ref.current = el; setEl(el); }}
                      src={url}
                      className="w-full h-full object-contain"
                      onLoadedMetadata={e => {
                        const v = e.currentTarget;
                        setReady(true);
                        if (ref === video1Ref) setDuration(v.duration);
                      }}
                      playsInline muted
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">
                      {label} not loaded
                    </div>
                  )}
                  {isRecording && (
                    <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-600/90 px-2 py-0.5 rounded-full">
                      <Circle className="h-2 w-2 fill-white animate-pulse" />
                      <span className="text-xs font-bold text-white">REC</span>
                    </div>
                  )}
                  {lm && w > 0 && h > 0 && (
                    <svg className="absolute inset-0 w-full h-full"
                      viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet"
                      style={{ pointerEvents: 'none' }}>
                      {SKELETON_CONNECTIONS.map(([a, b]) => {
                        const pa = lm[a], pb = lm[b];
                        if (!pa || !pb || (pa.visibility??1) < 0.5 || (pb.visibility??1) < 0.5) return null;
                        return <line key={`${a}-${b}`} x1={pa.x*w} y1={pa.y*h} x2={pb.x*w} y2={pb.y*h}
                          stroke="rgba(255,255,255,0.55)" strokeWidth="3" strokeLinecap="round" />;
                      })}
                      {LANDMARK_KEYS.map(key => {
                        const pt = lm[key];
                        if (!pt || (pt.visibility??1) < 0.5) return null;
                        const tracked = rawPose[key] !== null;
                        return <circle key={key} cx={pt.x*w} cy={pt.y*h}
                          r={tracked ? 5 : 3} fill={LANDMARK_COLORS[key]}
                          stroke={tracked ? 'white' : 'transparent'} strokeWidth="1.5"
                          opacity={tracked ? 1 : 0.5} />;
                      })}
                    </svg>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Playback controls */}
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" onClick={handleRestartWithReset}
              className="border-gray-600 text-gray-300 hover:bg-gray-700 h-8 w-8 p-0"
              title="Restart & reset correction history">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={isPlaying ? handlePause : handlePlay}
              disabled={!bothLoaded}
              className={`h-8 px-4 ${isPlaying ? 'bg-gray-600 hover:bg-gray-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <input type="range" min={0} max={duration || 1} step={0.05}
              value={currentTime} onChange={handleScrub}
              className="flex-1 accent-blue-500" />
            <span className="text-xs text-gray-400 tabular-nums w-24 text-right">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </Card>
      )}

      {/* ── 3D Reconstruction ──────────────────────────────────────── */}
      <Card className="bg-gray-900 border-gray-700 p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-semibold text-white">3D Skeleton Reconstruction</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              RAW tracked: {trackedRaw} · Corrected tracked: {trackedCorrected}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isRecording ? (
              <Button
                onClick={() => { startRecording({ notes: '3D corrected playback recording' }); }}
                disabled={!bothLoaded || !calibration || !poseLoaded || !isPlaying}
                className="bg-red-600 hover:bg-red-700 h-8 text-sm"
              >
                <Circle className="h-3 w-3 mr-1.5" /> Record
              </Button>
            ) : (
              <Button onClick={() => stopRecording()} className="bg-gray-600 hover:bg-gray-700 h-8 text-sm">
                <Square className="h-3 w-3 mr-1.5" />
                Stop · {formatDuration(currentRecording?.duration ?? 0)}
              </Button>
            )}
          </div>
        </div>

        {/* Side-by-side RAW vs CORRECTED — both use same coordinate space */}
        {(() => {
          const rawProjected = projectPose(rawPose, 'front');
          const sharedBounds = computeBounds(rawProjected);
          return (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-gray-950 rounded-lg border border-gray-800 flex items-center justify-center"
                style={{ height: 280 }}>
                <SkeletonView pose3D={rawPose} view="front" width={380} height={260}
                  label="RAW" labelColor="#6b7280" sharedBounds={sharedBounds} />
              </div>
              <div className="bg-gray-950 rounded-lg border border-purple-900/40 flex items-center justify-center"
                style={{ height: 280 }}>
                <SkeletonView pose3D={correctedPose} view="front" width={380} height={260}
                  label="CORRECTED" labelColor="#a78bfa" sharedBounds={sharedBounds} />
              </div>
            </div>
          );
        })()}

        {!bothLoaded && (
          <p className="text-sm text-yellow-400">⚠️ Load both camera videos above to enable reconstruction.</p>
        )}
        {bothLoaded && !calibration && (
          <p className="text-sm text-yellow-400">⚠️ No calibration loaded — 3D reconstruction unavailable.</p>
        )}
        {bothLoaded && calibration && !isPlaying && (
          <p className="text-sm text-gray-500">Press Play to start reconstruction.</p>
        )}
      </Card>

      {/* ── Joint status panel ─────────────────────────────────────── */}
      <Card className="bg-gray-900 border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Joint Failure Status</h3>
        {jointStatuses.length > 0 ? (
          <JointStatusPanel statuses={jointStatuses} />
        ) : (
          <p className="text-xs text-gray-600">No pose detected yet — press Play.</p>
        )}
      </Card>

      {/* ── Correction config ────────────────────────────────────────── */}
      <Card className="bg-gray-900 border-gray-700 p-4">
        <button className="flex items-center gap-2 w-full text-left"
          onClick={() => setShowConfig(v => !v)}>
          <Settings className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-semibold text-white">Correction Parameters</span>
          <span className="text-xs text-gray-500 ml-auto">{showConfig ? '▲ hide' : '▼ show'}</span>
        </button>
        {showConfig && <ConfigPanel config={config} onChange={handleConfigChange} />}
      </Card>

      {/* ── Recordings list ────────────────────────────────────────── */}
      {recordings.length > 0 && (
        <Card className="bg-gray-900 border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Corrected Recordings (from playback)</h3>
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
                    <Badge variant="secondary" className="bg-purple-900/40 text-purple-300 text-xs">3D · corrected · mm · playback</Badge>
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
