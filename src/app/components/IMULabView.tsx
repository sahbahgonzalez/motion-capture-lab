/**
 * IMULabView — Phase B
 *
 * "3D Failure Correction + IMU" tab.
 *
 * Phase B adds:
 *   - Real IMU reconstruction using relative quaternion rotation + forward kinematics
 *   - Freeze Vision Reference dev toggle
 *   - Angular error metrics (stereo direction vs IMU direction per segment)
 *   - Extended reconstruction debug panel
 *
 * Architecture:
 *   - IMUReconstructionView always mounted (forceMount + hidden) — stereo pipeline
 *     stays alive regardless of which inner tab is active.
 *   - Reconstruction runs once per stereo frame inside onCorrectedPose.
 *   - All hot-path writes go to refs; React state syncs at 10fps.
 *   - Quaternion math only — no Euler intermediates in reconstruction path.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useDualCamera } from '../hooks/useDualCamera';
import { useCameraCalibration } from '../hooks/useCameraCalibration';
import { useStereoVideoRecorder } from '../hooks/useStereoVideoRecorder';
import { CalibrationView } from './CalibrationView';
import { IMUReconstructionView } from './IMUReconstructionView';
import { FailureCorrectionPlayback } from './FailureCorrectionPlayback';
import { useIMUWebSocket, IMU_IDS, IMU_SEGMENT, type IMUState, type IMUPacket } from '../hooks/useIMUWebSocket';
import { type JointFailureStatus } from '../hooks/usePoseFailureCorrection';
import { type TriangulatedPose, LANDMARK_KEYS } from '../hooks/useTriangulation';
import {
  type Quaternion,
  type Vec3,
  quaternionToEuler,
  averageQuaternions,
  invertQuaternion,
  multiplyQuaternions,
  rotateVectorByQuaternion,
} from '../utils/quaternionUtils';
import {
  Video, VideoOff, AlertCircle, RefreshCw, Circle, Square, Download,
  Wifi, WifiOff, Activity, ChevronDown, ChevronUp, Snowflake,
} from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────

const RAD2DEG = 180 / Math.PI;
const CALIBRATION_FRAMES_NEEDED = 45;
// Plausible arm segment range in mm. Outside this → unsafe reference frame.
const SEG_MIN_MM = 50;
const SEG_MAX_MM = 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatVideoDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m.toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}.${cs.toString().padStart(2,'0')}`;
}

function dist3D(a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}): number {
  return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
}

function normalize3(v: {x:number;y:number;z:number}): {x:number;y:number;z:number} {
  const len = Math.sqrt(v.x**2 + v.y**2 + v.z**2) || 1;
  return { x: v.x/len, y: v.y/len, z: v.z/len };
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

function dot3(a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}): number {
  return a.x*b.x + a.y*b.y + a.z*b.z;
}

function angleBetweenDeg(a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}): number {
  return Math.acos(Math.max(-1, Math.min(1, dot3(normalize3(a), normalize3(b))))) * RAD2DEG;
}

function isValidVec(v: {x:number;y:number;z:number} | null | undefined): v is {x:number;y:number;z:number} {
  return !!(v && isFinite(v.x) && isFinite(v.y) && isFinite(v.z));
}

function isValidQuat(q: Quaternion | null | undefined): q is Quaternion {
  return !!(q && isFinite(q[0]) && isFinite(q[1]) && isFinite(q[2]) && isFinite(q[3]));
}

function packetToQuat(p: IMUPacket): Quaternion {
  return [p.qw, p.qx, p.qy, p.qz];
}

function fmtQ(v: number) { return v.toFixed(4); }
function fmtDeg(v: number) { return `${v.toFixed(1)}°`; }
function fmtMm(v: number | null) { return v === null ? '—' : `${v.toFixed(1)} mm`; }

// ── Types ─────────────────────────────────────────────────────────────────────

interface CalibrationFrame {
  shoulder: {x:number;y:number;z:number};
  elbow:    {x:number;y:number;z:number};
  wrist:    {x:number;y:number;z:number};
  imu01:    IMUPacket;
  imu02:    IMUPacket;
}

interface ArmCalibration {
  timestamp:   number;
  framesUsed:  number;
  upperArm: {
    imuQuaternion:  Quaternion;
    imuAccuracy:    number;
    shoulderPos:    {x:number;y:number;z:number};
    elbowPos:       {x:number;y:number;z:number};
    direction:      {x:number;y:number;z:number};
    directionNorm:  {x:number;y:number;z:number};
    lengthMm:       number;
    lengthStdDevMm: number;
  };
  forearm: {
    imuQuaternion:  Quaternion;
    imuAccuracy:    number;
    elbowPos:       {x:number;y:number;z:number};
    wristPos:       {x:number;y:number;z:number};
    direction:      {x:number;y:number;z:number};
    directionNorm:  {x:number;y:number;z:number};
    lengthMm:       number;
    lengthStdDevMm: number;
  };
}

interface LastReliableVision {
  timestamp: number;
  upperArm: {
    shoulder:      {x:number;y:number;z:number};
    elbow:         {x:number;y:number;z:number};
    direction:     {x:number;y:number;z:number};
    imuQuaternion: Quaternion | null;
  };
  forearm: {
    elbow:         {x:number;y:number;z:number};
    wrist:         {x:number;y:number;z:number};
    direction:     {x:number;y:number;z:number};
    imuQuaternion: Quaternion | null;
  };
}

interface SegmentReconDebug {
  qCurrent:    Quaternion | null;
  qLast:       Quaternion | null;
  qDelta:      Quaternion | null;
  dirCurrent:  Vec3 | null;
  dirLast:     Vec3 | null;
  calibLength: number | null;
  reconPos:    {x:number;y:number;z:number} | null;
  stereoPos:   {x:number;y:number;z:number} | null;
  posError:    number | null;
  angError:    number | null;
}

interface ReconDebug {
  ua: SegmentReconDebug;
  fa: SegmentReconDebug;
}

function emptySegDebug(): SegmentReconDebug {
  return {
    qCurrent: null, qLast: null, qDelta: null,
    dirCurrent: null, dirLast: null, calibLength: null,
    reconPos: null, stereoPos: null, posError: null, angError: null,
  };
}

// ── IMU Health Panel ──────────────────────────────────────────────────────────

const HEALTH_COLOR: Record<string, string> = {
  online:  'bg-green-700 text-white',
  stale:   'bg-yellow-700 text-white',
  offline: 'bg-gray-700 text-gray-400',
};
const ACCURACY_LABEL = ['Unreliable', 'Low', 'Medium', 'High'];

function IMUHealthPanel({ imuStates }: { imuStates: Record<string, IMUState> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800">
            <th className="text-left py-2 pr-3 font-medium">ID</th>
            <th className="text-left py-2 pr-3 font-medium">Segment</th>
            <th className="text-left py-2 pr-3 font-medium">Status</th>
            <th className="text-right py-2 pr-3 font-medium">Hz</th>
            <th className="text-right py-2 pr-3 font-medium">Accuracy</th>
            <th className="text-right py-2 pr-3 font-medium">qw</th>
            <th className="text-right py-2 pr-3 font-medium">qx</th>
            <th className="text-right py-2 pr-3 font-medium">qy</th>
            <th className="text-right py-2 pr-3 font-medium">qz</th>
            <th className="text-right py-2 pr-3 font-medium">Yaw</th>
            <th className="text-right py-2 pr-3 font-medium">Pitch</th>
            <th className="text-right py-2 font-medium">Roll</th>
          </tr>
        </thead>
        <tbody>
          {IMU_IDS.map(id => {
            const s = imuStates[id];
            const acc = s.latest?.accuracy ?? null;
            const euler = s.latest
              ? quaternionToEuler([s.latest.qw, s.latest.qx, s.latest.qy, s.latest.qz])
              : null;
            return (
              <tr key={id} className="border-b border-gray-800/50">
                <td className="py-2 pr-3 font-mono text-gray-300">{id}</td>
                <td className="py-2 pr-3 text-gray-400">{IMU_SEGMENT[id] ?? '—'}</td>
                <td className="py-2 pr-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${HEALTH_COLOR[s.health]}`}>
                    {s.health.toUpperCase()}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-gray-400">{s.packetRate.toFixed(1)}</td>
                <td className="py-2 pr-3 text-right text-gray-400">
                  {acc !== null ? ACCURACY_LABEL[Math.min(3, Math.max(0, acc))] : '—'}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-gray-300 font-mono">{s.latest ? fmtQ(s.latest.qw) : '—'}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-gray-300 font-mono">{s.latest ? fmtQ(s.latest.qx) : '—'}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-gray-300 font-mono">{s.latest ? fmtQ(s.latest.qy) : '—'}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-gray-300 font-mono">{s.latest ? fmtQ(s.latest.qz) : '—'}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-blue-300 font-mono">{euler ? fmtDeg(euler.yawDeg) : '—'}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-blue-300 font-mono">{euler ? fmtDeg(euler.pitchDeg) : '—'}</td>
                <td className="py-2 text-right tabular-nums text-blue-300 font-mono">{euler ? fmtDeg(euler.rollDeg) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Dual-Skeleton Validation SVG ──────────────────────────────────────────────

interface ArmPoints {
  shoulder: { x:number; y:number; z:number } | null;
  elbow:    { x:number; y:number; z:number } | null;
  wrist:    { x:number; y:number; z:number } | null;
}

function projectArm(pts: ArmPoints) {
  const proj = (pt: {x:number;y:number;z:number}|null) =>
    pt ? { px: pt.x, py: -pt.y } : null;
  return { shoulder: proj(pts.shoulder), elbow: proj(pts.elbow), wrist: proj(pts.wrist) };
}

function DualArmValidationSVG({ stereo, validation, width, height }: {
  stereo: ArmPoints; validation: ArmPoints; width: number; height: number;
}) {
  const PAD = 32;
  const stereoProj     = projectArm(stereo);
  const validationProj = projectArm(validation);
  const allPts = [
    stereoProj.shoulder, stereoProj.elbow, stereoProj.wrist,
    validationProj.shoulder, validationProj.elbow, validationProj.wrist,
  ].filter(Boolean) as {px:number;py:number}[];
  if (allPts.length === 0) {
    return (
      <svg width={width} height={height}>
        <text x={width/2} y={height/2} textAnchor="middle" fill="#4b5563" fontSize="13">No right arm detected</text>
      </svg>
    );
  }
  const xs = allPts.map(p => p.px), ys = allPts.map(p => p.py);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 100;
  const rangeY = maxY - minY || 100;
  const scale = Math.min((width - PAD*2) / rangeX, (height - PAD*2) / rangeY);
  const toSVG = (px: number, py: number) => ({
    x: PAD + (px - minX) * scale + ((width  - PAD*2) - rangeX*scale) / 2,
    y: PAD + (py - minY) * scale + ((height - PAD*2) - rangeY*scale) / 2,
  });
  const drawArm = (proj: ReturnType<typeof projectArm>, stroke: string, fill: string, label: string) => (
    <>
      {[[proj.shoulder, proj.elbow],[proj.elbow, proj.wrist]].map(([a, b], i) => {
        if (!a || !b) return null;
        const A = toSVG(a.px, a.py), B = toSVG(b.px, b.py);
        return <line key={`bone-${label}-${i}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y}
          stroke={stroke} strokeWidth="5" strokeLinecap="round" opacity={0.85} />;
      })}
      {[proj.shoulder, proj.elbow, proj.wrist].map((pt, i) => {
        if (!pt) return null;
        const { x, y } = toSVG(pt.px, pt.py);
        return <circle key={`joint-${label}-${i}`} cx={x} cy={y} r={7} fill={fill} stroke="rgba(0,0,0,0.7)" strokeWidth="2" />;
      })}
      {proj.shoulder && (() => {
        const { x, y } = toSVG(proj.shoulder.px, proj.shoulder.py);
        return <text x={x + 10} y={y - 6} fill={fill} fontSize="10" fontWeight="600">{label}</text>;
      })()}
    </>
  );
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      {drawArm(stereoProj,     '#34d399', '#34d399', 'STEREO (corrected)')}
      {drawArm(validationProj, '#fb923c', '#fb923c', 'IMU RECON')}
      <rect x={8} y={height - 32} width={12} height={4} fill="#34d399" rx="2" />
      <text x={24} y={height - 26} fill="#34d399" fontSize="10">Corrected Stereo</text>
      <rect x={130} y={height - 32} width={12} height={4} fill="#fb923c" rx="2" />
      <text x={146} y={height - 26} fill="#fb923c" fontSize="10">IMU Reconstruction</text>
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface CalibConditionDebug {
  shoulderOk: boolean; elbowOk: boolean; wristOk: boolean;
  tracked: number; segOk: boolean; uaLenMm: number; faLenMm: number;
  /** Lenient jitter gate used for calibration (light_jitter OK, heavy_jitter blocks). */
  armCalibOk: boolean;
  posVelocityOk: boolean;
  imu01Fresh: boolean; imu02Fresh: boolean; imu01AgeMs: number; imu02AgeMs: number;
}

