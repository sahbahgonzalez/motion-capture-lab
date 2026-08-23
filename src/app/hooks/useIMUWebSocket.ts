import { useState, useEffect, useRef, useCallback } from 'react';

// ── Packet types ──────────────────────────────────────────────────────────────

export interface IMUPacket {
  sensor_id: string;
  timestamp_us: number;
  sequence: number;
  accuracy: number;

  qw: number;
  qx: number;
  qy: number;
  qz: number;

  receiver_time_ns: number;
  receiver_time_utc: string;
}

export type IMUHealthStatus = 'online' | 'stale' | 'offline';

export interface IMUState {
  id: string;
  latest: IMUPacket | null;
  health: IMUHealthStatus;

  /** Packets per second, averaged over the last 2 seconds. */
  packetRate: number;

  /** performance.now() when the last packet was received by the browser. */
  lastReceivedAt: number;
}

// ── Sensor registry ───────────────────────────────────────────────────────────

export const IMU_IDS = [
  'imu_01',
  'imu_02',
  'imu_03',
  'imu_04',
  'imu_05',
  'imu_06',
  'imu_07',
  'imu_08',
] as const;

export type IMUId = typeof IMU_IDS[number];

export const IMU_SEGMENT: Record<string, string> = {
  imu_01: 'Upper Right Arm',
  imu_02: 'Lower Right Arm / Forearm',
};

// ── Internal hot-path store ───────────────────────────────────────────────────

interface IMURawData {
  latest: IMUPacket | null;
  lastReceivedAt: number;
  timestamps: number[];
}

function makeRaw(): IMURawData {
  return {
    latest: null,
    lastReceivedAt: 0,
    timestamps: [],
  };
}

function computeHealth(lastReceivedAt: number): IMUHealthStatus {
  if (lastReceivedAt === 0) return 'offline';

  const ageMs = performance.now() - lastReceivedAt;

  if (ageMs < 500) return 'online';
  if (ageMs < 1500) return 'stale';

  return 'offline';
}

// ── Packet validation ─────────────────────────────────────────────────────────

function safeParsePacket(raw: unknown): IMUPacket | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const d = raw as Record<string, unknown>;

  if (typeof d.sensor_id !== 'string') {
    return null;
  }

  const qw = typeof d.qw === 'number' ? d.qw : null;
  const qx = typeof d.qx === 'number' ? d.qx : null;
  const qy = typeof d.qy === 'number' ? d.qy : null;
  const qz = typeof d.qz === 'number' ? d.qz : null;

  if (
    qw === null ||
    qx === null ||
    qy === null ||
    qz === null
  ) {
    return null;
  }

  if (
    !Number.isFinite(qw) ||
    !Number.isFinite(qx) ||
    !Number.isFinite(qy) ||
    !Number.isFinite(qz)
  ) {
    return null;
  }

  const magnitude = Math.sqrt(
    qw * qw +
    qx * qx +
    qy * qy +
    qz * qz
  );

  if (magnitude <= 0.000001) {
    return null;
  }

  return {
    sensor_id: d.sensor_id,

    timestamp_us:
      typeof d.timestamp_us === 'number'
        ? d.timestamp_us
        : 0,

    sequence:
      typeof d.sequence === 'number'
        ? d.sequence
        : 0,

    accuracy:
      typeof d.accuracy === 'number'
        ? d.accuracy
        : 0,

    // Normalize quaternion before storing.
    qw: qw / magnitude,
    qx: qx / magnitude,
    qy: qy / magnitude,
    qz: qz / magnitude,

    receiver_time_ns:
      typeof d.receiver_time_ns === 'number'
        ? d.receiver_time_ns
        : 0,

    receiver_time_utc:
      typeof d.receiver_time_utc === 'string'
        ? d.receiver_time_utc
        : '',
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useIMUWebSocket(
  url: string = 'ws://localhost:8765'
) {
  const wsRef = useRef<WebSocket | null>(null);

  const rawRef = useRef<Record<string, IMURawData>>(
    Object.fromEntries(
      IMU_IDS.map(id => [id, makeRaw()])
    )
  );

  const [connected, setConnected] = useState(false);

  const [imuStates, setImuStates] = useState<
    Record<string, IMUState>
  >(
    () =>
      Object.fromEntries(
        IMU_IDS.map(id => [
          id,
          {
            id,
            latest: null,
            health: 'offline',
            packetRate: 0,
            lastReceivedAt: 0,
          },
        ])
      )
  );

  const connect = useCallback(() => {
    wsRef.current?.close();

    for (const id of IMU_IDS) {
      rawRef.current[id] = makeRaw();
    }

    let ws: WebSocket;

    try {
      ws = new WebSocket(url);
    } catch {
      setConnected(false);
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setConnected(false);
    };

    ws.onmessage = event => {
      try {
        const parsed = JSON.parse(event.data as string);

        const packet = safeParsePacket(parsed);

        if (!packet) {
          return;
        }

        const id = packet.sensor_id;

        if (!(id in rawRef.current)) {
          return;
        }

        const now = performance.now();

        const entry = rawRef.current[id];

        entry.latest = packet;
        entry.lastReceivedAt = now;

        entry.timestamps.push(now);

        const cutoff = now - 2000;

        entry.timestamps =
          entry.timestamps.filter(
            timestamp => timestamp > cutoff
          );

      } catch {
        // Ignore malformed packets.
      }
    };
  }, [url]);

  // Connect on mount.
  useEffect(() => {
    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  // Push React state at approximately 10 Hz.
  useEffect(() => {
    const interval = setInterval(() => {
      setImuStates(
        Object.fromEntries(
          IMU_IDS.map(imuId => {
            const raw = rawRef.current[imuId];

            return [
              imuId,
              {
                id: imuId,
                latest: raw.latest,
                health: computeHealth(
                  raw.lastReceivedAt
                ),
                packetRate:
                  raw.timestamps.length / 2,
                lastReceivedAt:
                  raw.lastReceivedAt,
              },
            ];
          })
        )
      );
    }, 100);

    return () => {
      clearInterval(interval);
    };
  }, []);

  /**
   * Direct access to high-frequency IMU data without
   * causing React re-renders.
   */
  const getRawIMU = useCallback(
    (imuId: string): IMURawData | null => {
      return rawRef.current[imuId] ?? null;
    },
    []
  );

  return {
    connected,
    imuStates,
    reconnect: connect,
    getRawIMU,
  };
}