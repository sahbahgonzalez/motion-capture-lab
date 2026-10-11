/**
 * IMUReconstructionView
 *
 * Identical to FailureCorrectionView (stereo + jitter correction), but adds an
 * optional `onCorrectedPose` callback so IMULabView can subscribe to the live
 * corrected pose without running a second MediaPipe instance.
 *
 * The original FailureCorrectionView is untouched.
 */
import { useRef, useState, useEffect, useCallback, type RefObject } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { useDualMediaPipePose } from '../hooks/useDualMediaPipePose';
import {
  triangulateAllLandmarks,
  LANDMARK_KEYS,
  SKELETON_CONNECTIONS,
  type TriangulatedPose,
} from '../hooks/useTriangulation';
import {
  usePoseFailureCorrection,
  type JointFailureStatus,
  type FailureCorrectionConfig,
  DEFAULT_CONFIG,
} from '../hooks/usePoseFailureCorrection';
import { useCameraCalibration } from '../hooks/useCameraCalibration';
import { useStereoMotionRecorder } from '../hooks/useStereoMotionRecorder';
import { MotionDataVisualizer } from './MotionDataVisualizer';
import { type MotionRecording } from '../hooks/useMotionRecorder';
import { StereoCalibration } from '../type/calibration';
import { PoseLandmarks } from '../hooks/useMediaPipePose';
import { Upload, Eye, EyeOff, Circle, Square, Download, Trash2, BarChart3, Settings } from 'lucide-react';

