import { useRef, useState, useEffect, useCallback } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useDualMediaPipePose } from '../hooks/useDualMediaPipePose';
import { useTriangulation, LANDMARK_KEYS, SKELETON_CONNECTIONS, type TriangulatedPose } from '../hooks/useTriangulation';
import { useStereoMotionRecorder } from '../hooks/useStereoMotionRecorder';
import { MotionDataVisualizer } from './MotionDataVisualizer';
import { type MotionRecording } from '../hooks/useMotionRecorder';
import { StereoCalibration } from '../type/calibration';
import { PoseLandmarks } from '../hooks/useMediaPipePose';
import { Play, Pause, RotateCcw, Circle, Square, Download, Trash2, BarChart3, Film, Upload } from 'lucide-react';

interface StereoVideoPlaybackProps {
  calibration: StereoCalibration | null;
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

function SkeletonView({ pose3D, view, width, height }: {
  pose3D: TriangulatedPose; view: 'front' | 'side' | 'top'; width: number; height: number;
}) {
  const PAD = 24;
  const project = (key: keyof PoseLandmarks) => {
    const pt = pose3D[key];
    if (!pt) return null;
    if (view === 'front') return { px: pt.x, py: -pt.y };  // negate Y: OpenCV Y-down → SVG Y-up
    if (view === 'side')  return { px: pt.z, py: -pt.y };
    return { px: pt.x, py: pt.z };
  };
  const projected = LANDMARK_KEYS.map(k => ({ key: k, pt: project(k) })).filter(d => d.pt !== null) as
    { key: keyof PoseLandmarks; pt: { px: number; py: number } }[];
  if (projected.length === 0) {
    return (
      <svg width={width} height={height}>
        <text x={width/2} y={height/2} textAnchor="middle" fill="#4b5563" fontSize="13">No joints detected</text>
      </svg>
    );
  }
  const xs = projected.map(d => d.pt.px);
  const ys = projected.map(d => d.pt.py);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min((width - PAD*2) / rangeX, (height - PAD*2) / rangeY);
  const toSVG = (px: number, py: number) => ({
    x: PAD + (px - minX) * scale + ((width  - PAD*2) - rangeX*scale) / 2,
    y: PAD + (py - minY) * scale + ((height - PAD*2) - rangeY*scale) / 2,
  });
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      {SKELETON_CONNECTIONS.map(([a, b]) => {
        const pa = project(a); const pb = project(b);
        if (!pa || !pb) return null;
        const svgA = toSVG(pa.px, pa.py); const svgB = toSVG(pb.px, pb.py);
        return <line key={`${a}-${b}`} x1={svgA.x} y1={svgA.y} x2={svgB.x} y2={svgB.y}
          stroke="rgba(255,255,255,0.5)" strokeWidth="4" strokeLinecap="round" />;
      })}
      {projected.map(({ key, pt }) => {
        const { x, y } = toSVG(pt.px, pt.py);
        return <circle key={key} cx={x} cy={y} r={5} fill={LANDMARK_COLORS[key]}
          stroke="rgba(0,0,0,0.6)" strokeWidth="1.5" />;
      })}
    </svg>
  );
}

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