export function IMULabView() {
  // ── Camera ──────────────────────────────────────────────────────────────────
  const {
    camera1Stream, camera2Stream, availableCameras,
    selectedCamera1, selectedCamera2,
    setSelectedCamera1, setSelectedCamera2,
    isCamera1Active, isCamera2Active,
    startCamera1, startCamera2, stopCamera1, stopCamera2,
    camera1Ref, camera2Ref,
    enumerateCameras, error: cameraError,
  } = useDualCamera();

  const { calibrationResult } = useCameraCalibration();
  const bothCamerasActive = isCamera1Active && isCamera2Active;

  const [activeInnerTab, setActiveInnerTab] = useState('cameras');

  // ── Video recording ──────────────────────────────────────────────────────────
  const {
    isRecording: isVideoRecording,
    recordings: videoRecordings,
    error: videoRecordError,
    startRecording: startVideoRecording,
    stopRecording: stopVideoRecording,
    downloadRecording: downloadVideoRecording,
    deleteRecording: deleteVideoRecording,
  } = useStereoVideoRecorder(camera1Stream, camera2Stream);

  const [videoRecordingMs, setVideoRecordingMs] = useState(0);
  const videoRecordStartRef = useRef<number>(0);
  useEffect(() => {
    if (!isVideoRecording) { setVideoRecordingMs(0); return; }
    videoRecordStartRef.current = Date.now();
    const interval = setInterval(() => setVideoRecordingMs(Date.now() - videoRecordStartRef.current), 100);
    return () => clearInterval(interval);
  }, [isVideoRecording]);

  // ── IMU WebSocket ────────────────────────────────────────────────────────────
  const { connected: imuConnected, imuStates, reconnect: reconnectIMU, getRawIMU } = useIMUWebSocket();

  // ── Corrected pose + IMU reconstruction ──────────────────────────────────────
  const correctedPoseRef  = useRef<TriangulatedPose>(Object.fromEntries(LANDMARK_KEYS.map(k => [k, null])) as TriangulatedPose);
  const trackedCountRef   = useRef(0);
  const imuReconPoseRef   = useRef<TriangulatedPose | null>(null);
  const imuReconDebugRef  = useRef<ReconDebug>({ ua: emptySegDebug(), fa: emptySegDebug() });

  const [displayPose, setDisplayPose]       = useState<TriangulatedPose>(correctedPoseRef.current);
  const [imuReconPose, setImuReconPose]     = useState<TriangulatedPose | null>(null);
  const [imuReconDebug, setImuReconDebug]   = useState<ReconDebug | null>(null);

  // ── Calibration ──────────────────────────────────────────────────────────────
  const [calibStatus, setCalibStatus]       = useState<'idle' | 'collecting' | 'done'>('idle');
  const [calibFrames, setCalibFrames]       = useState<CalibrationFrame[]>([]);
  const [armCalibration, setArmCalibration] = useState<ArmCalibration | null>(null);
  const calibFramesRef    = useRef<CalibrationFrame[]>([]);
  const armCalibrationRef = useRef<ArmCalibration | null>(null);
  useEffect(() => { armCalibrationRef.current = armCalibration; }, [armCalibration]);

  // ── Last Reliable Vision ─────────────────────────────────────────────────────
  const [lastReliable, setLastReliable]   = useState<LastReliableVision | null>(null);
  const lastReliableRef       = useRef<LastReliableVision | null>(null);
  const lastReliableUpdateRef = useRef(0);

  // ── Freeze Vision Reference dev toggle ───────────────────────────────────────
  const [freezeReference, setFreezeReference] = useState(false);
  const freezeReferenceRef = useRef(false);
  useEffect(() => { freezeReferenceRef.current = freezeReference; }, [freezeReference]);

  // ── Per-frame calibration condition debug ────────────────────────────────────
  const calibCondDebugRef = useRef<CalibConditionDebug | null>(null);
  const [calibCondDebug, setCalibCondDebug] = useState<CalibConditionDebug | null>(null);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [showValidation, setShowValidation] = useState(false);
  const [showDebug, setShowDebug]           = useState(false);

  // ── 10 fps sync (all display state updated together) ─────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setDisplayPose({ ...correctedPoseRef.current });
      setImuReconPose(imuReconPoseRef.current ? { ...imuReconPoseRef.current } : null);
      setImuReconDebug({ ...imuReconDebugRef.current });
      if (lastReliableRef.current) setLastReliable({ ...lastReliableRef.current });
      if (calibCondDebugRef.current) setCalibCondDebug({ ...calibCondDebugRef.current });
    }, 100);
    return () => clearInterval(id);
  }, []);

  // ── Per-frame callback from IMUReconstructionView ─────────────────────────────
  const getRawIMURef = useRef(getRawIMU);
  useEffect(() => { getRawIMURef.current = getRawIMU; }, [getRawIMU]);

  const onCorrectedPose = useCallback((pose: TriangulatedPose, tracked: number, statuses: JointFailureStatus[]) => {
    correctedPoseRef.current = pose;
    trackedCountRef.current  = tracked;

    const shoulder = pose['rightShoulder'];
    const elbow    = pose['rightElbow'];
    const wrist    = pose['rightWrist'];

    // ── Validate arm geometry before accepting as reference ──────────────────
    const shoulderOk = isValidVec(shoulder);
    const elbowOk    = isValidVec(elbow);
    const wristOk    = isValidVec(wrist);
    const uaLen      = (shoulderOk && elbowOk) ? dist3D(shoulder!, elbow!) : 0;
    const faLen      = (elbowOk && wristOk)    ? dist3D(elbow!,   wrist!)  : 0;
    const segOk      = uaLen > SEG_MIN_MM && uaLen < SEG_MAX_MM && faLen > SEG_MIN_MM && faLen < SEG_MAX_MM;

    // ── Jitter gate (two variants) ───────────────────────────────────────────
    const byJoint = Object.fromEntries(statuses.map(s => [s.joint, s]));
    // Strict: no jitter at all — used to gate lastReliableRef updates
    const rightArmClean = (['rightShoulder', 'rightElbow', 'rightWrist'] as const).every(
      joint => byJoint[joint]?.reliable && byJoint[joint]?.failureType === 'none',
    );
    // Lenient: light_jitter is OK — positions are already EMA-smoothed; only reject heavy_jitter
    const rightArmCalibOk = (['rightShoulder', 'rightElbow', 'rightWrist'] as const).every(
      joint => byJoint[joint]?.reliable && byJoint[joint]?.failureType !== 'heavy_jitter',
    );

    // Calibrated segment-length gate (active only after arm calibration).
    const calibData = armCalibrationRef.current;
    const segCalibOk = calibData
      ? Math.abs(uaLen - calibData.upperArm.lengthMm) / calibData.upperArm.lengthMm <= 0.20 &&
        Math.abs(faLen - calibData.forearm.lengthMm)  / calibData.forearm.lengthMm  <= 0.20
      : true;

    // Position velocity gate — catches teleporting joints; 120mm/frame ≈ 3.6 m/s at 30fps.
    const ref = lastReliableRef.current;
    const posVelocityOk = (ref && elbow && wrist)
      ? dist3D(elbow,  ref.upperArm.elbow) < 120 &&
        dist3D(wrist,  ref.forearm.wrist)  < 120
      : true;

    // Strict arm reliability — gates lastReliableRef updates only
    const armReliable = shoulderOk && elbowOk && wristOk && tracked >= 3 &&
      segOk && rightArmClean && segCalibOk && posVelocityOk;

    // Lenient arm validity — gates calibration frame collection
    // Does NOT require rightArmClean so minor jitter during T-pose doesn't block calibration.
    // segCalibOk intentionally omitted: no prior calibration exists yet on first run.
    const calibArmOk = shoulderOk && elbowOk && wristOk && tracked >= 3 &&
      segOk && rightArmCalibOk && posVelocityOk;

    // ── Update Last Reliable Vision (strict gate, position-anchor only) ──────
    if (armReliable && shoulder && elbow && wrist && !freezeReferenceRef.current) {
      const imu01Raw = getRawIMURef.current('imu_01');
      const imu02Raw = getRawIMURef.current('imu_02');
      const imu01Quat: Quaternion | null = imu01Raw?.latest ? packetToQuat(imu01Raw.latest) : null;
      const imu02Quat: Quaternion | null = imu02Raw?.latest ? packetToQuat(imu02Raw.latest) : null;

      const uaDir = normalize3({ x: elbow.x-shoulder.x, y: elbow.y-shoulder.y, z: elbow.z-shoulder.z });
      const faDir = normalize3({ x: wrist.x-elbow.x,    y: wrist.y-elbow.y,    z: wrist.z-elbow.z    });

      lastReliableRef.current = {
        timestamp: Date.now(),
        upperArm: { shoulder: {...shoulder}, elbow: {...elbow}, direction: uaDir, imuQuaternion: imu01Quat },
        forearm:  { elbow: {...elbow}, wrist: {...wrist}, direction: faDir, imuQuaternion: imu02Quat },
      };

      const nowMs = performance.now();
      if (nowMs - lastReliableUpdateRef.current > 500) {
        lastReliableUpdateRef.current = nowMs;
        // setLastReliable happens in the 10fps interval above
      }
    }

    // ── Per-frame condition debug (always update for UI feedback) ───────────
    {
      const imu01RawDbg = getRawIMURef.current('imu_01');
      const imu02RawDbg = getRawIMURef.current('imu_02');
      const nowMs = performance.now();
      const imu01Age = imu01RawDbg ? nowMs - imu01RawDbg.lastReceivedAt : Infinity;
      const imu02Age = imu02RawDbg ? nowMs - imu02RawDbg.lastReceivedAt : Infinity;
      calibCondDebugRef.current = {
        shoulderOk, elbowOk, wristOk, tracked,
        segOk, uaLenMm: uaLen, faLenMm: faLen,
        armCalibOk: rightArmCalibOk,
        posVelocityOk,
        // Freshness threshold matches the "online" health threshold in useIMUWebSocket
        imu01Fresh: imu01Age <= 500, imu02Fresh: imu02Age <= 500,
        imu01AgeMs: isFinite(imu01Age) ? Math.round(imu01Age) : 9999,
        imu02AgeMs: isFinite(imu02Age) ? Math.round(imu02Age) : 9999,
      };
    }

    // ── Collect calibration frames ───────────────────────────────────────────
    // Uses calibArmOk (lenient) so light jitter during a held T-pose doesn't
    // permanently block progress. No early returns — reconstruction must still run.
    if (calibStatus === 'collecting' && calibArmOk && shoulder && elbow && wrist) {
      const imu01Raw = getRawIMURef.current('imu_01');
      const imu02Raw = getRawIMURef.current('imu_02');
      const nowMs = performance.now();
      // 500ms freshness matches the useIMUWebSocket "online" threshold: if the IMU
      // shows as online in the UI, calibration frames should be accepted.
      if (
        imu01Raw?.latest && imu02Raw?.latest &&
        nowMs - imu01Raw.lastReceivedAt <= 500 &&
        nowMs - imu02Raw.lastReceivedAt <= 500
      ) {
        calibFramesRef.current.push({
          shoulder: {...shoulder}, elbow: {...elbow}, wrist: {...wrist},
          imu01: { ...imu01Raw.latest },
          imu02: { ...imu02Raw.latest },
        });
        setCalibFrames([...calibFramesRef.current]);
      }
    }

    // ── IMU Reconstruction ───────────────────────────────────────────────────
    // Uses the stored CALIBRATION quaternion as the fixed orientation reference —
    // not lastReliableVision, which would cause stereo to continuously reset the
    // IMU reference and make the reconstruction mirror stereo.
    //
    // Architecture:
    //   qDeltaUA = qCurrentUA ⊗ inv(calib.upperArm.imuQuaternion)
    //   dir      = rotateVectorByQuaternion(qDeltaUA, calib.upperArm.directionNorm)
    //   elbow    = anchorShoulder + uaLength × dir
    //   (same pattern for forearm)
    const calib = armCalibrationRef.current;

    if (!calib) {
      imuReconPoseRef.current = null;
      imuReconDebugRef.current = { ua: emptySegDebug(), fa: emptySegDebug() };
      return;
    }

    // imu_01 controls upper arm — required for any reconstruction
    const imu01Raw = getRawIMURef.current('imu_01');
    const imu01Packet = imu01Raw?.latest;
    // Fixed calibration reference quaternion — does NOT change after calibration
    const qCalibUA = calib.upperArm.imuQuaternion;

    if (!imu01Packet || !isValidQuat(packetToQuat(imu01Packet)) || !isValidQuat(qCalibUA)) {
      imuReconPoseRef.current = null;
      imuReconDebugRef.current = { ua: emptySegDebug(), fa: emptySegDebug() };
      return;
    }

    const qCurrentUA = packetToQuat(imu01Packet);
    // ΔQ = Q_current ⊗ Q_calib⁻¹ — rotation from T-pose calibration to current orientation
    const deltaQUA = multiplyQuaternions(qCurrentUA, invertQuaternion(qCalibUA));
    // Rotate calibration T-pose direction by that delta
    const calibDirUA: Vec3 = [
      calib.upperArm.directionNorm.x,
      calib.upperArm.directionNorm.y,
      calib.upperArm.directionNorm.z,
    ];
    const dirCurrentUA = rotateVectorByQuaternion(deltaQUA, calibDirUA);

    // Shoulder anchor: prefer live stereo (keeps arm grounded as person moves),
    // fall back to last-reliable shoulder, then calibration shoulder.
    const anchorShoulder = isValidVec(shoulder)
      ? shoulder!
      : (lastReliableRef.current?.upperArm.shoulder ?? calib.upperArm.shoulderPos);

    const uaLength = calib.upperArm.lengthMm;
    const reconElbow = {
      x: anchorShoulder.x + uaLength * dirCurrentUA[0],
      y: anchorShoulder.y + uaLength * dirCurrentUA[1],
      z: anchorShoulder.z + uaLength * dirCurrentUA[2],
    };

    // imu_02 controls forearm — optional; wrist becomes null if offline
    const imu02Raw = getRawIMURef.current('imu_02');
    const imu02Packet = imu02Raw?.latest;
    // Fixed calibration reference quaternion for forearm
    const qCalibFA = calib.forearm.imuQuaternion;

    let reconWrist: {x:number;y:number;z:number} | null = null;
    let uaDebug: SegmentReconDebug;
    let faDebug: SegmentReconDebug;

    const stereoElbow = pose['rightElbow'];
    const stereoWrist = pose['rightWrist'];

    const reconUADir = { x: dirCurrentUA[0], y: dirCurrentUA[1], z: dirCurrentUA[2] };
    const stereoUADir = (shoulderOk && elbowOk && shoulder && elbow)
      ? normalize3({ x: elbow.x-shoulder.x, y: elbow.y-shoulder.y, z: elbow.z-shoulder.z })
      : null;
    uaDebug = {
      qCurrent:    qCurrentUA,
      qLast:       qCalibUA,    // Fixed calibration reference (not last-reliable)
      qDelta:      deltaQUA,
      dirCurrent:  dirCurrentUA,
      dirLast:     calibDirUA,  // Fixed calibration T-pose direction
      calibLength: uaLength,
      reconPos:    reconElbow,
      stereoPos:   stereoElbow ? { ...stereoElbow } : null,
      posError:    stereoElbow ? dist3D(reconElbow, stereoElbow) : null,
      angError:    stereoUADir ? angleBetweenDeg(reconUADir, stereoUADir) : null,
    };

    if (imu02Packet && isValidQuat(packetToQuat(imu02Packet)) && isValidQuat(qCalibFA)) {
      const qCurrentFA = packetToQuat(imu02Packet);
      const deltaQFA = multiplyQuaternions(qCurrentFA, invertQuaternion(qCalibFA));
      const calibDirFA: Vec3 = [
        calib.forearm.directionNorm.x,
        calib.forearm.directionNorm.y,
        calib.forearm.directionNorm.z,
      ];
      const dirCurrentFA = rotateVectorByQuaternion(deltaQFA, calibDirFA);
      const faLength = calib.forearm.lengthMm;
      reconWrist = {
        x: reconElbow.x + faLength * dirCurrentFA[0],
        y: reconElbow.y + faLength * dirCurrentFA[1],
        z: reconElbow.z + faLength * dirCurrentFA[2],
      };
      const reconFADir = { x: dirCurrentFA[0], y: dirCurrentFA[1], z: dirCurrentFA[2] };
      const stereoFADir = (elbowOk && wristOk && elbow && wrist)
        ? normalize3({ x: wrist.x-elbow.x, y: wrist.y-elbow.y, z: wrist.z-elbow.z })
        : null;
      faDebug = {
        qCurrent:    qCurrentFA,
        qLast:       qCalibFA,    // Fixed calibration reference
        qDelta:      deltaQFA,
        dirCurrent:  dirCurrentFA,
        dirLast:     calibDirFA,  // Fixed calibration T-pose direction
        calibLength: faLength,
        reconPos:    reconWrist,
        stereoPos:   stereoWrist ? { ...stereoWrist } : null,
        posError:    stereoWrist ? dist3D(reconWrist, stereoWrist) : null,
        angError:    stereoFADir ? angleBetweenDeg(reconFADir, stereoFADir) : null,
      };
    } else {
      faDebug = emptySegDebug();
    }

    const imuPose: TriangulatedPose = {
      ...Object.fromEntries(LANDMARK_KEYS.map(k => [k, null])),
      rightShoulder: { ...anchorShoulder },
      rightElbow:    reconElbow,
      rightWrist:    reconWrist,
    } as TriangulatedPose;

    imuReconPoseRef.current  = imuPose;
    imuReconDebugRef.current = { ua: uaDebug, fa: faDebug };
  }, [calibStatus]);

  // Auto-finalize calibration
  useEffect(() => {
    if (calibStatus !== 'collecting' || calibFrames.length < CALIBRATION_FRAMES_NEEDED) return;
    const upperArmLengths = calibFrames.map(f => dist3D(f.shoulder, f.elbow));
    const forearmLengths  = calibFrames.map(f => dist3D(f.elbow,    f.wrist));
    const uaQuat = averageQuaternions(calibFrames.map(f => packetToQuat(f.imu01)));
    const faQuat = averageQuaternions(calibFrames.map(f => packetToQuat(f.imu02)));
    const mid = calibFrames[Math.floor(calibFrames.length / 2)];
    const uaDir = { x: mid.elbow.x-mid.shoulder.x, y: mid.elbow.y-mid.shoulder.y, z: mid.elbow.z-mid.shoulder.z };
    const faDir = { x: mid.wrist.x-mid.elbow.x,    y: mid.wrist.y-mid.elbow.y,    z: mid.wrist.z-mid.elbow.z    };
    const result: ArmCalibration = {
      timestamp:  Date.now(),
      framesUsed: calibFrames.length,
      upperArm: {
        imuQuaternion:  uaQuat,
        imuAccuracy:    mid.imu01.accuracy,
        shoulderPos:    { ...mid.shoulder },
        elbowPos:       { ...mid.elbow },
        direction:      uaDir,
        directionNorm:  normalize3(uaDir),
        lengthMm:       median(upperArmLengths),
        lengthStdDevMm: stddev(upperArmLengths),
      },
      forearm: {
        imuQuaternion:  faQuat,
        imuAccuracy:    mid.imu02.accuracy,
        elbowPos:       { ...mid.elbow },
        wristPos:       { ...mid.wrist },
        direction:      faDir,
        directionNorm:  normalize3(faDir),
        lengthMm:       median(forearmLengths),
        lengthStdDevMm: stddev(forearmLengths),
      },
    };
    setArmCalibration(result);
    setCalibStatus('done');
    console.info('[IMU CALIB] Calibration complete', result);
  }, [calibStatus, calibFrames]);

  // ── Calibration conditions ────────────────────────────────────────────────────
  const imu01Online = imuStates['imu_01']?.health === 'online';
  const imu02Online = imuStates['imu_02']?.health === 'online';
  const rightArmVisible = !!(
    displayPose['rightShoulder'] && displayPose['rightElbow'] && displayPose['rightWrist']
  );
  const stereoReliable = trackedCountRef.current >= 3;
  const canCalibrate = imu01Online && imu02Online && rightArmVisible && stereoReliable && bothCamerasActive;

  const startCalibration = useCallback(() => {
    calibFramesRef.current = [];
    setCalibFrames([]);
    // Reset the reliable-vision reference so posVelocityOk starts true on the first
    // T-pose frame. Without this, moving the arm > 120mm into T-pose deadlocks the
    // velocity gate because lastReliableRef still points at the pre-calibration position.
    lastReliableRef.current = null;
    setCalibStatus('collecting');
  }, []);

  const clearCalibration = useCallback(() => {
    calibFramesRef.current = [];
    setCalibFrames([]);
    setArmCalibration(null);
    setCalibStatus('idle');
    imuReconPoseRef.current = null;
    imuReconDebugRef.current = { ua: emptySegDebug(), fa: emptySegDebug() };
  }, []);

  // ── Validation arms ───────────────────────────────────────────────────────────
  const stereoArm: ArmPoints = {
    shoulder: displayPose['rightShoulder'] ?? null,
    elbow:    displayPose['rightElbow']    ?? null,
    wrist:    displayPose['rightWrist']    ?? null,
  };
  const validationArm: ArmPoints = imuReconPose ? {
    shoulder: imuReconPose['rightShoulder'] ?? null,
    elbow:    imuReconPose['rightElbow']    ?? null,
    wrist:    imuReconPose['rightWrist']    ?? null,
  } : stereoArm;

  // ── Error metrics ─────────────────────────────────────────────────────────────
  const elbowError = imuReconDebug?.ua.posError ?? null;
  const wristError = imuReconDebug?.fa.posError ?? null;
  const avgError   = (elbowError !== null && wristError !== null) ? (elbowError + wristError) / 2 : null;
  const maxError   = (elbowError !== null && wristError !== null) ? Math.max(elbowError, wristError) : null;
  const rmse       = (elbowError !== null && wristError !== null)
    ? Math.sqrt((elbowError**2 + wristError**2) / 2) : null;
  const uaAngError = imuReconDebug?.ua.angError ?? null;
  const faAngError = imuReconDebug?.fa.angError ?? null;

  // ── Helpers for inline debug display ─────────────────────────────────────────
  function QuatDebugRow({ label, q }: { label: string; q: Quaternion | null }) {
    const euler = q ? quaternionToEuler(q) : null;
    return (
      <>
        <div className="flex items-start gap-2">
          <span className="text-gray-500 shrink-0 w-28">{label} [quat]</span>
          <span className="text-blue-300 font-mono">
            {q ? `${fmtQ(q[0])}  ${fmtQ(q[1])}  ${fmtQ(q[2])}  ${fmtQ(q[3])}` : '—'}
          </span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-gray-500 shrink-0 w-28">{label} [euler]</span>
          <span className="text-blue-300 font-mono italic">
            {euler ? `Y${fmtDeg(euler.yawDeg)} P${fmtDeg(euler.pitchDeg)} R${fmtDeg(euler.rollDeg)}` : '—'}
          </span>
        </div>
      </>
    );
  }

  function SegmentDebugSection({ label, d, color }: { label: string; d: SegmentReconDebug; color: string }) {
    const fmt3 = (v: Vec3 | null) =>
      v ? `${v[0].toFixed(4)}  ${v[1].toFixed(4)}  ${v[2].toFixed(4)}` : '—';
    const fmtVec = (v: {x:number;y:number;z:number} | null) =>
      v ? `x${v.x.toFixed(1)} y${v.y.toFixed(1)} z${v.z.toFixed(1)}` : '—';
    const rows: [string, string][] = [
      ['q current',   d.qCurrent ? d.qCurrent.map(fmtQ).join('  ') : '—'],
      ['q calib ref', d.qLast    ? d.qLast.map(fmtQ).join('  ')    : '—'],
      ['q delta',     d.qDelta   ? d.qDelta.map(fmtQ).join('  ')   : '—'],
      ['dir current', fmt3(d.dirCurrent)],
      ['dir calib',   fmt3(d.dirLast)],
      ['calib length',d.calibLength !== null ? `${d.calibLength.toFixed(1)} mm` : '—'],
      ['recon pos',   fmtVec(d.reconPos)],
      ['stereo pos',  fmtVec(d.stereoPos)],
      ['pos error',   fmtMm(d.posError)],
      ['ang error',   d.angError !== null ? fmtDeg(d.angError) : '—'],
    ];
    return (
      <div>
        <p className="text-gray-500 font-semibold uppercase tracking-wide mb-2">{label}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
          {rows.map(([lbl, val]) => (
            <div key={lbl} className="flex items-start gap-2">
              <span className="text-gray-500 shrink-0 w-28">{lbl}</span>
              <span className={`${color} font-mono`}>{val}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold">3D Failure Correction + IMU</h1>
            <Badge className={imuConnected ? 'bg-green-700' : 'bg-red-900 text-red-300'}>
              {imuConnected ? <><Wifi className="h-3 w-3 mr-1" />IMU Connected</> : <><WifiOff className="h-3 w-3 mr-1" />IMU Offline</>}
            </Badge>
            {imuReconPose && (
              <Badge className="bg-orange-700">IMU Recon Active</Badge>
            )}
            {freezeReference && (
              <Badge className="bg-amber-700 flex items-center gap-1">
                <Snowflake className="h-3 w-3" />Vision Frozen
              </Badge>
            )}
          </div>
          <p className="text-gray-400 text-sm mt-1">
            Phase B · Corrected stereo vs IMU reconstruction · native quaternion forward kinematics
          </p>
        </div>

        {cameraError && (
          <Card className="bg-red-900/20 border-red-700 p-4 mb-6">
            <div className="flex items-start">
              <AlertCircle className="h-5 w-5 text-red-500 mr-2 mt-0.5" />
              <div className="text-red-200">{cameraError}</div>
            </div>
          </Card>
        )}

        {/*
          Processing videos must NOT be display:none — requestVideoFrameCallback
          does not fire on hidden elements, so MediaPipe would never receive frames.
          Off-screen fixed positioning keeps them out of view while preserving rVFC.
        */}
        <div
          aria-hidden="true"
          style={{ position: 'fixed', left: '-9999px', top: 0, width: 1, height: 1, overflow: 'hidden', pointerEvents: 'none' }}
        >
          <video ref={camera1Ref} autoPlay playsInline muted style={{ width: 1, height: 1 }} />
          <video ref={camera2Ref} autoPlay playsInline muted style={{ width: 1, height: 1 }} />
        </div>

        <Tabs value={activeInnerTab} onValueChange={setActiveInnerTab} className="w-full">
          <TabsList className="bg-gray-800 mb-6 flex-wrap h-auto gap-1">
            <TabsTrigger value="cameras">Camera Setup</TabsTrigger>
            <TabsTrigger value="calibration">Calibration</TabsTrigger>
            <TabsTrigger value="reconstruction">Reconstruction + Correction</TabsTrigger>
            <TabsTrigger value="imu" className="data-[state=active]:bg-blue-900">
              <Activity className="h-3.5 w-3.5 mr-1.5" />IMU
            </TabsTrigger>
            <TabsTrigger value="video-record">Video Recording</TabsTrigger>
            <TabsTrigger value="playback">Playback</TabsTrigger>
          </TabsList>

          {/* ── Camera Setup ─────────────────────────────────────────── */}
          <TabsContent value="cameras" className="space-y-6">
            <Card className="bg-gray-900 border-gray-700 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Video className="h-5 w-5 text-blue-400" />
                  <div>
                    <h3 className="font-semibold text-white">
                      {availableCameras.length === 0 && 'No cameras detected'}
                      {availableCameras.length === 1 && '1 camera detected'}
                      {availableCameras.length >= 2 && `${availableCameras.length} cameras detected`}
                    </h3>
                    <p className="text-sm text-gray-400">
                      {availableCameras.length >= 2 ? 'Ready for stereo capture' : 'Need 2 cameras for stereo vision'}
                    </p>
                  </div>
                </div>
                <Button onClick={enumerateCameras} variant="outline" size="sm" className="border-gray-600">
                  <RefreshCw className="h-4 w-4 mr-2" /> Refresh
                </Button>
              </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {([
                { cam: 1, active: isCamera1Active, selected: selectedCamera1, setSelected: setSelectedCamera1, otherSelected: selectedCamera2, start: startCamera1, stop: stopCamera1 },
                { cam: 2, active: isCamera2Active, selected: selectedCamera2, setSelected: setSelectedCamera2, otherSelected: selectedCamera1, start: startCamera2, stop: stopCamera2 },
              ] as const).map(({ cam, active, selected, setSelected, otherSelected, start, stop }) => (
                <Card key={cam} className="bg-gray-900 border-gray-700 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Camera {cam}</h3>
                    <Badge className={active ? 'bg-green-600' : 'bg-gray-600'}>{active ? 'Active' : 'Inactive'}</Badge>
                  </div>
                  <div className="space-y-4">
                    <Select value={selected} onValueChange={setSelected} disabled={active || availableCameras.length === 0}>
                      <SelectTrigger className="bg-gray-800 border-gray-700">
                        <SelectValue placeholder={availableCameras.length === 0 ? 'No cameras detected' : 'Select camera...'} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCameras.filter(c => c.deviceId !== otherSelected).map(c => (
                          <SelectItem key={c.deviceId} value={c.deviceId}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!active ? (
                      <Button onClick={() => selected && start(selected)} disabled={!selected} className="w-full bg-blue-600 hover:bg-blue-700">
                        <Video className="h-4 w-4 mr-2" /> Start Camera
                      </Button>
                    ) : (
                      <Button onClick={stop} variant="destructive" className="w-full">
                        <VideoOff className="h-4 w-4 mr-2" /> Stop Camera
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {([
                { label: 'Camera 1 Feed', stream: camera1Stream },
                { label: 'Camera 2 Feed', stream: camera2Stream },
              ] as const).map(({ label, stream }) => (
                <Card key={label} className="bg-gray-900 border-gray-700 p-4">
                  <h4 className="font-semibold mb-3">{label}</h4>
                  <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                    <video ref={el => { if (el && el.srcObject !== stream) el.srcObject = stream; }}
                      autoPlay playsInline muted className="w-full h-full object-contain" />
                    {!stream && (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
                        {label.replace(' Feed','')} not active
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>

            {bothCamerasActive && (
              <Card className="bg-green-900/20 border-green-700 p-4">
                <div className="flex items-center text-green-300 text-sm">
                  <Video className="h-4 w-4 mr-2" />
                  Both cameras active — head to the Calibration tab.
                </div>
              </Card>
            )}
          </TabsContent>

          {/* ── Stereo Calibration ──────────────────────────────────── */}
          <TabsContent value="calibration">
            <CalibrationView
              camera1Stream={camera1Stream}
              camera2Stream={camera2Stream}
              camera1Ref={camera1Ref}
              camera2Ref={camera2Ref}
              isBothCamerasActive={bothCamerasActive}
            />
          </TabsContent>

          {/*
            forceMount keeps IMUReconstructionView mounted while other tabs are active.
            hidden hides it visually. The stereo/MediaPipe pipeline keeps running,
            so onCorrectedPose fires and IMU reconstruction updates continuously.
          */}
          <TabsContent
            value="reconstruction"
            forceMount
            className={activeInnerTab === 'reconstruction' ? '' : 'hidden'}
          >
            <IMUReconstructionView
              camera1Ref={camera1Ref}
              camera2Ref={camera2Ref}
              camera1Stream={camera1Stream}
              camera2Stream={camera2Stream}
              isBothCamerasActive={bothCamerasActive}
              preloadedCalibration={calibrationResult}
              onCorrectedPose={onCorrectedPose}
              imuReconstructionPose={imuReconPose}
            />
          </TabsContent>

          {/* ── IMU ─────────────────────────────────────────────────── */}
          <TabsContent value="imu" className="space-y-6">

            {/* Connection + Freeze Reference */}
            <Card className="bg-gray-900 border-gray-700 p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  {imuConnected
                    ? <Wifi className="h-5 w-5 text-green-400" />
                    : <WifiOff className="h-5 w-5 text-red-400" />}
                  <div>
                    <h3 className="font-semibold text-white">
                      {imuConnected ? 'IMU WebSocket Connected' : 'IMU WebSocket Disconnected'}
                    </h3>
                    <p className="text-xs text-gray-400">ws://localhost:8765 · native BNO085 quaternion</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => setFreezeReference(v => !v)}
                    variant={freezeReference ? 'default' : 'outline'}
                    size="sm"
                    className={freezeReference
                      ? 'bg-amber-700 hover:bg-amber-600 text-white border-amber-600'
                      : 'border-gray-600 text-gray-300'}
                  >
                    <Snowflake className="h-3.5 w-3.5 mr-1.5" />
                    {freezeReference ? 'Resume Vision Reference' : 'Freeze Vision Reference'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={reconnectIMU} className="border-gray-600">
                    <RefreshCw className="h-4 w-4 mr-2" /> Reconnect
                  </Button>
                </div>
              </div>
              {freezeReference && (
                <div className="mt-3 p-2 bg-amber-900/20 border border-amber-800 rounded text-xs text-amber-300">
                  Vision reference is frozen. IMU reconstruction continues updating from the frozen anchor.
                  Use this to validate IMU tracking without physically blocking the cameras.
                </div>
              )}
            </Card>

            {/* IMU Health Panel */}
            <Card className="bg-gray-900 border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-white mb-3">IMU Health Monitor</h3>
              <p className="text-xs text-gray-600 mb-3">
                Quaternion = raw normalized BNO085 output. Yaw/Pitch/Roll = derived for display only (Z-Y-X).
              </p>
              <IMUHealthPanel imuStates={imuStates} />
            </Card>

            {/* Right Arm Calibration */}
            <Card className="bg-gray-900 border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-white mb-4">Right Arm Calibration</h3>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
                {[
                  { label: 'Right shoulder visible', ok: !!displayPose['rightShoulder'] },
                  { label: 'Right elbow visible',    ok: !!displayPose['rightElbow'] },
                  { label: 'Right wrist visible',    ok: !!displayPose['rightWrist'] },
                  { label: 'imu_01 online',          ok: imu01Online },
                  { label: 'imu_02 online',          ok: imu02Online },
                  { label: 'Stereo reliable',         ok: stereoReliable },
                ].map(({ label, ok }) => (
                  <div key={label} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded border
                    ${ok ? 'border-green-800 bg-green-900/20 text-green-300' : 'border-gray-700 bg-gray-800/50 text-gray-500'}`}>
                    <div className={`h-2 w-2 rounded-full flex-shrink-0 ${ok ? 'bg-green-400' : 'bg-gray-600'}`} />
                    {label}
                  </div>
                ))}
              </div>

              {calibStatus === 'collecting' && (
                <div className="mb-4 p-3 bg-blue-900/20 border border-blue-800 rounded">
                  <p className="text-sm text-blue-300 font-semibold mb-1">Hold T-Pose</p>
                  <p className="text-xs text-blue-400 mb-2">Stand with arms straight out, palms down. Keep still.</p>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex-1 bg-gray-800 rounded-full h-2">
                      <div className="bg-blue-500 h-2 rounded-full transition-all"
                        style={{ width: `${Math.min(100, (calibFrames.length / CALIBRATION_FRAMES_NEEDED) * 100)}%` }} />
                    </div>
                    <span className="text-xs text-blue-300 tabular-nums">
                      {calibFrames.length} / {CALIBRATION_FRAMES_NEEDED}
                    </span>
                  </div>
                  {calibCondDebug && calibFrames.length === 0 && (
                    <div className="border-t border-blue-800/50 pt-2 mt-1">
                      <p className="text-xs text-blue-400 mb-1.5 font-medium">Per-frame conditions — why frames aren't collecting:</p>
                      <div className="grid grid-cols-2 gap-1">
                        {[
                          { label: 'Shoulder valid',    ok: calibCondDebug.shoulderOk },
                          { label: 'Elbow valid',       ok: calibCondDebug.elbowOk },
                          { label: 'Wrist valid',       ok: calibCondDebug.wristOk },
                          { label: `Joints tracked ≥ 3 (now: ${calibCondDebug.tracked})`, ok: calibCondDebug.tracked >= 3 },
                          { label: `Seg lengths OK  UA:${calibCondDebug.uaLenMm.toFixed(0)} FA:${calibCondDebug.faLenMm.toFixed(0)} mm`, ok: calibCondDebug.segOk },
                          { label: 'No heavy jitter (light jitter OK)', ok: calibCondDebug.armCalibOk },
                          { label: 'Arm velocity OK (< 120 mm/frame)', ok: calibCondDebug.posVelocityOk },
                          { label: `IMU-01 fresh  (${calibCondDebug.imu01AgeMs} ms)`, ok: calibCondDebug.imu01Fresh },
                          { label: `IMU-02 fresh  (${calibCondDebug.imu02AgeMs} ms)`, ok: calibCondDebug.imu02Fresh },
                        ].map(({ label, ok }) => (
                          <div key={label} className={`flex items-center gap-1.5 text-xs px-1.5 py-1 rounded
                            ${ok ? 'text-green-400' : 'text-red-400'}`}>
                            <span className="shrink-0 font-bold">{ok ? '✓' : '✗'}</span>
                            <span className="leading-tight font-mono">{label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {armCalibration && (() => {
                const ua = armCalibration.upperArm;
                const fa = armCalibration.forearm;
                const stddevBad  = ua.lengthStdDevMm > 15 || fa.lengthStdDevMm > 15;
                const stddevWarn = ua.lengthStdDevMm > 5  || fa.lengthStdDevMm > 5;
                const accBad     = ua.imuAccuracy === 0 || fa.imuAccuracy === 0;
                const accWarn    = ua.imuAccuracy === 1 || fa.imuAccuracy === 1;
                const quality: 'good' | 'warning' | 'failed' =
                  stddevBad || accBad ? 'failed' : stddevWarn || accWarn ? 'warning' : 'good';
                const qs = {
                  good:    { border: 'border-green-700',  bg: 'bg-green-900/20',  badge: 'bg-green-700', text: 'text-green-300' },
                  warning: { border: 'border-yellow-700', bg: 'bg-yellow-900/20', badge: 'bg-yellow-700',text: 'text-yellow-300' },
                  failed:  { border: 'border-red-700',    bg: 'bg-red-900/20',    badge: 'bg-red-800',   text: 'text-red-300' },
                }[quality];
                const fmtLen = (mm: number) => `${(mm / 10).toFixed(1)} cm  (${mm.toFixed(1)} mm)`;
                const fmtStd = (mm: number) => `±${mm.toFixed(2)} mm`;
                const accLabel = ['Unreliable', 'Low', 'Medium', 'High'];
                const uaEuler = quaternionToEuler(ua.imuQuaternion);
                const faEuler = quaternionToEuler(fa.imuQuaternion);
                return (
                  <div className={`mb-4 p-4 ${qs.bg} border ${qs.border} rounded-lg`}>
                    <div className="flex items-center justify-between mb-3">
                      <p className={`text-sm font-semibold ${qs.text}`}>Calibration Results</p>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold text-white ${qs.badge}`}>
                          {quality === 'good' ? 'GOOD' : quality === 'warning' ? 'WARNING' : 'FAILED'}
                        </span>
                        <span className="text-xs text-gray-500">{new Date(armCalibration.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      {[
                        { label: 'Upper Arm (imu_01)', acc: ua.imuAccuracy, stdDev: ua.lengthStdDevMm, len: ua.lengthMm, quat: ua.imuQuaternion, euler: uaEuler },
                        { label: 'Forearm (imu_02)',   acc: fa.imuAccuracy, stdDev: fa.lengthStdDevMm, len: fa.lengthMm, quat: fa.imuQuaternion, euler: faEuler },
                      ].map(({ label, acc, stdDev, len, quat, euler }) => (
                        <div key={label} className="space-y-1.5">
                          <p className="text-gray-400 font-semibold uppercase tracking-wide text-xs mb-2">{label}</p>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Length</span>
                            <span className="tabular-nums text-white font-mono">{fmtLen(len)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Std Dev</span>
                            <span className={`tabular-nums font-mono ${stdDev > 10 ? 'text-red-400' : stdDev > 5 ? 'text-yellow-400' : 'text-green-400'}`}>
                              {fmtStd(stdDev)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">IMU Accuracy</span>
                            <span className={`font-semibold ${acc >= 2 ? 'text-green-400' : acc === 1 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {accLabel[Math.min(3, acc)]}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-gray-500 shrink-0">Quaternion</span>
                            <span className="tabular-nums text-gray-300 font-mono text-right text-xs">
                              {quat.map(v => v.toFixed(4)).join('  ')}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Derived orient.</span>
                            <span className="tabular-nums text-gray-400 font-mono text-xs">
                              Y{euler.yawDeg.toFixed(1)}° P{euler.pitchDeg.toFixed(1)}° R{euler.rollDeg.toFixed(1)}°
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-700 flex gap-6 text-xs text-gray-500">
                      <span>Frames used: <span className="text-gray-300">{armCalibration.framesUsed}</span></span>
                      <span>Status: <span className={qs.text}>{quality.toUpperCase()}</span></span>
                      {quality === 'warning' && (
                        <span className="text-yellow-500">
                          {stddevWarn && !stddevBad ? 'High variability — consider recalibrating. ' : ''}
                          {accWarn && !accBad ? 'Low IMU accuracy — move away from metal/magnets.' : ''}
                        </span>
                      )}
                      {quality === 'failed' && (
                        <span className="text-red-400">
                          {stddevBad ? 'Stereo noise too high — check calibration and camera stability. ' : ''}
                          {accBad ? 'IMU accuracy = Unreliable — sensor not calibrated.' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="flex gap-2">
                <Button onClick={startCalibration} disabled={!canCalibrate || calibStatus === 'collecting'}
                  className="bg-blue-700 hover:bg-blue-600 text-sm"
                  title={!canCalibrate ? 'All conditions must be met' : undefined}>
                  {calibStatus === 'collecting' ? 'Collecting...' : 'Calibrate Right Arm'}
                </Button>
                <Button variant="outline" onClick={clearCalibration}
                  className="border-gray-600 text-gray-300 hover:bg-red-900/20 text-sm">
                  Clear Calibration
                </Button>
              </div>
            </Card>

            {/* Dual-Skeleton Validation */}
            <Card className="bg-gray-900 border-gray-700 p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-white">Dual-Skeleton Validation</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Corrected stereo (green) vs IMU reconstruction (orange). Goal: overlap while arm is visible.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowValidation(v => !v)}
                  className={`border-gray-600 text-sm ${showValidation ? 'bg-blue-900/30 border-blue-700 text-blue-300' : 'text-gray-300'}`}>
                  {showValidation ? 'Hide' : 'Show'} Overlay
                </Button>
              </div>

              {showValidation && (
                <>
                  <div className="bg-gray-950 rounded-lg border border-gray-800 flex items-center justify-center mb-4" style={{ height: 280 }}>
                    <DualArmValidationSVG stereo={stereoArm} validation={validationArm} width={720} height={260} />
                  </div>

                  {/* Position error metrics */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
                    {[
                      { label: 'Elbow Error',   value: fmtMm(elbowError) },
                      { label: 'Wrist Error',   value: fmtMm(wristError) },
                      { label: 'Avg Error',     value: fmtMm(avgError) },
                      { label: 'Max Error',     value: fmtMm(maxError) },
                      { label: 'RMSE',          value: fmtMm(rmse) },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-xs text-gray-500 mb-1">{label}</div>
                        <div className="text-sm font-mono font-semibold text-green-400">{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Angular error metrics */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Upper Arm Angular Error', value: uaAngError !== null ? fmtDeg(uaAngError) : '—' },
                      { label: 'Forearm Angular Error',   value: faAngError !== null ? fmtDeg(faAngError) : '—' },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-xs text-gray-500 mb-1">{label}</div>
                        <div className="text-sm font-mono font-semibold text-blue-400">{value}</div>
                        <div className="text-xs text-gray-600 mt-0.5">stereo dir vs IMU dir</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>

            {/* Debug Panel */}
            <Card className="bg-gray-900 border-gray-700 p-4">
              <button className="flex items-center gap-2 w-full text-left" onClick={() => setShowDebug(v => !v)}>
                <span className="text-sm font-semibold text-white">Debug Panel</span>
                {showDebug ? <ChevronUp className="h-4 w-4 text-gray-400 ml-auto" /> : <ChevronDown className="h-4 w-4 text-gray-400 ml-auto" />}
              </button>

              {showDebug && (
                <div className="mt-4 space-y-5 text-xs">

                  {/* Live state */}
                  <div>
                    <p className="text-gray-500 font-semibold uppercase tracking-wide mb-2">Live State</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-1.5">
                      {([
                        ['Calibration status', calibStatus],
                        ['Frames collected',   String(calibFrames.length)],
                        ['Joints tracked',     String(trackedCountRef.current)],
                        ['IMU connected',      String(imuConnected)],
                        ['imu_01 status',      imuStates['imu_01']?.health ?? '—'],
                        ['imu_02 status',      imuStates['imu_02']?.health ?? '—'],
                        ['IMU recon active',   imuReconPose ? 'yes' : 'no'],
                        ['Vision frozen',      String(freezeReference)],
                        ['Active tab',         activeInnerTab],
                        ['Last reliable',      lastReliable ? new Date(lastReliable.timestamp).toLocaleTimeString() : 'Never'],
                      ] as [string, string][]).map(([label, value]) => (
                        <div key={label} className="flex items-start gap-2">
                          <span className="text-gray-500 shrink-0 w-36">{label}</span>
                          <span className="text-gray-300 font-mono">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Current stereo positions */}
                  <div>
                    <p className="text-gray-500 font-semibold uppercase tracking-wide mb-2">Current Corrected Stereo Positions (mm)</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-1.5">
                      {([
                        ['Right shoulder', displayPose['rightShoulder']],
                        ['Right elbow',    displayPose['rightElbow']],
                        ['Right wrist',    displayPose['rightWrist']],
                      ] as [string, {x:number;y:number;z:number}|null|undefined][]).map(([label, pt]) => (
                        <div key={label} className="flex items-start gap-2">
                          <span className="text-gray-500 shrink-0 w-28">{label}</span>
                          <span className="text-gray-300 font-mono">
                            {pt ? `x${pt.x.toFixed(1)}  y${pt.y.toFixed(1)}  z${pt.z.toFixed(1)}` : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Live IMU quaternions */}
                  <div>
                    <p className="text-gray-500 font-semibold uppercase tracking-wide mb-1">Live IMU — Raw Quaternion</p>
                    <p className="text-gray-600 italic mb-2">Normalized native BNO085 output. Do not use Euler values for reconstruction math.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
                      {(['imu_01', 'imu_02'] as const).flatMap(id => {
                        const p = imuStates[id]?.latest;
                        const q: Quaternion | null = p ? [p.qw, p.qx, p.qy, p.qz] : null;
                        return [
                          <div key={`${id}-quat`} className="flex items-start gap-2">
                            <span className="text-gray-500 shrink-0 w-28">{id} quat</span>
                            <span className="text-gray-300 font-mono">
                              {q ? `w${fmtQ(q[0])} x${fmtQ(q[1])} y${fmtQ(q[2])} z${fmtQ(q[3])}` : '—'}
                            </span>
                          </div>,
                          <div key={`${id}-euler`} className="flex items-start gap-2">
                            <span className="text-gray-500 shrink-0 w-28">{id} euler</span>
                            <span className="text-gray-400 font-mono italic">
                              {q ? (() => { const e = quaternionToEuler(q); return `Y${fmtDeg(e.yawDeg)} P${fmtDeg(e.pitchDeg)} R${fmtDeg(e.rollDeg)}`; })() : '—'}
                            </span>
                          </div>,
                        ];
                      })}
                    </div>
                  </div>

                  {/* Reconstruction internals */}
                  {imuReconDebug && (
                    <>
                      <SegmentDebugSection label="IMU Reconstruction — Upper Arm (imu_01)" d={imuReconDebug.ua} color="text-orange-300" />
                      <SegmentDebugSection label="IMU Reconstruction — Forearm (imu_02)" d={imuReconDebug.fa} color="text-orange-300" />
                    </>
                  )}

                  {/* Stored calibration data */}
                  {armCalibration ? (
                    <>
                      <div>
                        <p className="text-gray-500 font-semibold uppercase tracking-wide mb-1">
                          Stored Calibration — Fixed IMU Reference Quaternions
                        </p>
                        <p className="text-gray-600 italic mb-2">
                          Averaged over {armCalibration.framesUsed} T-pose frames. Used as the fixed orientation
                          origin for all runtime IMU reconstruction — never updated after calibration.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
                          <QuatDebugRow label="imu_01 (UA)" q={armCalibration.upperArm.imuQuaternion} />
                          <QuatDebugRow label="imu_02 (FA)" q={armCalibration.forearm.imuQuaternion} />
                        </div>
                      </div>

                      <div>
                        <p className="text-gray-500 font-semibold uppercase tracking-wide mb-2">
                          Stored Calibration — Stereo Positions (mm)
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-1.5">
                          {([
                            ['Shoulder',    armCalibration.upperArm.shoulderPos],
                            ['Elbow (UA)',  armCalibration.upperArm.elbowPos],
                            ['Elbow (FA)',  armCalibration.forearm.elbowPos],
                            ['Wrist',       armCalibration.forearm.wristPos],
                          ] as [string, {x:number;y:number;z:number}][]).map(([label, pt]) => (
                            <div key={label} className="flex items-start gap-2">
                              <span className="text-gray-500 shrink-0 w-28">{label}</span>
                              <span className="text-blue-300 font-mono">
                                x{pt.x.toFixed(1)}  y{pt.y.toFixed(1)}  z{pt.z.toFixed(1)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-gray-500 font-semibold uppercase tracking-wide mb-2">Stored Calibration — Segment Lengths</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-1.5">
                          {([
                            ['Upper arm', `${armCalibration.upperArm.lengthMm.toFixed(2)} mm`],
                            ['UA std dev', `±${armCalibration.upperArm.lengthStdDevMm.toFixed(2)} mm`],
                            ['Forearm',   `${armCalibration.forearm.lengthMm.toFixed(2)} mm`],
                            ['FA std dev', `±${armCalibration.forearm.lengthStdDevMm.toFixed(2)} mm`],
                          ] as [string, string][]).map(([label, value]) => (
                            <div key={label} className="flex items-start gap-2">
                              <span className="text-gray-500 shrink-0 w-28">{label}</span>
                              <span className="text-blue-300 font-mono">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-gray-600 italic">No calibration stored yet — run calibration first.</p>
                  )}
                </div>
              )}
            </Card>
          </TabsContent>

          {/* ── Video Recording ─────────────────────────────────────── */}
          <TabsContent value="video-record" className="space-y-6">
            <Card className="bg-gray-900 border-gray-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">Synchronized Dual-Camera Recording</h3>
                  <p className="text-sm text-gray-400 mt-1">Records raw video from both cameras simultaneously.</p>
                </div>
                {isVideoRecording && (
                  <div className="flex items-center gap-2 text-red-400 font-mono text-sm">
                    <Circle className="h-3 w-3 fill-red-500 text-red-500 animate-pulse" />
                    {formatVideoDuration(videoRecordingMs)}
                  </div>
                )}
              </div>

              {videoRecordError && (
                <div className="flex items-center gap-2 text-red-400 text-sm mb-4 p-3 bg-red-900/20 rounded border border-red-800">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {videoRecordError}
                </div>
              )}

              {!bothCamerasActive && (
                <div className="p-3 bg-yellow-900/20 border border-yellow-700 rounded text-yellow-300 text-sm mb-4">
                  Both cameras must be active before recording.
                </div>
              )}

              <div className="flex gap-3">
                {!isVideoRecording ? (
                  <Button onClick={startVideoRecording} disabled={!bothCamerasActive}
                    className="bg-red-600 hover:bg-red-700 text-white">
                    <Circle className="h-4 w-4 mr-2 fill-white" /> Start Recording
                  </Button>
                ) : (
                  <Button onClick={stopVideoRecording} className="bg-gray-600 hover:bg-gray-700 text-white">
                    <Square className="h-4 w-4 mr-2 fill-white" /> Stop Recording
                  </Button>
                )}
              </div>
            </Card>

            {videoRecordings.length > 0 && (
              <Card className="bg-gray-900 border-gray-700 p-6">
                <h3 className="text-lg font-semibold mb-4">Recordings</h3>
                <div className="space-y-3">
                  {videoRecordings.map(rec => (
                    <div key={rec.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                      <div>
                        <p className="font-medium text-sm text-white">{rec.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {Math.round(rec.duration/1000)}s · Cam1: {(rec.cam1Blob.size/1e6).toFixed(1)} MB · Cam2: {(rec.cam2Blob.size/1e6).toFixed(1)} MB
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="border-gray-600 text-gray-300 hover:text-white"
                          onClick={() => downloadVideoRecording(rec)}>
                          <Download className="h-4 w-4 mr-1" /> Download Both
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => deleteVideoRecording(rec.id)}>Delete</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {videoRecordings.length === 0 && !isVideoRecording && (
              <div className="text-center text-gray-500 py-12 text-sm">
                No recordings yet. Start both cameras and press Record.
              </div>
            )}
          </TabsContent>

          {/* ── Playback ────────────────────────────────────────────── */}
          <TabsContent value="playback">
            <FailureCorrectionPlayback calibration={calibrationResult} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
