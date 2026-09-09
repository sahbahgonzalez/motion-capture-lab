/**
 * IMULabView — Phase C
 *
 * "3D Failure Correction + IMU" tab.
 *
 * Phase C replaces the 2-pose ΔQ relative reconstruction with a 4-pose
 * sensor-to-bone absolute reconstruction:
 *
 *   CALIBRATION (4 poses):
 *     Each pose provides observed stereo bone directions + IMU quaternions.
 *     For every frame: boneLocalDir = rotate(inv(q_imu), stereoDir_world)
 *     All observations averaged → fixed sensor-frame bone direction per IMU.
 *
 *   RUNTIME:
 *     worldDir_UA = rotate(q_imu01_current, uaBoneLocalDir)
 *     elbow = shoulder + uaLength × worldDir_UA
 *     worldDir_FA = rotate(q_imu02_current, faBoneLocalDir)
 *     wrist = elbow + faLength × worldDir_FA
 *
 *   No ΔQ. No hinge axis. No LastReliableVision for orientation.
 *   Shoulder live stereo position is the only positional anchor.
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
  rotateVectorByQuaternion,
} from '../utils/quaternionUtils';
import {
  Video, VideoOff, AlertCircle, RefreshCw, Circle, Square, Download,
  Wifi, WifiOff, Activity, ChevronDown, ChevronUp,
} from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────

const RAD2DEG = 180 / Math.PI;
const CALIBRATION_FRAMES_NEEDED = 45;
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

/**
 * Average directional unit vectors (bone directions, NOT quaternions).
 * Bone directions such as shoulder→elbow are signed — v and -v are NOT equivalent.
 * Uses a two-pass approach: raw mean → outlier rejection (>45° from mean) → refined mean.
 * Returns null when observations conflict (mean magnitude near zero) — callers must
 * NOT invent a fallback direction; treat null as a calibration failure.
 */
function averageVec3Simple(vecs: {x:number;y:number;z:number}[], outlierDeg = 45): Vec3 | null {
  if (vecs.length === 0) return null;
  // First pass: raw sum
  let sx = 0, sy = 0, sz = 0;
  for (const v of vecs) { sx += v.x; sy += v.y; sz += v.z; }
  const len0 = Math.sqrt(sx*sx + sy*sy + sz*sz);
  if (len0 < 1e-4 * vecs.length) return null; // conflicting observations
  const rawMean = { x: sx/len0, y: sy/len0, z: sz/len0 };
  // Second pass: discard outliers and recompute
  let ox = 0, oy = 0, oz = 0, cnt = 0;
  for (const v of vecs) {
    if (angleBetweenDeg(v, rawMean) < outlierDeg) {
      ox += v.x; oy += v.y; oz += v.z; cnt++;
    }
  }
  if (cnt === 0) return null;
  const n = normalize3({ x: ox, y: oy, z: oz });
  return [n.x, n.y, n.z];
}

const STABILITY_WINDOW = 10;
const STABILITY_ANGLE_SPREAD_DEG = 15;
const STABILITY_LENGTH_STDDEV_MM = 20;

function angularSpreadDeg(dirs: Array<{x:number;y:number;z:number}>): number {
  if (dirs.length < 2) return 0;
  let maxSpread = 0;
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      maxSpread = Math.max(maxSpread, angleBetweenDeg(dirs[i], dirs[j]));
    }
  }
  return maxSpread;
}

function getArmStabilityMetrics(
  buf: Array<{shoulder:{x:number;y:number;z:number}; elbow:{x:number;y:number;z:number}; wrist:{x:number;y:number;z:number}}>,
): {
  uaAngularSpreadDeg: number;
  faAngularSpreadDeg: number;
  uaLengthStdDevMm: number;
  faLengthStdDevMm: number;
  isStable: boolean;
} {
  const uaDirs = buf.map(b => normalize3({
    x: b.elbow.x - b.shoulder.x,
    y: b.elbow.y - b.shoulder.y,
    z: b.elbow.z - b.shoulder.z,
  }));
  const faDirs = buf.map(b => normalize3({
    x: b.wrist.x - b.elbow.x,
    y: b.wrist.y - b.elbow.y,
    z: b.wrist.z - b.elbow.z,
  }));
  const uaLens = buf.map(b => dist3D(b.shoulder, b.elbow));
  const faLens = buf.map(b => dist3D(b.elbow, b.wrist));

  const uaAngularSpreadDeg = angularSpreadDeg(uaDirs);
  const faAngularSpreadDeg = angularSpreadDeg(faDirs);
  const uaLengthStdDevMm = stddev(uaLens);
  const faLengthStdDevMm = stddev(faLens);

  const isStable =
    uaAngularSpreadDeg < STABILITY_ANGLE_SPREAD_DEG &&
    faAngularSpreadDeg < STABILITY_ANGLE_SPREAD_DEG &&
    uaLengthStdDevMm < STABILITY_LENGTH_STDDEV_MM &&
    faLengthStdDevMm < STABILITY_LENGTH_STDDEV_MM;

  return {
    uaAngularSpreadDeg,
    faAngularSpreadDeg,
    uaLengthStdDevMm,
    faLengthStdDevMm,
    isStable,
  };
}

function checkStability(
  buf: Array<{shoulder:{x:number;y:number;z:number}; elbow:{x:number;y:number;z:number}; wrist:{x:number;y:number;z:number}}>,
): boolean {
  return getArmStabilityMetrics(buf).isStable;
}

/**
 * Check that the current stereo geometry matches the expected calibration pose.
 * Returns a human-readable rejection reason, or null if the pose is valid.
 *
 * Stereo coordinate convention (from SVG projection labels):
 *   X = lateral, Y = vertical (positive = down in image), Z = depth
 */
function checkPoseGeometry(
  poseIdx: number,
  uaDir: {x:number;y:number;z:number},
  faDir: {x:number;y:number;z:number},
  armStraightAngle: number,
  pose1Dirs: {ua:{x:number;y:number;z:number}; fa:{x:number;y:number;z:number}} | null,
): string | null {
  if (poseIdx === 0) {
    // Right-arm-only development mode: the first calibration pose is a simple T-pose.
    // Accept a straight arm when the upper arm points mostly lateral and the forearm
    // remains aligned with it, even if the system is not yet doing the full 3-pose
    // multi-configuration validation.
    if (armStraightAngle > 35) return `Arm not straight (${armStraightAngle.toFixed(0)}°) — keep the right arm straight in a T-pose`;
    if (Math.abs(uaDir.x) < 0.25) return `Arm not lateral (|x|=${Math.abs(uaDir.x).toFixed(2)}) — extend the right arm to the side`;
    if (Math.abs(uaDir.y) > 0.75 || Math.abs(uaDir.z) > 0.75) return `Arm not level to the side (UA dir = x${uaDir.x.toFixed(2)} y${uaDir.y.toFixed(2)} z${uaDir.z.toFixed(2)})`;
    if (Math.abs(faDir.x) < 0.25) return `Forearm not aligned (|x|=${Math.abs(faDir.x).toFixed(2)}) — keep the right arm straight`;
    return null;
  }
  if (poseIdx === 1) {
    if (armStraightAngle > 28) return `Arm not straight (${armStraightAngle.toFixed(0)}°) — extend arm fully`;
    if (Math.abs(uaDir.z) < 0.35) return `Arm not forward enough (|z|=${Math.abs(uaDir.z).toFixed(2)}) — point arm toward camera`;
    if (pose1Dirs) {
      const diff = angleBetweenDeg(uaDir, pose1Dirs.ua);
      if (diff < 25) return `Too similar to Pose 1 (${diff.toFixed(0)}°) — point arm more directly forward`;
    }
    return null;
  }
  if (poseIdx === 2) {
    if (pose1Dirs) {
      const uaDiff = angleBetweenDeg(uaDir, pose1Dirs.ua);
      if (uaDiff > 40) return `Upper arm drifted (${uaDiff.toFixed(0)}° from T-pose) — keep upper arm lateral`;
      const faDiff = angleBetweenDeg(faDir, pose1Dirs.fa);
      if (faDiff < 30) return `Forearm not bent upward enough (${faDiff.toFixed(0)}°) — bend elbow so forearm points up`;
    }
    return null;
  }
  return null;
}

function fmtQ(v: number) { return v.toFixed(4); }
function fmtDeg(v: number) { return `${v.toFixed(1)}°`; }
function fmtMm(v: number | null) { return v === null ? '—' : `${v.toFixed(1)} mm`; }

// ── 3×3 matrix helpers ────────────────────────────────────────────────────────

type Mat3 = readonly [
  readonly [number,number,number],
  readonly [number,number,number],
  readonly [number,number,number],
];

const IDENTITY_MAT3: Mat3 = [[1,0,0],[0,1,0],[0,0,1]];

function cross3v(a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}): {x:number;y:number;z:number} {
  return { x: a.y*b.z - a.z*b.y, y: a.z*b.x - a.x*b.z, z: a.x*b.y - a.y*b.x };
}

function matVec3(M: Mat3, v: {x:number;y:number;z:number}): {x:number;y:number;z:number} {
  return {
    x: M[0][0]*v.x + M[0][1]*v.y + M[0][2]*v.z,
    y: M[1][0]*v.x + M[1][1]*v.y + M[1][2]*v.z,
    z: M[2][0]*v.x + M[2][1]*v.y + M[2][2]*v.z,
  };
}

function transpMat3(M: Mat3): Mat3 {
  return [[M[0][0],M[1][0],M[2][0]],[M[0][1],M[1][1],M[2][1]],[M[0][2],M[1][2],M[2][2]]];
}

function matMul3(A: Mat3, B: Mat3): Mat3 {
  const r = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        r[i][j] += A[i][k] * B[k][j];
  return r as unknown as Mat3;
}