export function StereoVideoPlayback({ calibration: calibrationProp }: StereoVideoPlaybackProps) {
  // Allow loading a calibration file locally in addition to receiving one via prop
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
  // State copies of the elements so useDualMediaPipePose re-runs when they mount
  const [video1El, setVideo1El] = useState<HTMLVideoElement | null>(null);
  const [video2El, setVideo2El] = useState<HTMLVideoElement | null>(null);
  const [url1, setUrl1] = useState<string | null>(null);
  const [url2, setUrl2] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [analyzerRecording, setAnalyzerRecording] = useState<MotionRecording | null>(null);

  // Both videos loaded and have metadata
  const [vid1Ready, setVid1Ready] = useState(false);
  const [vid2Ready, setVid2Ready] = useState(false);
  const bothLoaded = vid1Ready && vid2Ready;

  // Drift correction: keep both videos in sync within half a frame (≈16ms)
  const DRIFT_THRESHOLD = 0.05; // seconds
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      const v1 = video1Ref.current;
      const v2 = video2Ref.current;
      if (!v1 || !v2) return;
      const drift = Math.abs(v1.currentTime - v2.currentTime);
      if (drift > DRIFT_THRESHOLD) {
        // Snap the faster one back to the slower one
        if (v1.currentTime > v2.currentTime) v1.currentTime = v2.currentTime;
        else v2.currentTime = v1.currentTime;
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Track current time from video 1 for the scrubber
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
    if (camIndex === 1) {
      if (url1) URL.revokeObjectURL(url1);
      setUrl1(url);
      setVid1Ready(false);
      setVideo1El(null);
    } else {
      if (url2) URL.revokeObjectURL(url2);
      setUrl2(url);
      setVid2Ready(false);
      setVideo2El(null);
    }
    setIsPlaying(false);
    setCurrentTime(0);
  }, [url1, url2]);

  const handlePlay = useCallback(() => {
    const v1 = video1Ref.current;
    const v2 = video2Ref.current;
    if (!v1 || !v2 || !bothLoaded) return;
    // Start both in the same synchronous call — same tick as recording
    v1.play();
    v2.play();
    setIsPlaying(true);
  }, [bothLoaded]);

  const handlePause = useCallback(() => {
    video1Ref.current?.pause();
    video2Ref.current?.pause();
    setIsPlaying(false);
  }, []);

  const handleRestart = useCallback(() => {
    const v1 = video1Ref.current;
    const v2 = video2Ref.current;
    if (!v1 || !v2) return;
    v1.currentTime = 0;
    v2.currentTime = 0;
    setCurrentTime(0);
    setIsPlaying(false);
  }, []);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (video1Ref.current) video1Ref.current.currentTime = t;
    if (video2Ref.current) video2Ref.current.currentTime = t;
    setCurrentTime(t);
  }, []);

  // Feed videos into MediaPipe — same hook as live mode, just using video elements.
  // Uses state (not ref.current) so the hook re-runs when elements mount.
  const { camera1Landmarks, camera2Landmarks, isLoaded: poseLoaded } =
    useDualMediaPipePose(video1El, video2El, bothLoaded && isPlaying);

  const cam1W = video1El?.videoWidth  ?? 1280;
  const cam1H = video1El?.videoHeight ?? 720;
  const cam2W = video2El?.videoWidth  ?? 1280;
  const cam2H = video2El?.videoHeight ?? 720;

  const { pose: pose3D } = useTriangulation(
    calibration, camera1Landmarks, camera2Landmarks,
    cam1W, cam1H, cam2W, cam2H,
  );

  const {
    isRecording, currentRecording, recordings,
    startRecording, stopRecording, recordStereoFrame,
    deleteRecording, clearAllRecordings, exportRecording,
  } = useStereoMotionRecorder();

  useEffect(() => {
    if (isRecording && camera1Landmarks)
      recordStereoFrame(pose3D, camera1Landmarks);
  }, [pose3D, isRecording, camera1Landmarks, recordStereoFrame]);

  const trackedCount = LANDMARK_KEYS.filter(k => pose3D[k] !== null).length;

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
        <Badge className={trackedCount > 0 ? 'bg-blue-600 animate-pulse' : 'bg-gray-700'}>
          {trackedCount > 0 ? `Tracking ${trackedCount}/${LANDMARK_KEYS.length} joints` : 'No Detection'}
        </Badge>
        {isRecording && (
          <Badge className="bg-red-600 animate-pulse flex items-center gap-1">
            <Circle className="h-2 w-2 fill-white" />
            REC {formatDuration(currentRecording?.duration ?? 0)}
          </Badge>
        )}

        {/* Calibration file loader */}
        <label className={`flex items-center gap-1.5 px-3 py-1 rounded border cursor-pointer text-xs transition-colors
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
          Load the two camera videos recorded simultaneously. They must have been started at the same time (e.g. via the Video Recording tab).
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
                      playsInline
                      muted
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
                        const pa = lm[a]; const pb = lm[b];
                        if (!pa || !pb || (pa.visibility??1) < 0.5 || (pb.visibility??1) < 0.5) return null;
                        return <line key={`${a}-${b}`} x1={pa.x*w} y1={pa.y*h} x2={pb.x*w} y2={pb.y*h}
                          stroke="rgba(255,255,255,0.55)" strokeWidth="3" strokeLinecap="round" />;
                      })}
                      {LANDMARK_KEYS.map(key => {
                        const pt = lm[key];
                        if (!pt || (pt.visibility??1) < 0.5) return null;
                        const tracked = pose3D[key] !== null;
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
            <Button size="sm" variant="outline" onClick={handleRestart}
              className="border-gray-600 text-gray-300 hover:bg-gray-700 h-8 w-8 p-0">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={isPlaying ? handlePause : handlePlay}
              disabled={!bothLoaded}
              className={`h-8 px-4 ${isPlaying ? 'bg-gray-600 hover:bg-gray-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <input type="range" min={0} max={duration || 1} step={0.05}
              value={currentTime}
              onChange={handleScrub}
              className="flex-1 accent-blue-500" />
            <span className="text-xs text-gray-400 tabular-nums w-24 text-right">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </Card>
      )}

      {/* ── 3D Reconstruction + Recording ──────────────────────────── */}
      <Card className="bg-gray-900 border-gray-700 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-white">3D Skeleton Reconstruction</h3>
          <div className="flex items-center gap-2">
            {!isRecording ? (
              <Button
                onClick={() => startRecording({ notes: '3D stereo playback recording' })}
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

        <div className="bg-gray-950 rounded-lg border border-gray-800 flex items-center justify-center mb-4"
          style={{ height: 360 }}>
          <SkeletonView pose3D={pose3D} view="front" width={800} height={350} />
        </div>

        {!bothLoaded && (
          <p className="text-sm text-yellow-400">⚠️ Load both camera videos above to enable reconstruction.</p>
        )}
        {bothLoaded && !calibration && (
          <p className="text-sm text-yellow-400">⚠️ No calibration loaded — 3D reconstruction unavailable.</p>
        )}
        {bothLoaded && calibration && !isPlaying && (
          <p className="text-sm text-gray-500">Press Play to start reconstruction.</p>
        )}
        {bothLoaded && calibration && isPlaying && trackedCount === 0 && poseLoaded && (
          <p className="text-sm text-gray-500">No joints detected in current frame...</p>
        )}
      </Card>

      {/* ── Recordings list ────────────────────────────────────────── */}
      {recordings.length > 0 && (
        <Card className="bg-gray-900 border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">3D Recordings (from playback)</h3>
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
                    <Badge variant="secondary" className="bg-blue-900/40 text-blue-300 text-xs">3D · mm · playback</Badge>
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
