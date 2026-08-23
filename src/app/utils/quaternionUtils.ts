/**
 * Quaternion and rotation-matrix utilities for IMU orientation math.
 * Convention: Roll=X, Pitch=Y, Yaw=Z — rotation order Z-Y-X (yaw first).
 * Quaternion layout: [w, x, y, z].
 * All angle inputs in degrees.
 * These functions exist for Phase B+ reconstruction and are not called yet.
 */

export type Quaternion = readonly [number, number, number, number]; // [w, x, y, z]
export type Vec3       = readonly [number, number, number];
export type Mat3x3     = readonly [Vec3, Vec3, Vec3];

const DEG2RAD = Math.PI / 180;

/** Euler angles (degrees) → unit quaternion using Z-Y-X intrinsic rotation order. */
export function eulerToQuaternion(rollDeg: number, pitchDeg: number, yawDeg: number): Quaternion {
  const r = (rollDeg  * DEG2RAD) / 2;
  const p = (pitchDeg * DEG2RAD) / 2;
  const y = (yawDeg   * DEG2RAD) / 2;
  const sr = Math.sin(r), cr = Math.cos(r);
  const sp = Math.sin(p), cp = Math.cos(p);
  const sy = Math.sin(y), cy = Math.cos(y);
  return [
    cr * cp * cy + sr * sp * sy,
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
  ];
}

/** Normalize quaternion to unit length. Safe when magnitude is 0 (returns identity). */
export function normalizeQuaternion(q: Quaternion): Quaternion {
  const mag = Math.sqrt(q[0] ** 2 + q[1] ** 2 + q[2] ** 2 + q[3] ** 2) || 1;
  return [q[0] / mag, q[1] / mag, q[2] / mag, q[3] / mag];
}

/** Inverse of a unit quaternion (= conjugate). */
export function invertQuaternion(q: Quaternion): Quaternion {
  return [q[0], -q[1], -q[2], -q[3]];
}

/** Hamilton product a ⊗ b. */
export function multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

/** Convert unit quaternion to 3×3 rotation matrix (row-major). */
export function quaternionToRotationMatrix(q: Quaternion): Mat3x3 {
  const [w, x, y, z] = q;
  return [
    [1 - 2 * (y * y + z * z),     2 * (x * y - w * z),     2 * (x * z + w * y)],
    [    2 * (x * y + w * z), 1 - 2 * (x * x + z * z),     2 * (y * z - w * x)],
    [    2 * (x * z - w * y),     2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

const RAD2DEG = 180 / Math.PI;

/**
 * Unit quaternion → Euler angles (degrees) using Z-Y-X intrinsic convention.
 * Roll=X, Pitch=Y, Yaw=Z — same convention as eulerToQuaternion.
 * Safe against gimbal lock via asin clamp.
 */
export function quaternionToEuler(q: Quaternion): { rollDeg: number; pitchDeg: number; yawDeg: number } {
  const [w, x, y, z] = normalizeQuaternion(q);
  const rollRad  = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const pitchRad = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))));
  const yawRad   = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return { rollDeg: rollRad * RAD2DEG, pitchDeg: pitchRad * RAD2DEG, yawDeg: yawRad * RAD2DEG };
}

/**
 * Rotate a 3D vector by a unit quaternion using the sandwich product: v' = q ⊗ v ⊗ q*.
 * Uses the optimized cross-product form — no matrix conversion needed.
 */
export function rotateVectorByQuaternion(q: Quaternion, v: Vec3): Vec3 {
  const [w, qx, qy, qz] = q;
  const [vx, vy, vz] = v;
  // t = 2 × cross(q_vec, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  // v' = v + w×t + cross(q_vec, t)
  return [
    vx + w * tx + qy * tz - qz * ty,
    vy + w * ty + qz * tx - qx * tz,
    vz + w * tz + qx * ty - qy * tx,
  ];
}

/**
 * Average an array of unit quaternions, handling sign ambiguity (q ≡ -q).
 * Uses the first quaternion as reference for sign alignment, then normalizes.
 */
export function averageQuaternions(quats: Quaternion[]): Quaternion {
  if (quats.length === 0) return [1, 0, 0, 0];
  const ref = quats[0];
  let sw = 0, sx = 0, sy = 0, sz = 0;
  for (const q of quats) {
    const dot = ref[0] * q[0] + ref[1] * q[1] + ref[2] * q[2] + ref[3] * q[3];
    const sign = dot < 0 ? -1 : 1;
    sw += sign * q[0]; sx += sign * q[1]; sy += sign * q[2]; sz += sign * q[3];
  }
  return normalizeQuaternion([sw, sx, sy, sz]);
}
