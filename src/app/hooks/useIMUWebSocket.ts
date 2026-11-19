import { useState, useEffect, useRef, useCallback } from 'react';
import { createIMURecordingSource } from '../utils/imuRecording';

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

  const recordingRef = useRef<ReturnType<typeof createIMURecordingSource> | null>(null);
  if (!recordingRef.current) recordingRef.current = createIMURecordingSource();
  const mountedRef = useRef(true);
  const connectionSequenceRef = useRef(0);
  const connectionIdRef = useRef<string | null>(null);

  const detachAndClose = (ws: WebSocket | null) => {
    if (!ws) return;
    ws.onopen = null; ws.onclose = null; ws.onerror = null; ws.onmessage = null;
    ws.close();
  };

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    const previous = wsRef.current;
    wsRef.current = null; // Invalidate old callbacks before close/replacement.
    const connectionId = 'imu_socket_' + ++connectionSequenceRef.current;
    connectionIdRef.current = connectionId;
    const snapshot = {state: 'connecting' as const, connectionId, url};
    recordingRef.current!.connectionEvent(previous ? 'reconnect' : 'connecting', snapshot, performance.now());
    detachAndClose(previous);
    setConnected(false);
    for (const id of IMU_IDS) rawRef.current[id] = makeRaw();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
    } catch {
      recordingRef.current!.connectionEvent('construction_error', {...snapshot, state: 'error'}, performance.now(), 'WebSocket construction failed.');
      return;
    }
    wsRef.current = ws;
    const current = () => wsRef.current === ws;
    ws.onopen = () => {
      if (!current()) return;
      recordingRef.current!.connectionEvent('open', {...snapshot, state: 'open'}, performance.now());
      setConnected(true);
    };
    ws.onclose = event => {
      if (!current()) return;
      recordingRef.current!.connectionEvent('close', {...snapshot, state: 'closed'}, performance.now(),
        'code=' + event.code + '; reason=' + event.reason + '; clean=' + event.wasClean);
      setConnected(false);
    };
    ws.onerror = () => {
      if (!current()) return;
      recordingRef.current!.connectionEvent('error', {...snapshot, state: 'error'}, performance.now(), 'WebSocket transport error.');
      setConnected(false);
    };
    ws.onmessage = event => {
      const now = performance.now(); // First operation: receipt time, before JSON parsing or validation.
      if (!current()) return;
      const wallClockMs = Date.now();
      const parsed = recordingRef.current!.receive(event.data, now, wallClockMs);
      const packet = safeParsePacket(parsed);
      if (!packet || !Object.hasOwn(rawRef.current, packet.sensor_id)) return;
      const entry = rawRef.current[packet.sensor_id];
      entry.latest = packet;
      entry.lastReceivedAt = now;
      entry.timestamps.push(now);
      entry.timestamps = entry.timestamps.filter(timestamp => timestamp > now - 2000);
    };
  }, [url]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      recordingRef.current!.connectionEvent('unmount', {
        state: 'closed', connectionId: connectionIdRef.current, url,
      }, performance.now());
      const ws = wsRef.current;
      wsRef.current = null;
      detachAndClose(ws);
      // The camera session owns the recording boundary and closes its handle in its cleanup.
    };
  }, [connect, url]);

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
    recordingSource: recordingRef.current.source,
  };
}