/**
 * Estimate rotation R such that stereoDir_k ≈ R * imuWorldDir_k for all pairs.
 *
 * Uses the 2-vector Gram-Schmidt method: selects the two most orthogonal
 * direction pairs to build a 3D orthonormal frame in both spaces, then
 * R = b_frame * a_frame^T.  Returns IDENTITY_MAT3 (with a warning) if all
 * pairs are nearly collinear (calibration poses are not sufficiently diverse).
 */
function estimateWahbaR(
  aVecs: {x:number;y:number;z:number}[],  // directions in IMU world frame
  bVecs: {x:number;y:number;z:number}[],  // corresponding directions in stereo world
): { R: Mat3; collinearWarn: boolean; pair: { i: number; j: number } | null } {
  // Find the pair (i, j) whose cross product has the largest magnitude
  let bestMag = 0, bestI = 0, bestJ = Math.min(1, aVecs.length - 1);
  for (let i = 0; i < aVecs.length; i++) {
    for (let j = i + 1; j < aVecs.length; j++) {
      const c = cross3v(normalize3(aVecs[i]), normalize3(aVecs[j]));
      const mag = Math.sqrt(c.x*c.x + c.y*c.y + c.z*c.z);
      if (mag > bestMag) { bestMag = mag; bestI = i; bestJ = j; }
    }
  }

  if (bestMag < 0.17) { // < ~10° angular separation
    return { R: IDENTITY_MAT3, collinearWarn: true, pair: null };
  }

  // Orthonormal basis from a-vectors
  const a1 = normalize3(aVecs[bestI]);
  const a2proj = dot3(normalize3(aVecs[bestJ]), a1);
  const a2 = normalize3({ x: aVecs[bestJ].x - a2proj*a1.x, y: aVecs[bestJ].y - a2proj*a1.y, z: aVecs[bestJ].z - a2proj*a1.z });
  const a3 = normalize3(cross3v(a1, a2));

  // Orthonormal basis from b-vectors
  const b1 = normalize3(bVecs[bestI]);
  const b2proj = dot3(normalize3(bVecs[bestJ]), b1);
  const b2 = normalize3({ x: bVecs[bestJ].x - b2proj*b1.x, y: bVecs[bestJ].y - b2proj*b1.y, z: bVecs[bestJ].z - b2proj*b1.z });
  const b3 = normalize3(cross3v(b1, b2));

  // R = B_frame * A_frame^T  (maps a-space to b-space)
  // B_frame has b1,b2,b3 as columns; A_frame^T has a1,a2,a3 as rows
  const B: Mat3 = [[b1.x,b2.x,b3.x],[b1.y,b2.y,b3.y],[b1.z,b2.z,b3.z]];
  const AT: Mat3 = [[a1.x,a1.y,a1.z],[a2.x,a2.y,a2.z],[a3.x,a3.y,a3.z]];
  return { R: matMul3(B, AT), collinearWarn: false, pair: { i: bestI, j: bestJ } };
}

// ── Types ─────────────────────────────────────────────────────────────────────

type CalibStatus =
  | 'idle' | 'done'
  | 'countdown1' | 'collecting1'   // Pose 1: T-pose lateral
  | 'countdown2' | 'collecting2'   // Pose 2: arm straight forward
  | 'countdown3' | 'collecting3';  // Pose 3: forearm bent upward ~90°

interface CalibrationFrame {
  shoulder: {x:number;y:number;z:number};
  elbow:    {x:number;y:number;z:number};
  wrist:    {x:number;y:number;z:number};
  imu01:    IMUPacket;
  imu02:    IMUPacket;
}

/** Per-pose calibration snapshot — averaged over ~45 frames. */
interface PoseCalibData {
  imu01:       Quaternion;
  imu02:       Quaternion;
  stereoUA:    {x:number;y:number;z:number};   // normalized shoulder→elbow direction
  stereoFA:    {x:number;y:number;z:number};   // normalized elbow→wrist direction
  uaLengthMm:  number;
  faLengthMm:  number;
  framesUsed:  number;
}

/** Calibration consistency test results — replayed through the estimated model. */
interface CalibValidation {
  pose1UaResidualDeg:  number;
  pose1FaResidualDeg:  number;
  pose2UaResidualDeg:  number;
  pose2FaResidualDeg:  number;
  pose3UaResidualDeg:  number;
  pose3FaResidualDeg:  number;
  meanUaResidualDeg:   number;
  meanFaResidualDeg:   number;
  maxResidualDeg:      number;
  /** True if the Gram-Schmidt Wahba estimation was well-conditioned for each IMU. */
  alignOkUA:           boolean;
  alignOkFA:           boolean;
}

interface ArmCalibration {
  timestamp:        number;
  /** Fixed upper-arm bone direction expressed in imu_01 sensor frame (after R correction). */
  uaBoneLocalDir:   Vec3;
  /** Fixed forearm bone direction expressed in imu_02 sensor frame (after R correction). */
  faBoneLocalDir:   Vec3;
  /** Estimated rotation from imu_01 world frame → stereo world frame. */
  R_ua:             Mat3;
  /** Estimated rotation from imu_02 world frame → stereo world frame. */
  R_fa:             Mat3;
  uaLengthMm:       number;
  uaLengthStdDevMm: number;
  faLengthMm:       number;
  faLengthStdDevMm: number;
  poses:            [PoseCalibData, PoseCalibData, PoseCalibData];
  validation:       CalibValidation;
  quality:          'good' | 'warning' | 'failed';
  error?:           string;
}

interface LastReliableVision {
  timestamp: number;
  upperArm: {
    shoulder: {x:number;y:number;z:number};
    elbow:    {x:number;y:number;z:number};
  };
  forearm: {
    elbow: {x:number;y:number;z:number};
    wrist: {x:number;y:number;z:number};
  };
}

interface SegmentReconDebug {
  qCurrent:      Quaternion | null;
  boneLocalDir:  Vec3 | null;
  worldDir:      Vec3 | null;
  calibLength:   number | null;
  reconPos:      {x:number;y:number;z:number} | null;
  stereoPos:     {x:number;y:number;z:number} | null;
  posError:      number | null;
  angError:      number | null;
  /** Elbow angle between UA and FA world directions — diagnostic only. Populated on FA. */
  elbowAngleDeg: number | null;
}

interface ReconDebug {
  ua: SegmentReconDebug;
  fa: SegmentReconDebug;
}

function emptySegDebug(): SegmentReconDebug {
  return {
    qCurrent: null, boneLocalDir: null, worldDir: null,
    calibLength: null, reconPos: null, stereoPos: null,
    posError: null, angError: null, elbowAngleDeg: null,
  };
}

// ── Calibration validation (standalone) ──────────────────────────────────────