interface IMUReconstructionViewProps {
  camera1Ref: RefObject<HTMLVideoElement | null>;
  camera2Ref: RefObject<HTMLVideoElement | null>;
  camera1Stream: MediaStream | null;
  camera2Stream: MediaStream | null;
  isBothCamerasActive: boolean;
  preloadedCalibration?: StereoCalibration | null;
  /** Called every stereo frame with the corrected pose, tracked count, and per-joint failure statuses. */
  onCorrectedPose?: (pose: TriangulatedPose, trackedCorrected: number, statuses: JointFailureStatus[]) => void;
  /**
   * Phase B: provide actual IMU-reconstructed pose here to replace the placeholder.
   * null (default) = Phase A placeholder (mirrors stereo right arm).
   */
  imuReconstructionPose?: TriangulatedPose | null;
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

interface Bounds { minX: number; minY: number; rangeX: number; rangeY: number; }

function projectPose(pose3D: TriangulatedPose, view: 'front' | 'side' | 'top') {
  return LANDMARK_KEYS
    .map(k => {
      const pt = pose3D[k];
      if (!pt) return null;
      const px = view === 'side' ? pt.z : pt.x;
      const py = view === 'top'  ? pt.z : -pt.y;
      return { key: k, px, py };
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
  const scale = Math.min((width - PAD * 2) / rangeX, (height - PAD * 2) / rangeY);
  const toSVG = (px: number, py: number) => ({
    x: PAD + (px - minX) * scale + ((width  - PAD * 2) - rangeX * scale) / 2,
    y: PAD + (py - minY) * scale + ((height - PAD * 2) - rangeY * scale) / 2,
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

const FAILURE_LABEL: Record<string, string> = {
  none: 'NORMAL', light_jitter: 'LIGHT JITTER', heavy_jitter: 'HEAVY JITTER',
};
const FAILURE_COLOR: Record<string, string> = {
  none: 'text-green-400', light_jitter: 'text-yellow-400', heavy_jitter: 'text-orange-400',
};
const BODY_GROUPS: { label: string; joints: Array<keyof PoseLandmarks> }[] = [
  { label: 'Head',       joints: ['nose'] },
  { label: 'Arms',       joints: ['leftShoulder','rightShoulder','leftElbow','rightElbow','leftWrist','rightWrist'] },
  { label: 'Torso/Legs', joints: ['leftHip','rightHip','leftKnee','rightKnee','leftAnkle','rightAnkle'] },
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
                  <span className="text-xs text-gray-400 capitalize">{joint.replace(/([A-Z])/g, ' $1').trim()}</span>
                  <span className={`text-xs font-mono font-semibold ${s.reliable ? FAILURE_COLOR[s.failureType] ?? 'text-gray-500' : 'text-gray-600'}`}>
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

function ConfigPanel({ config, onChange }: {
  config: FailureCorrectionConfig;
  onChange: (k: keyof FailureCorrectionConfig, v: number) => void;
}) {
  const field = (label: string, key: keyof FailureCorrectionConfig, min: number, max: number, step: number, unit: string) => (
    <div className="flex items-center justify-between gap-4">
      <label className="text-xs text-gray-400 flex-1">{label}</label>
      <div className="flex items-center gap-2">
        <input type="range" min={min} max={max} step={step} value={config[key]}
          onChange={e => onChange(key, parseFloat(e.target.value))} className="w-28 accent-purple-500" />
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

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m.toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}.${cs.toString().padStart(2,'0')}`;
}

const emptyPose = (): TriangulatedPose =>
  Object.fromEntries(LANDMARK_KEYS.map(k => [k, null])) as TriangulatedPose;

export function IMUReconstructionView({
  camera1Ref, camera2Ref, camera1Stream, camera2Stream,
  isBothCamerasActive, preloadedCalibration, onCorrectedPose,
  imuReconstructionPose = null,
}: IMUReconstructionViewProps) {
  const { loadCalibration, calibrationResult } = useCameraCalibration();
  const calibFileRef = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [showFeeds, setShowFeeds]   = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [recordingName, setRecordingName] = useState('');
  const [analyzerRecording, setAnalyzerRecording] = useState<MotionRecording | null>(null);

  const [configOverrides, setConfigOverrides] = useState<Partial<FailureCorrectionConfig>>({});
  const config: FailureCorrectionConfig = { ...DEFAULT_CONFIG, ...configOverrides };
  const handleConfigChange = useCallback((k: keyof FailureCorrectionConfig, v: number) => {
    setConfigOverrides(prev => ({ ...prev, [k]: v }));
  }, []);

  const displayVideo1Ref = useRef<HTMLVideoElement | null>(null);
  const displayVideo2Ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { if (displayVideo1Ref.current) displayVideo1Ref.current.srcObject = camera1Stream; }, [camera1Stream]);
  useEffect(() => { if (displayVideo2Ref.current) displayVideo2Ref.current.srcObject = camera2Stream; }, [camera2Stream]);

  const calibration = calibrationResult ?? preloadedCalibration ?? null;

  const {
    isRecording, currentRecording, recordings,
    startRecording, stopRecording, recordStereoFrame,
    deleteRecording, clearAllRecordings, exportRecording,
    debugCounters, debugMetrics,
  } = useStereoMotionRecorder();

  const debugSummaryRef = useRef({ onStereoFrameCalls: 0, triangulationCalls: 0, correctionCalls: 0 });

  const { correct } = usePoseFailureCorrection(config);
  const [rawPose, setRawPose]               = useState<TriangulatedPose>(emptyPose());
  const [correctedPose, setCorrectedPose]   = useState<TriangulatedPose>(emptyPose());
  const [jointStatuses, setJointStatuses]   = useState<JointFailureStatus[]>([]);

  const calibrationRef        = useRef(calibration);
  const isRecordingRef        = useRef(isRecording);
  const recordStereoFrameRef  = useRef(recordStereoFrame);
  const correctRef            = useRef(correct);
  const onCorrectedPoseRef    = useRef(onCorrectedPose);
  useEffect(() => { calibrationRef.current     = calibration;       }, [calibration]);
  useEffect(() => { isRecordingRef.current     = isRecording;       }, [isRecording]);
  useEffect(() => { recordStereoFrameRef.current = recordStereoFrame; }, [recordStereoFrame]);
  useEffect(() => { correctRef.current         = correct;           }, [correct]);
  useEffect(() => { onCorrectedPoseRef.current = onCorrectedPose;   }, [onCorrectedPose]);

  const lastStatusUpdateRef = useRef(0);

  const onStereoFrameRef = useRef<((lm1: PoseLandmarks | null, lm2: PoseLandmarks | null) => void) | null>(null);
  onStereoFrameRef.current = (lm1, lm2) => {
    debugSummaryRef.current.onStereoFrameCalls += 1;
    if (!lm1 || !lm2 || !calibrationRef.current) return;

    const w1 = camera1Ref.current?.videoWidth  ?? 1280;
    const h1 = camera1Ref.current?.videoHeight ?? 720;
    const w2 = camera2Ref.current?.videoWidth  ?? 1280;
    const h2 = camera2Ref.current?.videoHeight ?? 720;

    debugSummaryRef.current.triangulationCalls += 1;
    const raw = triangulateAllLandmarks(calibrationRef.current, lm1, lm2, w1, h1, w2, h2);

    debugSummaryRef.current.correctionCalls += 1;
    const { correctedPose: corrected, jointStatuses: statuses } = correctRef.current(raw);

    if (isRecordingRef.current) recordStereoFrameRef.current(corrected, lm1);

    setRawPose(raw);
    setCorrectedPose(corrected);

    // Notify parent (IMULabView) for calibration and validation — no extra re-render here
    const tracked = LANDMARK_KEYS.filter(k => corrected[k] !== null).length;
    onCorrectedPoseRef.current?.(corrected, tracked, statuses);

    const now = performance.now();
    if (now - lastStatusUpdateRef.current > 250) {
      lastStatusUpdateRef.current = now;
      setJointStatuses(statuses);
    }
  };

  const { camera1Landmarks, camera2Landmarks, isLoaded: poseLoaded, error: poseError, debugInstanceId, debugStats } =
    useDualMediaPipePose(camera1Ref.current, camera2Ref.current, isBothCamerasActive, onStereoFrameRef);

  const cam1W = camera1Ref.current?.videoWidth  ?? 1280;
  const cam1H = camera1Ref.current?.videoHeight ?? 720;
  const cam2W = camera2Ref.current?.videoWidth  ?? 1280;
  const cam2H = camera2Ref.current?.videoHeight ?? 720;

  const handleStartRecording = useCallback(() => {
    debugSummaryRef.current = { onStereoFrameCalls: 0, triangulationCalls: 0, correctionCalls: 0 };
    startRecording({ notes: '3D + failure-correction + IMU recording', deviceInfo: navigator.userAgent });
  }, [startRecording]);

  const handleStopRecording = useCallback(() => {
    stopRecording();
    console.info('[IMU RECON SUMMARY]', {
      debugInstanceId,
      debugStats: debugStats.current,
      ...debugSummaryRef.current,
      recordStereoFrameCalls: debugCounters.current.recordStereoFrameCalls,
      bufferPushCalls: debugMetrics.current.frameBufferPushCalls,
    });
    setRecordingName('');
  }, [stopRecording, debugCounters, debugMetrics, debugInstanceId, debugStats]);

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

  const trackedRaw       = LANDMARK_KEYS.filter(k => rawPose[k]       !== null).length;
  const trackedCorrected = LANDMARK_KEYS.filter(k => correctedPose[k] !== null).length;
  const jitterCount      = jointStatuses.filter(s => s.failureType !== 'none' && s.reliable).length;

  return (
    <div className="space-y-6">
      {/* ── Status bar ─────────────────────────────────────────────── */}
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
        {calibration?.stereoReprojectionError != null && (
          <span className="text-xs text-gray-500 ml-auto">
            Stereo error: {calibration.stereoReprojectionError.toFixed(3)} px
          </span>
        )}
      </div>

      {poseError && (
        <Card className="bg-red-900/20 border-red-700 p-3 text-sm text-red-300">{poseError}</Card>
      )}

      {/* ── Calibration loader ──────────────────────────────────────── */}
      {!calibration && (
        <Card className="bg-gray-900 border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-3">Load Stereo Calibration</h3>
          <Button onClick={() => calibFileRef.current?.click()} variant="outline">
            <Upload className="h-4 w-4 mr-2" /> Load stereo_calibration.json
          </Button>
          <input ref={calibFileRef} type="file" accept=".json" onChange={handleLoadCalibration} className="hidden" />
          {loadError && (
            <div className="mt-3 bg-red-900/40 border border-red-700 rounded p-3 text-sm text-red-300 whitespace-pre-wrap">
              {loadError}
            </div>
          )}
        </Card>
      )}

      {/* ── Camera feeds ────────────────────────────────────────────── */}
      <Card className="bg-gray-900 border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-white text-sm">Camera Feeds (RAW landmarks)</h3>
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
                      style={{ pointerEvents: 'none' }}>
                      {SKELETON_CONNECTIONS.map(([a, b]) => {
                        const pa = lm[a], pb = lm[b];
                        if (!pa || !pb || (pa.visibility ?? 1) < 0.5 || (pb.visibility ?? 1) < 0.5) return null;
                        return <line key={`${a}-${b}`} x1={pa.x*w} y1={pa.y*h} x2={pb.x*w} y2={pb.y*h}
                          stroke="rgba(255,255,255,0.55)" strokeWidth="3" strokeLinecap="round" />;
                      })}
                      {LANDMARK_KEYS.map(key => {
                        const pt = lm[key];
                        if (!pt || (pt.visibility ?? 1) < 0.5) return null;
                        const tracked = rawPose[key] !== null;
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

      {/* ── 3D Reconstruction ───────────────────────────────────────── */}
      <Card className="bg-gray-900 border-gray-700 p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-semibold text-white">3D Skeleton — Stereo vs IMU</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Stereo tracked: {trackedRaw} · Corrected (internal): {trackedCorrected}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isRecording ? (
              <>
                <Input placeholder="Recording name (optional)" value={recordingName}
                  onChange={e => setRecordingName(e.target.value)}
                  className="bg-gray-800 border-gray-700 text-white w-48 h-8 text-sm" />
                <Button onClick={handleStartRecording}
                  disabled={!isBothCamerasActive || !calibration || !poseLoaded}
                  className="bg-red-600 hover:bg-red-700 h-8 text-sm">
                  <Circle className="h-3 w-3 mr-1.5" /> Record
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

        {(() => {
          const rawProjected = projectPose(correctedPose, 'front');
          const sharedBounds = computeBounds(rawProjected);

          // Phase A placeholder: right arm joints only from stereo raw pose
          const rightArmPlaceholder: TriangulatedPose = {
            ...Object.fromEntries(LANDMARK_KEYS.map(k => [k, null])),
            rightShoulder: correctedPose.rightShoulder,
            rightElbow:    correctedPose.rightElbow,
            rightWrist:    correctedPose.rightWrist,
          } as TriangulatedPose;
          const imuDisplayPose = imuReconstructionPose ?? rightArmPlaceholder;

          return (
            <div className="grid grid-cols-2 gap-3 mb-4">
              {/* LEFT — Corrected Stereo 3D (best vision estimate; reference for IMU validation) */}
              <div>
                <p className="text-xs text-gray-500 mb-1.5 font-medium">Corrected Stereo Reconstruction</p>
                <div className="bg-gray-950 rounded-lg border border-gray-700 flex items-center justify-center" style={{ height: 280 }}>
                  <SkeletonView pose3D={correctedPose} view="front" width={380} height={260} label="STEREO (corrected)" labelColor="#34d399" sharedBounds={sharedBounds} />
                </div>
              </div>

              {/* RIGHT — IMU Reconstruction (Phase A placeholder) */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <p className="text-xs text-gray-500 font-medium">IMU Reconstruction</p>
                  {!imuReconstructionPose && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-400 border border-orange-800 font-semibold leading-tight">
                      Phase A Placeholder
                    </span>
                  )}
                </div>
                <div className="bg-gray-950 rounded-lg border border-orange-900/40 flex items-center justify-center relative" style={{ height: 280 }}>
                  <SkeletonView pose3D={imuDisplayPose} view="front" width={380} height={260} label="IMU" labelColor="#fb923c" sharedBounds={sharedBounds} />
                  {!imuReconstructionPose && (
                    <div className="absolute bottom-2 left-0 right-0 flex justify-center pointer-events-none">
                      <span className="text-xs text-orange-500/70 font-mono">mirrors stereo right arm · Phase B will replace</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {!isBothCamerasActive && <p className="text-sm text-yellow-400">Start both cameras in Camera Setup first.</p>}
        {isBothCamerasActive && !calibration && <p className="text-sm text-yellow-400">Load a calibration file above to enable reconstruction.</p>}
        {isBothCamerasActive && calibration && trackedCorrected === 0 && poseLoaded && <p className="text-sm text-gray-500">Move into view of both cameras...</p>}
      </Card>

      {/* ── Joint status ─────────────────────────────────────────────── */}
      <Card className="bg-gray-900 border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Joint Failure Status</h3>
        {jointStatuses.length > 0 ? <JointStatusPanel statuses={jointStatuses} /> : (
          <p className="text-xs text-gray-600">No pose detected yet.</p>
        )}
      </Card>

      {/* ── Correction config ────────────────────────────────────────── */}
      <Card className="bg-gray-900 border-gray-700 p-4">
        <button className="flex items-center gap-2 w-full text-left" onClick={() => setShowConfig(v => !v)}>
          <Settings className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-semibold text-white">Correction Parameters</span>
          <span className="text-xs text-gray-500 ml-auto">{showConfig ? '▲ hide' : '▼ show'}</span>
        </button>
        {showConfig && <ConfigPanel config={config} onChange={handleConfigChange} />}
      </Card>

      {/* ── Recordings ──────────────────────────────────────────────── */}
      {recordings.length > 0 && (
        <Card className="bg-gray-900 border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Corrected Recordings</h3>
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
                    <Badge variant="secondary" className="bg-purple-900/40 text-purple-300 text-xs">3D · corrected · mm · IMU</Badge>
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