function computeValidation(
  poses: PoseCalibData[],
  uaBoneLocalDir: Vec3,
  faBoneLocalDir: Vec3,
  R_ua: Mat3,
  R_fa: Mat3,
  alignOkUA: boolean,
  alignOkFA: boolean,
): CalibValidation {
  const uaResiduals: number[] = [];
  const faResiduals: number[] = [];

  for (const pose of poses) {
    // Bone dir in IMU world → apply world-to-stereo rotation → stereo world dir
    const uaImuWorld = rotateVectorByQuaternion(pose.imu01, uaBoneLocalDir);
    const faImuWorld = rotateVectorByQuaternion(pose.imu02, faBoneLocalDir);
    const predUA = normalize3(matVec3(R_ua, { x: uaImuWorld[0], y: uaImuWorld[1], z: uaImuWorld[2] }));
    const predFA = normalize3(matVec3(R_fa, { x: faImuWorld[0], y: faImuWorld[1], z: faImuWorld[2] }));
    uaResiduals.push(angleBetweenDeg(predUA, pose.stereoUA));
    faResiduals.push(angleBetweenDeg(predFA, pose.stereoFA));
  }

  const meanUA = uaResiduals.reduce((s, v) => s + v, 0) / uaResiduals.length;
  const meanFA = faResiduals.reduce((s, v) => s + v, 0) / faResiduals.length;
  const maxRes = Math.max(...uaResiduals, ...faResiduals);

  return {
    pose1UaResidualDeg: uaResiduals[0], pose1FaResidualDeg: faResiduals[0],
    pose2UaResidualDeg: uaResiduals[1], pose2FaResidualDeg: faResiduals[1],
    pose3UaResidualDeg: uaResiduals[2], pose3FaResidualDeg: faResiduals[2],
    meanUaResidualDeg: meanUA,
    meanFaResidualDeg: meanFA,
    maxResidualDeg: maxRes,
    alignOkUA,
    alignOkFA,
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

type ProjectionAxis = { label: string; px: (p:{x:number;y:number;z:number}) => number; py: (p:{x:number;y:number;z:number}) => number };

const PROJECTIONS: ProjectionAxis[] = [
  { label: 'XY  (front)',  px: p => p.x,  py: p => -p.y },
  { label: 'YZ  (side)',   px: p => p.z,  py: p => -p.y },
  { label: 'XZ  (top)',    px: p => p.x,  py: p => -p.z },
];

function DualArmValidationSVG({ stereo, validation, width, height }: {
  stereo: ArmPoints; validation: ArmPoints; width: number; height: number;
}) {
  const PANEL_PAD = 20;
  const LABEL_H   = 16;
  const nPanels   = PROJECTIONS.length;
  const panelW    = Math.floor(width / nPanels);
  const panelH    = height - LABEL_H;

  const pts3D = [stereo, validation].flatMap(arm =>
    [arm.shoulder, arm.elbow, arm.wrist].filter(Boolean) as {x:number;y:number;z:number}[]
  );
  if (pts3D.length === 0) {
    return (
      <svg width={width} height={height}>
        <text x={width/2} y={height/2} textAnchor="middle" fill="#4b5563" fontSize="13">No right arm detected</text>
      </svg>
    );
  }

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <rect x={8} y={height - 14} width={12} height={3} fill="#34d399" rx="1" />
      <text x={24} y={height - 8} fill="#34d399" fontSize="9">Stereo</text>
      <rect x={72} y={height - 14} width={12} height={3} fill="#fb923c" rx="1" />
      <text x={88} y={height - 8} fill="#fb923c" fontSize="9">IMU Recon</text>

      {PROJECTIONS.map((proj, pi) => {
        const ox = pi * panelW;
        const ppts = pts3D.map(p => ({ px: proj.px(p), py: proj.py(p) }));
        const xs = ppts.map(p => p.px), ys = ppts.map(p => p.py);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const rangeX = maxX - minX || 200;
        const rangeY = maxY - minY || 200;
        const scale = Math.min(
          (panelW - PANEL_PAD * 2) / rangeX,
          (panelH - PANEL_PAD * 2 - 14) / rangeY,
        );
        const toSVG = (px: number, py: number) => ({
          x: ox + PANEL_PAD + (px - minX) * scale + ((panelW - PANEL_PAD * 2) - rangeX * scale) / 2,
          y: PANEL_PAD + 14 + (py - minY) * scale + ((panelH - PANEL_PAD * 2 - 14) - rangeY * scale) / 2,
        });

        const drawArm = (arm: ArmPoints, stroke: string) => {
          const pts = [arm.shoulder, arm.elbow, arm.wrist];
          const projected = pts.map(p => p ? toSVG(proj.px(p), proj.py(p)) : null);
          return (
            <>
              {([[projected[0],projected[1]],[projected[1],projected[2]]] as const).map(([A, B], i) => {
                if (!A || !B) return null;
                return <line key={`${pi}-bone-${stroke}-${i}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y}
                  stroke={stroke} strokeWidth="4" strokeLinecap="round" opacity={0.85} />;
              })}
              {projected.map((pt, i) => pt ? (
                <circle key={`${pi}-joint-${stroke}-${i}`} cx={pt.x} cy={pt.y} r={5}
                  fill={stroke} stroke="rgba(0,0,0,0.7)" strokeWidth="1.5" />
              ) : null)}
            </>
          );
        };

        return (
          <g key={proj.label}>
            <rect x={ox + 1} y={1} width={panelW - 2} height={panelH - 2}
              fill="none" stroke="#1f2937" strokeWidth="1" rx="4" />
            <text x={ox + panelW / 2} y={14} textAnchor="middle" fill="#6b7280" fontSize="10" fontWeight="600">
              {proj.label}
            </text>
            {drawArm(stereo,     '#34d399')}
            {drawArm(validation, '#fb923c')}
          </g>
        );
      })}
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface CalibConditionDebug {
  shoulderOk: boolean; elbowOk: boolean; wristOk: boolean;
  tracked: number; segOk: boolean; uaLenMm: number; faLenMm: number;
  armCalibOk: boolean;
  imu01Fresh: boolean; imu02Fresh: boolean; imu01AgeMs: number; imu02AgeMs: number;
}

/** Live diagnostics written from the timer-based calibration sampler. */
interface CalibSampleDiag {
  acceptedFrames:       number;
  rejectedFrames:       number;
  rejectionReason:      string | null;
  isPoseValid:          boolean;
  isStable:             boolean;
  stereoAgeMs:          number;
  imu01AgeMs:           number;
  imu02AgeMs:           number;
  currentUaLenMm:       number;
  currentFaLenMm:       number;
  uaAngularSpreadDeg:   number;
  faAngularSpreadDeg:   number;
  runningUaStdDevMm:    number;
  runningFaStdDevMm:    number;
  windowFrameCount:     number;
}

// Static Tailwind class strings — must be complete for build-time purging
const POSE_META = [
  {
    num: 1, name: 'T-Pose (Lateral)',
    title: 'Pose 1 — T-Pose (Lateral)',
    body: 'Stand with your right arm straight out to the side, palm facing down.\nKeep both upper arm and forearm horizontal. Hold still.',
    // active strip classes
    stripActive: 'border-blue-600 bg-blue-900/30 text-blue-300',
    // countdown card classes
    cardBg: 'bg-amber-900/20 border-amber-700',
    ringBg: 'bg-amber-800/50 border-amber-500',
    titleCls: 'text-amber-300',
    bodyCls: 'text-amber-400',
    barCls: 'bg-amber-500',
  },
  {
    num: 2, name: 'Forward (Depth)',
    title: 'Pose 2 — Arm Straight Forward',
    body: 'Extend your right arm straight forward into depth.\nKeep the arm straight. Hold still.',
    stripActive: 'border-cyan-600 bg-cyan-900/30 text-cyan-300',
    cardBg: 'bg-cyan-900/20 border-cyan-700',
    ringBg: 'bg-cyan-800/50 border-cyan-500',
    titleCls: 'text-cyan-300',
    bodyCls: 'text-cyan-400',
    barCls: 'bg-cyan-500',
  },
  {
    num: 3, name: 'Forearm Up',
    title: 'Pose 3 — Forearm Bent Upward',
    body: 'Return your upper arm to the lateral T-pose position.\nBend your elbow so the forearm points straight up ~90°. Hold still.',
    stripActive: 'border-purple-600 bg-purple-900/30 text-purple-300',
    cardBg: 'bg-purple-900/20 border-purple-700',
    ringBg: 'bg-purple-800/50 border-purple-500',
    titleCls: 'text-purple-300',
    bodyCls: 'text-purple-400',
    barCls: 'bg-purple-500',
  },
] as const;

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
  const correctedPoseRef = useRef<TriangulatedPose>(Object.fromEntries(LANDMARK_KEYS.map(k => [k, null])) as TriangulatedPose);
  const trackedCountRef  = useRef(0);
  const imuReconPoseRef  = useRef<TriangulatedPose | null>(null);
  const imuReconDebugRef = useRef<ReconDebug>({ ua: emptySegDebug(), fa: emptySegDebug() });

  const [displayPose, setDisplayPose]     = useState<TriangulatedPose>(correctedPoseRef.current);
  const [imuReconPose, setImuReconPose]   = useState<TriangulatedPose | null>(null);
  const [imuReconDebug, setImuReconDebug] = useState<ReconDebug | null>(null);

  // ── 3-Pose Calibration state ──────────────────────────────────────────────────
  const [calibStatus, setCalibStatus]   = useState<CalibStatus>('idle');
  const [countdownSec, setCountdownSec] = useState(0);

  // Per-pose frame arrays: index 0-2 = poses 1-3
  const [pose1Frames, setPose1Frames] = useState<CalibrationFrame[]>([]);
  const [pose2Frames, setPose2Frames] = useState<CalibrationFrame[]>([]);
  const [pose3Frames, setPose3Frames] = useState<CalibrationFrame[]>([]);
  const pose1FramesRef = useRef<CalibrationFrame[]>([]);
  const pose2FramesRef = useRef<CalibrationFrame[]>([]);
  const pose3FramesRef = useRef<CalibrationFrame[]>([]);

  const [armCalibration, setArmCalibration] = useState<ArmCalibration | null>(null);
  const armCalibrationRef = useRef<ArmCalibration | null>(null);
  useEffect(() => { armCalibrationRef.current = armCalibration; }, [armCalibration]);

  // ── Last Reliable Vision (positional velocity gate only) ─────────────────────
  const [lastReliable, setLastReliable]   = useState<LastReliableVision | null>(null);
  const lastReliableRef       = useRef<LastReliableVision | null>(null);
  const lastReliableUpdateRef = useRef(0);

  // ── Timer-based calibration sampling refs ────────────────────────────────────
  /** Updated by onCorrectedPose for each fresh processed stereo frame. */
  const lastProcessedStereoTimestampRef = useRef<number>(0);
  /** Prevents the same processed frame from being accepted twice. */
  const lastAcceptedTimestampRef        = useRef<number>(-1);
  /** Rolling stability window — cleared when entering each collecting phase. */
  const stabilityWindowRef        = useRef<Array<{
    shoulder:{x:number;y:number;z:number};
    elbow:   {x:number;y:number;z:number};
    wrist:   {x:number;y:number;z:number};
  }>>([]);
  /** Average UA/FA directions from Pose 1 — used to validate Poses 2 and 3. */
  const pose1AvgDirsRef   = useRef<{ua:{x:number;y:number;z:number}; fa:{x:number;y:number;z:number}} | null>(null);
  /** Live calibration sample diagnostics — written by the timer, synced at 10fps. */
  const calibSampleDiagRef = useRef<CalibSampleDiag | null>(null);
  const [calibSampleDiag, setCalibSampleDiag] = useState<CalibSampleDiag | null>(null);

  // ── Per-frame calibration condition debug ────────────────────────────────────
  const calibCondDebugRef = useRef<CalibConditionDebug | null>(null);
  const [calibCondDebug, setCalibCondDebug] = useState<CalibConditionDebug | null>(null);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [showValidation, setShowValidation] = useState(false);
  const [showDebug, setShowDebug]           = useState(false);

  // ── 10 fps sync ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setDisplayPose({ ...correctedPoseRef.current });
      setImuReconPose(imuReconPoseRef.current ? { ...imuReconPoseRef.current } : null);
      setImuReconDebug({ ...imuReconDebugRef.current });
      if (lastReliableRef.current) setLastReliable({ ...lastReliableRef.current });
      if (calibCondDebugRef.current) setCalibCondDebug({ ...calibCondDebugRef.current });
      if (calibSampleDiagRef.current) setCalibSampleDiag({ ...calibSampleDiagRef.current });
    }, 100);
    return () => clearInterval(id);
  }, []);

  // ── Unified countdown effect (handles all 3 countdown phases) ────────────────
  useEffect(() => {
    const nextMap: Partial<Record<CalibStatus, CalibStatus>> = {
      countdown1: 'collecting1',
      countdown2: 'collecting2',
      countdown3: 'collecting3',
    };
    const next = nextMap[calibStatus];
    if (!next) return;
    let remaining = 5;
    setCountdownSec(remaining);
    const id = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(id);
        setCalibStatus(next);
      } else {
        setCountdownSec(remaining);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [calibStatus]);

  // ── Auto-advance: pose N collected → start countdown for pose N+1 ─────────────
  useEffect(() => {
    if (calibStatus !== 'collecting1' || pose1Frames.length < CALIBRATION_FRAMES_NEEDED) return;
    // Store avg UA/FA directions from pose 1 for validating poses 2 and 3
    const uaDirs = pose1Frames.map(f => normalize3({ x: f.elbow.x-f.shoulder.x, y: f.elbow.y-f.shoulder.y, z: f.elbow.z-f.shoulder.z }));
    const faDirs = pose1Frames.map(f => normalize3({ x: f.wrist.x-f.elbow.x,   y: f.wrist.y-f.elbow.y,   z: f.wrist.z-f.elbow.z   }));
    const uaAvg = averageVec3Simple(uaDirs);
    const faAvg = averageVec3Simple(faDirs);
    if (uaAvg && faAvg) {
      pose1AvgDirsRef.current = { ua: { x: uaAvg[0], y: uaAvg[1], z: uaAvg[2] }, fa: { x: faAvg[0], y: faAvg[1], z: faAvg[2] } };
    }
    stabilityWindowRef.current = [];
    lastProcessedStereoTimestampRef.current = 0;
    lastAcceptedTimestampRef.current = -1;
    setCalibStatus('countdown2');
  }, [calibStatus, pose1Frames.length]);

  useEffect(() => {
    if (calibStatus !== 'collecting2' || pose2Frames.length < CALIBRATION_FRAMES_NEEDED) return;
    stabilityWindowRef.current = [];
    lastProcessedStereoTimestampRef.current = 0;
    lastAcceptedTimestampRef.current = -1;
    setCalibStatus('countdown3');
  }, [calibStatus, pose2Frames.length]);

  // ── Finalize calibration after all 3 poses collected ─────────────────────────
  useEffect(() => {
    if (calibStatus !== 'collecting3' || pose3Frames.length < CALIBRATION_FRAMES_NEEDED) return;

    const allPoseFrames = [pose1Frames, pose2Frames, pose3Frames];

    // Step 1: per-pose quaternion and stereo-direction averages
    const poseData: PoseCalibData[] = allPoseFrames.map(frames => {
      const imu01Avg = averageQuaternions(frames.map(f => packetToQuat(f.imu01)));
      const imu02Avg = averageQuaternions(frames.map(f => packetToQuat(f.imu02)));
      const uaDirs = frames.map(f => normalize3({ x: f.elbow.x-f.shoulder.x, y: f.elbow.y-f.shoulder.y, z: f.elbow.z-f.shoulder.z }));
      const faDirs = frames.map(f => normalize3({ x: f.wrist.x-f.elbow.x,   y: f.wrist.y-f.elbow.y,   z: f.wrist.z-f.elbow.z   }));
      const uaVec = averageVec3Simple(uaDirs);
      const faVec = averageVec3Simple(faDirs);
      // Fall back to first frame direction if averaging fails (inconsistent data)
      const stereoUA = uaVec ? { x: uaVec[0], y: uaVec[1], z: uaVec[2] }
        : normalize3({ x: frames[0].elbow.x-frames[0].shoulder.x, y: frames[0].elbow.y-frames[0].shoulder.y, z: frames[0].elbow.z-frames[0].shoulder.z });
      const stereoFA = faVec ? { x: faVec[0], y: faVec[1], z: faVec[2] }
        : normalize3({ x: frames[0].wrist.x-frames[0].elbow.x, y: frames[0].wrist.y-frames[0].elbow.y, z: frames[0].wrist.z-frames[0].elbow.z });
      return {
        imu01: imu01Avg, imu02: imu02Avg, stereoUA, stereoFA,
        uaLengthMm: median(frames.map(f => dist3D(f.shoulder, f.elbow))),
        faLengthMm: median(frames.map(f => dist3D(f.elbow, f.wrist))),
        framesUsed: frames.length,
      };
    });

    // Step 2: Initial bone-local-dir estimate (sensor frame) — ignoring R for now.
    // boneLocalDir_sensor_0 = rotate(inv(q_imu), stereoDir)
    // This is correct IF IMU world == stereo world; treated as initial approximation otherwise.
    const uaLocalObs0: {x:number;y:number;z:number}[] = [];
    const faLocalObs0: {x:number;y:number;z:number}[] = [];
    for (const frames of allPoseFrames) {
      for (const frame of frames) {
        const qUA = packetToQuat(frame.imu01);
        const qFA = packetToQuat(frame.imu02);
        const sUA = normalize3({ x: frame.elbow.x-frame.shoulder.x, y: frame.elbow.y-frame.shoulder.y, z: frame.elbow.z-frame.shoulder.z });
        const sFA = normalize3({ x: frame.wrist.x-frame.elbow.x,   y: frame.wrist.y-frame.elbow.y,   z: frame.wrist.z-frame.elbow.z   });
        const uaL = rotateVectorByQuaternion(invertQuaternion(qUA), [sUA.x, sUA.y, sUA.z]);
        const faL = rotateVectorByQuaternion(invertQuaternion(qFA), [sFA.x, sFA.y, sFA.z]);
        uaLocalObs0.push({ x: uaL[0], y: uaL[1], z: uaL[2] });
        faLocalObs0.push({ x: faL[0], y: faL[1], z: faL[2] });
      }
    }
    const uaBoneLocalDir0 = averageVec3Simple(uaLocalObs0);
    const faBoneLocalDir0 = averageVec3Simple(faLocalObs0);

    if (!uaBoneLocalDir0 || !faBoneLocalDir0) {
      const result: ArmCalibration = {
        timestamp: Date.now(),
        uaBoneLocalDir: [1,0,0], faBoneLocalDir: [0,0,1],
        R_ua: IDENTITY_MAT3, R_fa: IDENTITY_MAT3,
        uaLengthMm: 0, uaLengthStdDevMm: 0, faLengthMm: 0, faLengthStdDevMm: 0,
        poses: poseData as [PoseCalibData, PoseCalibData, PoseCalibData],
        validation: { pose1UaResidualDeg:0,pose1FaResidualDeg:0,pose2UaResidualDeg:0,pose2FaResidualDeg:0,pose3UaResidualDeg:0,pose3FaResidualDeg:0,meanUaResidualDeg:0,meanFaResidualDeg:0,maxResidualDeg:0,alignOkUA:false,alignOkFA:false },
        quality: 'failed',
        error: 'Sensor-to-bone observations are inconsistent — recalibrate',
      };
      setArmCalibration(result);
      setCalibStatus('done');
      return;
    }

    // Step 3: Estimate R_imu_to_stereo for each IMU using Wahba (Gram-Schmidt 2-vector).
    // For each pose, bone direction in IMU world = rotate(q_pose_avg, boneLocalDir_sensor_0)
    const uaImuWorldDirs = poseData.map(p => {
      const v = rotateVectorByQuaternion(p.imu01, uaBoneLocalDir0);
      return { x: v[0], y: v[1], z: v[2] };
    });
    const faImuWorldDirs = poseData.map(p => {
      const v = rotateVectorByQuaternion(p.imu02, faBoneLocalDir0);
      return { x: v[0], y: v[1], z: v[2] };
    });
    const stereoUADirs = poseData.map(p => p.stereoUA);
    const stereoFADirs = poseData.map(p => p.stereoFA);

    const { R: R_ua, collinearWarn: warnUA, pair: uaPair } = estimateWahbaR(uaImuWorldDirs, stereoUADirs);
    const { R: R_fa, collinearWarn: warnFA, pair: faPair } = estimateWahbaR(faImuWorldDirs, stereoFADirs);

    console.info('[IMU CALIB] Wahba pair selection', {
      ua: uaPair,
      fa: faPair,
      uaWarn: warnUA,
      faWarn: warnFA,
    });

    // Step 4: Refined bone-local-dir with R correction applied.
    // boneLocalDir_refined = rotate(inv(q), R^T * stereoDir)
    const uaLocalObs1: {x:number;y:number;z:number}[] = [];
    const faLocalObs1: {x:number;y:number;z:number}[] = [];
    const R_ua_T = transpMat3(R_ua);
    const R_fa_T = transpMat3(R_fa);
    for (const frames of allPoseFrames) {
      for (const frame of frames) {
        const qUA = packetToQuat(frame.imu01);
        const qFA = packetToQuat(frame.imu02);
        const sUA = normalize3({ x: frame.elbow.x-frame.shoulder.x, y: frame.elbow.y-frame.shoulder.y, z: frame.elbow.z-frame.shoulder.z });
        const sFA = normalize3({ x: frame.wrist.x-frame.elbow.x,   y: frame.wrist.y-frame.elbow.y,   z: frame.wrist.z-frame.elbow.z   });
        // Map stereo direction into IMU world frame, then into sensor frame
        const sUA_imu = matVec3(R_ua_T, sUA);
        const sFA_imu = matVec3(R_fa_T, sFA);
        const uaL = rotateVectorByQuaternion(invertQuaternion(qUA), [sUA_imu.x, sUA_imu.y, sUA_imu.z]);
        const faL = rotateVectorByQuaternion(invertQuaternion(qFA), [sFA_imu.x, sFA_imu.y, sFA_imu.z]);
        uaLocalObs1.push({ x: uaL[0], y: uaL[1], z: uaL[2] });
        faLocalObs1.push({ x: faL[0], y: faL[1], z: faL[2] });
      }
    }
    const uaBoneLocalDir = averageVec3Simple(uaLocalObs1) ?? uaBoneLocalDir0;
    const faBoneLocalDir = averageVec3Simple(faLocalObs1) ?? faBoneLocalDir0;

    const allUaLengths = allPoseFrames.flatMap(frames => frames.map(f => dist3D(f.shoulder, f.elbow)));
    const allFaLengths = allPoseFrames.flatMap(frames => frames.map(f => dist3D(f.elbow, f.wrist)));

    const validation = computeValidation(poseData, uaBoneLocalDir, faBoneLocalDir, R_ua, R_fa, !warnUA, !warnFA);

    const uaPredicted = poseData.map(p => {
      const v = rotateVectorByQuaternion(p.imu01, uaBoneLocalDir);
      return normalize3(matVec3(R_ua, { x: v[0], y: v[1], z: v[2] }));
    });
    const faPredicted = poseData.map(p => {
      const v = rotateVectorByQuaternion(p.imu02, faBoneLocalDir);
      return normalize3(matVec3(R_fa, { x: v[0], y: v[1], z: v[2] }));
    });

    const perPoseDebug = poseData.map((p, idx) => ({
      pose: idx + 1,
      uaLengthMm: p.uaLengthMm,
      faLengthMm: p.faLengthMm,
      stereoUA: p.stereoUA,
      stereoFA: p.stereoFA,
      imu01Quat: p.imu01,
      imu02Quat: p.imu02,
      predictedUA: uaPredicted[idx],
      predictedFA: faPredicted[idx],
      uaResidualDeg: angleBetweenDeg(uaPredicted[idx], p.stereoUA),
      faResidualDeg: angleBetweenDeg(faPredicted[idx], p.stereoFA),
    }));

    console.info('[IMU CALIB] pose-by-pose debug', {
      uaSelectedPair: uaPair,
      faSelectedPair: faPair,
      perPose: perPoseDebug,
      validation,
    });

    const quality: ArmCalibration['quality'] =
      (!validation.alignOkUA || !validation.alignOkFA || validation.maxResidualDeg > 25) ? 'failed'
      : validation.maxResidualDeg > 10 ? 'warning'
      : 'good';

    const result: ArmCalibration = {
      timestamp:        Date.now(),
      uaBoneLocalDir, faBoneLocalDir,
      R_ua, R_fa,
      uaLengthMm:       median(allUaLengths),
      uaLengthStdDevMm: stddev(allUaLengths),
      faLengthMm:       median(allFaLengths),
      faLengthStdDevMm: stddev(allFaLengths),
      poses:            poseData as [PoseCalibData, PoseCalibData, PoseCalibData],
      validation,
      quality,
    };

    setArmCalibration(result);
    setCalibStatus('done');
    console.info('[IMU CALIB] 3-pose sensor-to-bone calibration complete', result);
  }, [calibStatus, pose3Frames, pose1Frames, pose2Frames]);

  // ── getRawIMU stable ref (needed by timer and onCorrectedPose) ───────────────
  const getRawIMURef = useRef(getRawIMU);
  useEffect(() => { getRawIMURef.current = getRawIMU; }, [getRawIMU]);

  // ── Timer-based calibration frame collection (~25 Hz) ─────────────────────────
  //
  // Collection is driven by a setInterval (not by the stereo callback) so frames
  // accumulate while the subject holds perfectly still. The same processed stereo
  // frame is never accepted twice, and the live sample must stay fresh, stable,
  // and geometrically correct for the requested pose.
  useEffect(() => {
    const COLLECTING_STATES: CalibStatus[] = ['collecting1','collecting2','collecting3'];
    if (!COLLECTING_STATES.includes(calibStatus)) return;

    const poseIdx = parseInt(calibStatus.slice(-1)) - 1;
    const framesRefByPose  = [pose1FramesRef,  pose2FramesRef,  pose3FramesRef];
    const setFramesByPose  = [setPose1Frames,  setPose2Frames,  setPose3Frames];
    const framesRef  = framesRefByPose[poseIdx];
    const setFrames  = setFramesByPose[poseIdx];

    const id = setInterval(() => {
      // Skip if this pose is already done
      if (framesRef.current.length >= CALIBRATION_FRAMES_NEEDED) return;

      const nowMs       = performance.now();
      const pose        = correctedPoseRef.current;
      const shoulder    = pose['rightShoulder'];
      const elbow       = pose['rightElbow'];
      const wrist       = pose['rightWrist'];
      const imu01Raw    = getRawIMURef.current('imu_01');
      const imu02Raw    = getRawIMURef.current('imu_02');

      const accepted = framesRef.current.length;
      let rejected   = calibSampleDiagRef.current?.rejectedFrames ?? 0;

      const imu01AgeMs = imu01Raw ? nowMs - imu01Raw.lastReceivedAt : Infinity;
      const imu02AgeMs = imu02Raw ? nowMs - imu02Raw.lastReceivedAt : Infinity;
      const stereoAgeMs = nowMs - lastProcessedStereoTimestampRef.current;

      // ── Check joint validity and segment range ───────────────────────────
      const jointsOk = isValidVec(shoulder) && isValidVec(elbow) && isValidVec(wrist);
      const uaLen = (jointsOk && shoulder && elbow) ? dist3D(shoulder, elbow) : 0;
      const faLen = (jointsOk && elbow && wrist)    ? dist3D(elbow, wrist)    : 0;
      const segOk = uaLen > SEG_MIN_MM && uaLen < SEG_MAX_MM && faLen > SEG_MIN_MM && faLen < SEG_MAX_MM;

      // ── Freshness checks ─────────────────────────────────────────────────
      const stereoFresh = stereoAgeMs < 150;
      const imu01Fresh  = imu01AgeMs  < 150;  // tightened from 500ms
      const imu02Fresh  = imu02AgeMs  < 150;  // tightened from 500ms
      const imu01Ok     = !!(imu01Raw?.latest) && imu01Fresh;
      const imu02Ok     = !!(imu02Raw?.latest) && imu02Fresh;

      // ── Dedup: accept each processed stereo frame only once ───────────────
      const isNewFrame = lastProcessedStereoTimestampRef.current !== lastAcceptedTimestampRef.current;

      // ── Stability gating ─────────────────────────────────────────────────
      // Only add a fresh processed frame to the window. A repeated frozen frame
      // should not make the arm look stable just because the last sample never changed.
      if (isNewFrame && jointsOk && shoulder && elbow && wrist) {
        stabilityWindowRef.current.push({ shoulder: {...shoulder}, elbow: {...elbow}, wrist: {...wrist} });
        if (stabilityWindowRef.current.length > STABILITY_WINDOW)
          stabilityWindowRef.current.shift();
      }

      const hasFullWindow = stabilityWindowRef.current.length >= STABILITY_WINDOW;
      const stabilityMetrics = getArmStabilityMetrics(stabilityWindowRef.current);
      const isStable = hasFullWindow && stabilityMetrics.isStable;

      // ── Pose geometry validation ─────────────────────────────────────────
      let poseRejectionReason: string | null = null;
      let isPoseValid = false;
      if (jointsOk && segOk && shoulder && elbow && wrist) {
        const uaDir = normalize3({ x: elbow.x-shoulder.x, y: elbow.y-shoulder.y, z: elbow.z-shoulder.z });
        const faDir = normalize3({ x: wrist.x-elbow.x,   y: wrist.y-elbow.y,   z: wrist.z-elbow.z   });
        const straightAngleDeg = angleBetweenDeg(uaDir, faDir);
        poseRejectionReason = checkPoseGeometry(
          poseIdx, uaDir, faDir, straightAngleDeg,
          pose1AvgDirsRef.current,
        );
        isPoseValid = poseRejectionReason === null;
      } else {
        poseRejectionReason = !jointsOk ? 'Joints not visible' : 'Segment length out of range';
      }

      // ── Determine rejection reason for diagnostics ───────────────────────
      let rejectionReason: string | null = null;
      if (!jointsOk)          rejectionReason = 'Joints not visible';
      else if (!segOk)         rejectionReason = `Segment out of range (UA:${uaLen.toFixed(0)} FA:${faLen.toFixed(0)}mm)`;
      else if (!stereoFresh)   rejectionReason = `Stereo stale (${stereoAgeMs.toFixed(0)}ms)`;
      else if (!imu01Ok)       rejectionReason = `imu_01 stale (${imu01AgeMs.toFixed(0)}ms)`;
      else if (!imu02Ok)       rejectionReason = `imu_02 stale (${imu02AgeMs.toFixed(0)}ms)`;
      else if (!isNewFrame)    rejectionReason = 'Same stereo frame (waiting for new data)';
      else if (!hasFullWindow) rejectionReason = `Building stability window (${stabilityWindowRef.current.length}/${STABILITY_WINDOW})`;
      else if (!isStable)      rejectionReason = 'Hold still — waiting for stable arm geometry';
      else if (!isPoseValid)   rejectionReason = poseRejectionReason;

      // ── Accept frame if all checks pass ──────────────────────────────────
      const allOk = jointsOk && segOk && stereoFresh && imu01Ok && imu02Ok && isNewFrame && isStable && isPoseValid;

      if (allOk && shoulder && elbow && wrist && imu01Raw?.latest && imu02Raw?.latest) {
        framesRef.current.push({
          shoulder: {...shoulder}, elbow: {...elbow}, wrist: {...wrist},
          imu01: { ...imu01Raw.latest },
          imu02: { ...imu02Raw.latest },
        });
        setFrames([...framesRef.current]);
        lastAcceptedTimestampRef.current = lastProcessedStereoTimestampRef.current;
      } else {
        rejected++;
      }

      // Running segment length std dev for diagnostics
      const uaLens = framesRef.current.map(f => dist3D(f.shoulder, f.elbow));
      const faLens = framesRef.current.map(f => dist3D(f.elbow, f.wrist));

      calibSampleDiagRef.current = {
        acceptedFrames:    framesRef.current.length,
        rejectedFrames:    rejected,
        rejectionReason:   allOk ? null : rejectionReason,
        isPoseValid,
        isStable,
        stereoAgeMs:       isFinite(stereoAgeMs) ? Math.round(stereoAgeMs) : 9999,
        imu01AgeMs:        isFinite(imu01AgeMs)  ? Math.round(imu01AgeMs)  : 9999,
        imu02AgeMs:        isFinite(imu02AgeMs)  ? Math.round(imu02AgeMs)  : 9999,
        currentUaLenMm:    uaLen,
        currentFaLenMm:    faLen,
        uaAngularSpreadDeg: stabilityMetrics.uaAngularSpreadDeg,
        faAngularSpreadDeg: stabilityMetrics.faAngularSpreadDeg,
        runningUaStdDevMm: stddev(uaLens),
        runningFaStdDevMm: stddev(faLens),
        windowFrameCount:  stabilityWindowRef.current.length,
      };
    }, 40); // ~25 Hz

    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibStatus]);

  // ── Per-frame callback from IMUReconstructionView ─────────────────────────────
  const onCorrectedPose = useCallback((pose: TriangulatedPose, tracked: number, statuses: JointFailureStatus[]) => {
    correctedPoseRef.current = pose;
    trackedCountRef.current  = tracked;
    // Stamp each new stereo frame so the timer-based sampler can detect new data
    lastProcessedStereoTimestampRef.current = performance.now();

    const shoulder = pose['rightShoulder'];
    const elbow    = pose['rightElbow'];
    const wrist    = pose['rightWrist'];

    // ── Validate arm geometry ────────────────────────────────────────────────
    const shoulderOk = isValidVec(shoulder);
    const elbowOk    = isValidVec(elbow);
    const wristOk    = isValidVec(wrist);
    const uaLen      = (shoulderOk && elbowOk) ? dist3D(shoulder!, elbow!) : 0;
    const faLen      = (elbowOk && wristOk)    ? dist3D(elbow!,   wrist!)  : 0;
    const segOk      = uaLen > SEG_MIN_MM && uaLen < SEG_MAX_MM && faLen > SEG_MIN_MM && faLen < SEG_MAX_MM;

    // ── Jitter gate (two variants) ───────────────────────────────────────────
    const byJoint = Object.fromEntries(statuses.map(s => [s.joint, s]));
    const rightArmClean = (['rightShoulder', 'rightElbow', 'rightWrist'] as const).every(
      joint => byJoint[joint]?.reliable && byJoint[joint]?.failureType === 'none',
    );
    const rightArmCalibOk = (['rightShoulder', 'rightElbow', 'rightWrist'] as const).every(
      joint => byJoint[joint]?.reliable && byJoint[joint]?.failureType !== 'heavy_jitter',
    );

    // Calibrated segment-length gate (active only after calibration)
    const calibData = armCalibrationRef.current;
    const segCalibOk = calibData
      ? Math.abs(uaLen - calibData.uaLengthMm) / calibData.uaLengthMm <= 0.20 &&
        Math.abs(faLen - calibData.faLengthMm) / calibData.faLengthMm <= 0.20
      : true;

    // Position velocity gate — catches teleporting joints; 120mm/frame ≈ 3.6 m/s at 30fps
    const ref = lastReliableRef.current;
    const posVelocityOk = (ref && elbow && wrist)
      ? dist3D(elbow, ref.upperArm.elbow) < 120 &&
        dist3D(wrist, ref.forearm.wrist)  < 120
      : true;

    const armReliable = shoulderOk && elbowOk && wristOk && tracked >= 3 &&
      segOk && rightArmClean && segCalibOk && posVelocityOk;

    const calibArmOk = shoulderOk && elbowOk && wristOk && tracked >= 3 &&
      segOk && rightArmCalibOk;

    // ── Update Last Reliable Vision (strict gate) ────────────────────────────
    if (armReliable && shoulder && elbow && wrist) {
      lastReliableRef.current = {
        timestamp: Date.now(),
        upperArm:  { shoulder: {...shoulder}, elbow: {...elbow} },
        forearm:   { elbow: {...elbow}, wrist: {...wrist} },
      };
      const nowMs = performance.now();
      if (nowMs - lastReliableUpdateRef.current > 500) {
        lastReliableUpdateRef.current = nowMs;
      }
    }

    // ── Per-frame condition debug ────────────────────────────────────────────
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
        imu01Fresh: imu01Age <= 500, imu02Fresh: imu02Age <= 500,
        imu01AgeMs: isFinite(imu01Age) ? Math.round(imu01Age) : 9999,
        imu02AgeMs: isFinite(imu02Age) ? Math.round(imu02Age) : 9999,
      };
    }

    // ── IMU Reconstruction ───────────────────────────────────────────────────
    //
    // Absolute sensor-to-bone reconstruction (no ΔQ, no reference snapshot needed).
    //
    // Upper arm:
    //   worldDir_UA = normalize(rotate(q_imu01_current, uaBoneLocalDir))
    //   elbow = shoulder + uaLength × worldDir_UA
    //
    // Forearm:
    //   worldDir_FA = normalize(rotate(q_imu02_current, faBoneLocalDir))
    //   wrist = elbow + faLength × worldDir_FA
    //
    // Convention: BNO085 q maps sensor-local vectors → world frame.
    //   rotate(q, v_sensor) = v_world
    //   rotate(inv(q), v_world) = v_sensor
    if (!calibData) {
      imuReconPoseRef.current = null;
      imuReconDebugRef.current = { ua: emptySegDebug(), fa: emptySegDebug() };
      return;
    }

    // Shoulder MUST be visible — it is the ONLY positional anchor.
    if (!isValidVec(shoulder)) {
      imuReconPoseRef.current = null;
      imuReconDebugRef.current = { ua: emptySegDebug(), fa: emptySegDebug() };
      return;
    }
    const anchorShoulder = shoulder!;

    const imu01Raw    = getRawIMURef.current('imu_01');
    const imu01Packet = imu01Raw?.latest;
    if (!imu01Packet || !isValidQuat(packetToQuat(imu01Packet))) {
      imuReconPoseRef.current = null;
      imuReconDebugRef.current = { ua: emptySegDebug(), fa: emptySegDebug() };
      return;
    }

    const qCurrentUA    = packetToQuat(imu01Packet);
    // sensor frame → IMU world → stereo world
    const boneImuWorldUA = rotateVectorByQuaternion(qCurrentUA, calibData.uaBoneLocalDir);
    const worldDirUA     = normalize3(matVec3(calibData.R_ua, { x: boneImuWorldUA[0], y: boneImuWorldUA[1], z: boneImuWorldUA[2] }));
    const uaLength    = calibData.uaLengthMm;

    const reconElbow = {
      x: anchorShoulder.x + uaLength * worldDirUA.x,
      y: anchorShoulder.y + uaLength * worldDirUA.y,
      z: anchorShoulder.z + uaLength * worldDirUA.z,
    };

    const stereoElbow = pose['rightElbow'];
    const stereoWrist = pose['rightWrist'];
    const stereoUADir = (shoulderOk && elbowOk && shoulder && elbow)
      ? normalize3({ x: elbow.x-shoulder.x, y: elbow.y-shoulder.y, z: elbow.z-shoulder.z })
      : null;

    const uaDebug: SegmentReconDebug = {
      qCurrent:      qCurrentUA,
      boneLocalDir:  calibData.uaBoneLocalDir,
      worldDir:      [worldDirUA.x, worldDirUA.y, worldDirUA.z],
      calibLength:   uaLength,
      reconPos:      reconElbow,
      stereoPos:     stereoElbow ? { ...stereoElbow } : null,
      posError:      stereoElbow ? dist3D(reconElbow, stereoElbow) : null,
      angError:      stereoUADir ? angleBetweenDeg(worldDirUA, stereoUADir) : null,
      elbowAngleDeg: null,
    };

    const imu02Raw    = getRawIMURef.current('imu_02');
    const imu02Packet = imu02Raw?.latest;

    let reconWrist: {x:number;y:number;z:number} | null = null;
    let faDebug: SegmentReconDebug;

    if (imu02Packet && isValidQuat(packetToQuat(imu02Packet))) {
      const qCurrentFA    = packetToQuat(imu02Packet);
      // sensor frame → IMU world → stereo world
      const boneImuWorldFA = rotateVectorByQuaternion(qCurrentFA, calibData.faBoneLocalDir);
      const worldDirFA     = normalize3(matVec3(calibData.R_fa, { x: boneImuWorldFA[0], y: boneImuWorldFA[1], z: boneImuWorldFA[2] }));
      const faLength    = calibData.faLengthMm;

      reconWrist = {
        x: reconElbow.x + faLength * worldDirFA.x,
        y: reconElbow.y + faLength * worldDirFA.y,
        z: reconElbow.z + faLength * worldDirFA.z,
      };

      const stereoFADir = (elbowOk && wristOk && elbow && wrist)
        ? normalize3({ x: wrist.x-elbow.x, y: wrist.y-elbow.y, z: wrist.z-elbow.z })
        : null;

      // Elbow angle: diagnostic angle between UA and FA world directions
      const elbowAngleDeg = angleBetweenDeg(worldDirUA, worldDirFA);

      faDebug = {
        qCurrent:      qCurrentFA,
        boneLocalDir:  calibData.faBoneLocalDir,
        worldDir:      [worldDirFA.x, worldDirFA.y, worldDirFA.z],
        calibLength:   faLength,
        reconPos:      reconWrist,
        stereoPos:     stereoWrist ? { ...stereoWrist } : null,
        posError:      stereoWrist ? dist3D(reconWrist, stereoWrist) : null,
        angError:      stereoFADir ? angleBetweenDeg(worldDirFA, stereoFADir) : null,
        elbowAngleDeg,
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

  // ── Calibration controls ──────────────────────────────────────────────────────
  const imu01Online = imuStates['imu_01']?.health === 'online';
  const imu02Online = imuStates['imu_02']?.health === 'online';
  const rightArmVisible = !!(
    displayPose['rightShoulder'] && displayPose['rightElbow'] && displayPose['rightWrist']
  );
  const stereoReliable = trackedCountRef.current >= 3;
  const canCalibrate = imu01Online && imu02Online && rightArmVisible && stereoReliable && bothCamerasActive;
  const calibInProgress = ['countdown1','collecting1','countdown2','collecting2',
    'countdown3','collecting3'].includes(calibStatus);

  const startCalibration = useCallback(() => {
    pose1FramesRef.current = []; pose2FramesRef.current = []; pose3FramesRef.current = [];
    setPose1Frames([]); setPose2Frames([]); setPose3Frames([]);
    lastReliableRef.current          = null;
    lastAcceptedTimestampRef.current = -1;
    stabilityWindowRef.current       = [];
    pose1AvgDirsRef.current          = null;
    calibSampleDiagRef.current       = null;
    setCalibSampleDiag(null);
    setCalibStatus('countdown1');
  }, []);

  const clearCalibration = useCallback(() => {
    pose1FramesRef.current = []; pose2FramesRef.current = []; pose3FramesRef.current = [];
    setPose1Frames([]); setPose2Frames([]); setPose3Frames([]);
    setArmCalibration(null);
    setCalibStatus('idle');
    imuReconPoseRef.current  = null;
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

  // ── Debug helpers ─────────────────────────────────────────────────────────────
  function SegmentDebugSection({ label, d, color }: { label: string; d: SegmentReconDebug; color: string }) {
    const fmt3 = (v: Vec3 | null) =>
      v ? `${v[0].toFixed(4)}  ${v[1].toFixed(4)}  ${v[2].toFixed(4)}` : '—';
    const fmtVec = (v: {x:number;y:number;z:number} | null) =>
      v ? `x${v.x.toFixed(1)} y${v.y.toFixed(1)} z${v.z.toFixed(1)}` : '—';
    const rows: [string, string][] = [
      ['q current',       d.qCurrent ? d.qCurrent.map(fmtQ).join('  ') : '—'],
      ['bone local dir',  fmt3(d.boneLocalDir)],
      ['world dir',       fmt3(d.worldDir)],
      ['calib length',    d.calibLength !== null ? `${d.calibLength.toFixed(1)} mm` : '—'],
      ['recon pos',       fmtVec(d.reconPos)],
      ['stereo pos',      fmtVec(d.stereoPos)],
      ['pos error',       fmtMm(d.posError)],
      ['ang error',       d.angError !== null ? fmtDeg(d.angError) : '—'],
      ...(d.elbowAngleDeg !== null
        ? [['elbow angle (diag)', fmtDeg(d.elbowAngleDeg)] as [string, string]]
        : []),
    ];
    return (
      <div>
        <p className="text-gray-500 font-semibold uppercase tracking-wide mb-2">{label}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
          {rows.map(([lbl, val]) => (
            <div key={lbl} className="flex items-start gap-2">
              <span className="text-gray-500 shrink-0 w-36">{lbl}</span>
              <span className={`${color} font-mono`}>{val}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Pose progress helpers ─────────────────────────────────────────────────────
  const poseFrameCounts = [pose1Frames.length, pose2Frames.length, pose3Frames.length];

  // Which pose index (0-based) is currently active?
  const activePoseIdx = calibStatus.startsWith('countdown') || calibStatus.startsWith('collecting')
    ? parseInt(calibStatus.slice(-1)) - 1
    : -1;

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
          </div>
          <p className="text-gray-400 text-sm mt-1">
            Phase C · 4-pose sensor-to-bone calibration · absolute quaternion reconstruction
          </p>
          <p className="text-gray-600 text-xs mt-0.5">
            Right shoulder must remain visible — IMU fills occluded elbow / wrist from the shoulder anchor
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
          does not fire on hidden elements.
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

            {/* IMU Connection */}
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
                <Button variant="outline" size="sm" onClick={reconnectIMU} className="border-gray-600">
                  <RefreshCw className="h-4 w-4 mr-2" /> Reconnect
                </Button>
              </div>
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
              <h3 className="text-sm font-semibold text-white mb-1">Right Arm Calibration</h3>
              <p className="text-xs text-gray-500 mb-4">
                3-pose sensor-to-bone calibration with IMU-to-stereo frame alignment. Each pose teaches the fixed alignment between each IMU and its bone.
              </p>

              {/* Prerequisites */}
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

              {/* 3-pose progress strip */}
              {calibInProgress && (
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  {POSE_META.map((p, i) => {
                    const frames = poseFrameCounts[i];
                    const isDone = frames >= CALIBRATION_FRAMES_NEEDED;
                    const isActive = activePoseIdx === i;
                    const colorClasses = isActive
                      ? p.stripActive
                      : isDone
                      ? 'border-green-800 bg-green-900/20 text-green-400'
                      : 'border-gray-700 bg-gray-800/40 text-gray-600';
                    return (
                      <div key={p.num} className="flex items-center gap-1.5">
                        <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs ${colorClasses}`}>
                          <span className="font-bold">{p.num}</span>
                          <span className="hidden sm:inline">{p.name}</span>
                          {isDone && <span className="ml-1 text-green-400">✓</span>}
                          {isActive && <span className="ml-1 tabular-nums">({frames}/{CALIBRATION_FRAMES_NEEDED})</span>}
                        </div>
                        {i < 2 && <span className="text-gray-600">→</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Per-pose countdown / collecting UI */}
              {POSE_META.map((p, i) => {
                const poseNum = i + 1;
                const countdownStatus = `countdown${poseNum}` as CalibStatus;
                const collectingStatus = `collecting${poseNum}` as CalibStatus;
                const frames = poseFrameCounts[i];

                if (calibStatus === countdownStatus) {
                  return (
                    <div key={`cd-${i}`} className={`mb-4 p-4 ${p.cardBg} border rounded flex items-center gap-5`}>
                      <div className={`flex-shrink-0 w-16 h-16 rounded-full ${p.ringBg} border-2 flex items-center justify-center`}>
                        <span className={`text-4xl font-bold ${p.titleCls} tabular-nums leading-none`}>
                          {countdownSec}
                        </span>
                      </div>
                      <div>
                        <p className={`text-sm font-semibold ${p.titleCls} mb-1`}>{p.title}</p>
                        <p className={`text-xs ${p.bodyCls} leading-relaxed whitespace-pre-line`}>
                          {p.body}
                        </p>
                      </div>
                    </div>
                  );
                }

                if (calibStatus === collectingStatus) {
                  const diag = calibSampleDiag;
                  return (
                    <div key={`col-${i}`} className={`mb-4 p-3 ${p.cardBg} border rounded`}>
                      <p className={`text-sm ${p.titleCls} font-semibold mb-1`}>{p.title} — Capturing</p>
                      {diag?.rejectionReason && (
                        <p className="text-xs text-red-400 mb-2 font-medium">{diag.rejectionReason}</p>
                      )}
                      {(!diag?.rejectionReason) && (
                        <p className={`text-xs ${p.bodyCls} mb-2`}>Hold still. Collecting stable frames.</p>
                      )}
                      <div className="flex items-center gap-3 mb-3">
                        <div className="flex-1 bg-gray-800 rounded-full h-2">
                          <div className={`${p.barCls} h-2 rounded-full transition-all`}
                            style={{ width: `${Math.min(100, (frames / CALIBRATION_FRAMES_NEEDED) * 100)}%` }} />
                        </div>
                        <span className={`text-xs ${p.titleCls} tabular-nums`}>
                          {frames} / {CALIBRATION_FRAMES_NEEDED}
                        </span>
                      </div>
                      {diag && (
                        <div className="border-t border-gray-700/50 pt-2 mt-1 space-y-1.5">
                          {/* Status indicators */}
                          <div className="flex flex-wrap gap-2">
                            {[
                              { label: 'Pose valid',  ok: diag.isPoseValid },
                              { label: 'Stable',      ok: diag.isStable },
                            ].map(({ label, ok }) => (
                              <span key={label} className={`text-xs px-2 py-0.5 rounded-full font-semibold
                                ${ok ? 'bg-green-900/40 border border-green-700 text-green-300' : 'bg-red-900/30 border border-red-800 text-red-400'}`}>
                                {ok ? '✓' : '✗'} {label}
                              </span>
                            ))}
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800/60 border border-gray-700 text-gray-400 tabular-nums">
                              ✓ {diag.acceptedFrames}  ✗ {diag.rejectedFrames}
                            </span>
                          </div>
                          {/* Freshness + stability metrics */}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs font-mono">
                            {[
                              ['Stereo age', `${diag.stereoAgeMs}ms`,          diag.stereoAgeMs < 150],
                              ['imu_01 age', `${diag.imu01AgeMs}ms`,            diag.imu01AgeMs  < 150],
                              ['imu_02 age', `${diag.imu02AgeMs}ms`,            diag.imu02AgeMs  < 150],
                              ['UA spread',  `${diag.uaAngularSpreadDeg.toFixed(1)}°`,   diag.uaAngularSpreadDeg < STABILITY_ANGLE_SPREAD_DEG],
                              ['FA spread',  `${diag.faAngularSpreadDeg.toFixed(1)}°`,   diag.faAngularSpreadDeg < STABILITY_ANGLE_SPREAD_DEG],
                              ['UA length',  `${diag.currentUaLenMm.toFixed(0)}mm ±${diag.runningUaStdDevMm.toFixed(1)}`, diag.runningUaStdDevMm < STABILITY_LENGTH_STDDEV_MM],
                              ['FA length',  `${diag.currentFaLenMm.toFixed(0)}mm ±${diag.runningFaStdDevMm.toFixed(1)}`, diag.runningFaStdDevMm < STABILITY_LENGTH_STDDEV_MM],
                              ['Window',     `${diag.windowFrameCount}/${STABILITY_WINDOW}`, diag.windowFrameCount >= STABILITY_WINDOW],
                            ].map(([label, val, ok]) => (
                              <div key={String(label)} className="flex justify-between gap-2">
                                <span className="text-gray-600">{label}</span>
                                <span className={String(ok) === 'true' ? 'text-gray-300' : 'text-yellow-400'}>{val}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }

                return null;
              })}

              {/* Calibration results */}
              {armCalibration && (() => {
                const v = armCalibration.validation;
                const qs = {
                  good:    { border: 'border-green-700',  bg: 'bg-green-900/20',  badge: 'bg-green-700',  text: 'text-green-300' },
                  warning: { border: 'border-yellow-700', bg: 'bg-yellow-900/20', badge: 'bg-yellow-700', text: 'text-yellow-300' },
                  failed:  { border: 'border-red-700',    bg: 'bg-red-900/20',    badge: 'bg-red-800',    text: 'text-red-300' },
                }[armCalibration.quality];
                const fmtLen = (mm: number) => `${(mm / 10).toFixed(1)} cm  (${mm.toFixed(1)} mm)`;
                const fmtStd = (mm: number) => `±${mm.toFixed(2)} mm`;
                const poseFrameCts = armCalibration.poses.map(p => p.framesUsed);
                const resDeg = (d: number) => {
                  const cls = d > 20 ? 'text-red-400' : d > 10 ? 'text-yellow-400' : 'text-green-400';
                  return <span className={`${cls} font-mono tabular-nums`}>{d.toFixed(1)}°</span>;
                };
                return (
                  <div className={`mb-4 p-4 ${qs.bg} border ${qs.border} rounded-lg`}>
                    <div className="flex items-center justify-between mb-3">
                      <p className={`text-sm font-semibold ${qs.text}`}>Calibration Results</p>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold text-white ${qs.badge}`}>
                          {armCalibration.quality.toUpperCase()}
                        </span>
                        <span className="text-xs text-gray-500">{new Date(armCalibration.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>

                    {/* Segment lengths */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs mb-4">
                      {[
                        { label: 'Upper Arm (imu_01)', len: armCalibration.uaLengthMm, stdDev: armCalibration.uaLengthStdDevMm },
                        { label: 'Forearm (imu_02)',   len: armCalibration.faLengthMm, stdDev: armCalibration.faLengthStdDevMm },
                      ].map(({ label, len, stdDev }) => (
                        <div key={label} className="space-y-1">
                          <p className="text-gray-400 font-semibold uppercase tracking-wide text-xs mb-1">{label}</p>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Length</span>
                            <span className="tabular-nums text-white font-mono">{fmtLen(len)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Std Dev</span>
                            <span className={`tabular-nums font-mono ${stdDev > 50 ? 'text-red-400' : stdDev > 20 ? 'text-yellow-400' : 'text-green-400'}`}>
                              {fmtStd(stdDev)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Calibration residuals */}
                    <div className="border-t border-gray-700 pt-3 mt-1">
                      <p className="text-xs text-gray-400 font-semibold mb-2">Calibration Consistency Residuals</p>
                      <p className="text-xs text-gray-600 mb-2 italic">
                        Each stored pose quaternion replayed through the estimated model vs recorded stereo direction.
                        Good: &lt;10°  Warning: 10–25°  Failed: &gt;25°
                      </p>
                      <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                        {[0,1,2].map(i => (
                          <div key={i} className="bg-gray-800/60 rounded p-2 space-y-1">
                            <p className="text-gray-500 font-semibold">Pose {i+1}</p>
                            <div className="flex justify-between">
                              <span className="text-gray-600">UA</span>
                              {resDeg([v.pose1UaResidualDeg, v.pose2UaResidualDeg, v.pose3UaResidualDeg][i])}
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">FA</span>
                              {resDeg([v.pose1FaResidualDeg, v.pose2FaResidualDeg, v.pose3FaResidualDeg][i])}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="bg-gray-800/60 rounded p-2">
                          <div className="text-gray-500 mb-0.5">Mean UA</div>
                          {resDeg(v.meanUaResidualDeg)}
                        </div>
                        <div className="bg-gray-800/60 rounded p-2">
                          <div className="text-gray-500 mb-0.5">Mean FA</div>
                          {resDeg(v.meanFaResidualDeg)}
                        </div>
                        <div className="bg-gray-800/60 rounded p-2">
                          <div className="text-gray-500 mb-0.5">Max</div>
                          {resDeg(v.maxResidualDeg)}
                        </div>
                      </div>

                      {/* Frame alignment quality */}
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {[
                          { label: 'IMU-01 frame aligned', ok: v.alignOkUA },
                          { label: 'IMU-02 frame aligned', ok: v.alignOkFA },
                        ].map(({ label, ok }) => (
                          <div key={label} className={`flex-1 px-3 py-2 rounded text-xs font-semibold ${
                            ok ? 'bg-green-900/30 border border-green-800 text-green-300'
                               : 'bg-red-900/30 border border-red-700 text-red-300'
                          }`}>
                            {ok ? `✓ ${label}` : `✗ ${label} — calibration poses not diverse enough`}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Frames used */}
                    <div className="mt-3 pt-3 border-t border-gray-700 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
                      {poseFrameCts.map((n, i) => (
                        <span key={i}>Pose {i+1}: <span className="text-gray-300">{n} frames</span></span>
                      ))}
                      {armCalibration.error && (
                        <span className="text-red-400 w-full">{armCalibration.error}</span>
                      )}
                      {armCalibration.quality === 'failed' && !armCalibration.error && (
                        <span className="text-red-400 w-full">
                          {(!v.alignOkUA || !v.alignOkFA) ? 'Frame alignment failed — poses are too similar. Hold distinct poses (lateral / forward / forearm-up). ' : ''}
                          {v.maxResidualDeg > 25 ? 'High residuals (>25°) — sensor may have shifted, or poses were not distinct enough. Recalibrate.' : ''}
                        </span>
                      )}
                      {armCalibration.quality === 'warning' && (
                        <span className="text-yellow-500 w-full">
                          Moderate residuals (10–25°) — reconstruction will work but may have some directional error. Stand closer to cameras or hold poses more steadily for better results.
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="flex gap-2">
                <Button
                  onClick={startCalibration}
                  disabled={!canCalibrate || calibInProgress}
                  className="bg-blue-700 hover:bg-blue-600 text-sm"
                  title={!canCalibrate ? 'All conditions must be met' : undefined}
                >
                  {calibInProgress
                    ? `Pose ${activePoseIdx + 1}/4 — ${calibStatus.startsWith('countdown') ? `Get ready… ${countdownSec}` : 'Capturing...'}`
                    : 'Calibrate Right Arm (4-Pose)'}
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
                  <div className="bg-gray-950 rounded-lg border border-gray-800 overflow-x-auto mb-4" style={{ height: 300 }}>
                    <DualArmValidationSVG stereo={stereoArm} validation={validationArm} width={900} height={280} />
                  </div>

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

                  <div>
                    <p className="text-gray-500 font-semibold uppercase tracking-wide mb-2">Live State</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-1.5">
                      {([
                        ['Calibration status', calibStatus],
                        ['Pose frames',        poseFrameCounts.map((n, i) => `P${i+1}:${n}`).join(' ')],
                        ['Joints tracked',     String(trackedCountRef.current)],
                        ['IMU connected',      String(imuConnected)],
                        ['imu_01 status',      imuStates['imu_01']?.health ?? '—'],
                        ['imu_02 status',      imuStates['imu_02']?.health ?? '—'],
                        ['IMU recon active',   imuReconPose ? 'yes' : 'no'],
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

                  {imuReconDebug && (
                    <>
                      <SegmentDebugSection label="IMU Reconstruction — Upper Arm (imu_01)" d={imuReconDebug.ua} color="text-orange-300" />
                      <SegmentDebugSection label="IMU Reconstruction — Forearm (imu_02)" d={imuReconDebug.fa} color="text-orange-300" />
                    </>
                  )}

                  {armCalibration ? (
                    <>
                      <div>
                        <p className="text-gray-500 font-semibold uppercase tracking-wide mb-1">
                          Stored Calibration — Sensor-Frame Bone Directions
                        </p>
                        <p className="text-gray-600 italic mb-2">
                          Fixed bone direction in each IMU sensor frame.
                          Averaged across {armCalibration.poses.reduce((s, p) => s + p.framesUsed, 0)} total frames (4 poses).
                          Never updated at runtime.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
                          {([
                            ['UA bone local dir', armCalibration.uaBoneLocalDir],
                            ['FA bone local dir', armCalibration.faBoneLocalDir],
                          ] as [string, Vec3][]).map(([label, v]) => (
                            <div key={label} className="flex items-start gap-2">
                              <span className="text-gray-500 shrink-0 w-36">{label}</span>
                              <span className="text-blue-300 font-mono">
                                {v[0].toFixed(4)}  {v[1].toFixed(4)}  {v[2].toFixed(4)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-gray-500 font-semibold uppercase tracking-wide mb-2">Stored Calibration — Segment Lengths</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-1.5">
                          {([
                            ['Upper arm', `${armCalibration.uaLengthMm.toFixed(2)} mm`],
                            ['UA std dev', `±${armCalibration.uaLengthStdDevMm.toFixed(2)} mm`],
                            ['Forearm',   `${armCalibration.faLengthMm.toFixed(2)} mm`],
                            ['FA std dev', `±${armCalibration.faLengthStdDevMm.toFixed(2)} mm`],
                          ] as [string, string][]).map(([label, value]) => (
                            <div key={label} className="flex items-start gap-2">
                              <span className="text-gray-500 shrink-0 w-28">{label}</span>
                              <span className="text-blue-300 font-mono">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-gray-500 font-semibold uppercase tracking-wide mb-2">Stored Calibration — Per-Pose Stereo Averages</p>
                        <div className="space-y-2">
                          {armCalibration.poses.map((p, i) => (
                            <div key={i} className="flex flex-wrap gap-x-6 gap-y-0.5 text-xs">
                              <span className="text-gray-500 w-12">Pose {i+1}</span>
                              <span className="text-gray-400">UA: <span className="text-blue-300 font-mono">
                                {p.stereoUA.x.toFixed(3)}  {p.stereoUA.y.toFixed(3)}  {p.stereoUA.z.toFixed(3)}
                              </span></span>
                              <span className="text-gray-400">FA: <span className="text-blue-300 font-mono">
                                {p.stereoFA.x.toFixed(3)}  {p.stereoFA.y.toFixed(3)}  {p.stereoFA.z.toFixed(3)}
                              </span></span>
                              <span className="text-gray-600">{p.framesUsed} frames</span>
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
