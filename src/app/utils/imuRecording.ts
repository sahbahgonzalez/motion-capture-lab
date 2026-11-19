import type {
  IMUConnectionEvent, IMUConnectionSnapshot, IMURawMessage, IMURecordingContext,
  IMURecordingDiagnostics, IMURecordingHandle, IMURecordingSidecars, IMURecordingSource,
  RecordedIMUPacket, RecordedIMUSensorId, UnassignedIMUMessage,
} from '../type/imuRecording';

const SENSORS = ['imu_01', 'imu_02'] as const;
const GAP_MS = 100;

function summarize(packets: RecordedIMUPacket[], duration: number, events: IMUConnectionEvent[], unassigned: number): IMURecordingDiagnostics {
  const first = packets[0], last = packets.at(-1);
  const gaps: IMURecordingDiagnostics['receiptTimingGaps'] = [];
  let duplicates = 0, outOfOrder = 0, resets = 0, missing = 0, ambiguous = false;
  let high: number | null = null, sensorTime: number | null = null;
  let connection: string | null | undefined;
  let seen = new Set<number>();
  for (let i = 0; i < packets.length; i++) {
    const packet = packets[i];
    if (i > 0) {
      const previous = packets[i - 1];
      const gap = packet.experimentReceiveTimeMs - previous.experimentReceiveTimeMs;
      if (gap >= GAP_MS) gaps.push({afterPacketId: previous.packetId, beforePacketId: packet.packetId, gapMs: gap});
    }
    if (packet.connectionId !== connection) {
      connection = packet.connectionId; high = null; sensorTime = null; seen = new Set();
    }
    const sequence = packet.sequence;
    if (sequence === null) { ambiguous = true; high = null; seen.clear(); continue; }
    const duplicate = seen.has(sequence);
    const backwards = high !== null && sequence < high;
    if (duplicate) duplicates++;
    else if (backwards) { outOfOrder++; ambiguous = true; }
    // Counter rollback and reordering cannot be conclusively distinguished from a sensor reboot.
    if (sensorTime !== null && packet.sensorTimestampUs !== null && packet.sensorTimestampUs < sensorTime) {
      resets++; ambiguous = true; high = null; seen.clear();
    } else if (!duplicate && high !== null && sequence > high + 1) missing += sequence - high - 1;
    seen.add(sequence);
    high = high === null ? sequence : Math.max(high, sequence);
    if (packet.sensorTimestampUs !== null) sensorTime = packet.sensorTimestampUs;
  }
  const elapsed = first && last ? last.experimentReceiveTimeMs - first.experimentReceiveTimeMs : 0;
  return {
    packetCount: packets.length,
    validPacketCount: packets.filter(p => p.validity.valid).length,
    invalidPacketCount: packets.filter(p => !p.validity.valid).length,
    firstExperimentReceiveTimeMs: first?.experimentReceiveTimeMs ?? null,
    lastExperimentReceiveTimeMs: last?.experimentReceiveTimeMs ?? null,
    observedReceiptRateHz: packets.length > 1 && elapsed > 0 ? (packets.length - 1) * 1000 / elapsed : null,
    receiptGapThresholdMs: GAP_MS, receiptTimingGaps: gaps,
    startToFirstPacketMs: first?.experimentReceiveTimeMs ?? null,
    lastPacketToStopMs: last ? Math.max(0, duration - last.experimentReceiveTimeMs) : null,
    duplicateSequenceCount: duplicates, outOfOrderSequenceCount: outOfOrder, sequenceResetOrWrapCount: resets,
    inferredForwardMissingSequenceCount: missing,
    missingSequenceCount: packets.length === 0 || ambiguous ? null : missing,
    missingSequenceCountLimitation: 'Inferred only between observed valid counters in a connection epoch; no estimate before first/after last packet or across reconnects. Null for empty streams, invalid sequences, counter rollback or reordering; forward gaps are not proof of transport loss.',
    connectionInterruptionCount: events.filter(e => e.interruption).length,
    unassignedMessageCount: unassigned,
  };
}

/** Read the last top-level receiver timestamp from its JSON lexeme, never a rounded Number.
 * Tokenize strings/containers so nested fields, escaped quotes and duplicate keys follow JSON semantics.
 * Called only after JSON syntax validation; the original message remains untouched.
 */
function exactReceiverTimeNs(text: string): string | null {
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]|true|false|null/g) ?? [];
  let depth = 0;
  let value: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '{' || token === '[') depth++;
    else if (token === '}' || token === ']') depth--;
    else if (depth === 1 && token.startsWith('"') && tokens[i + 1] === ':'
      && JSON.parse(token) === 'receiver_time_ns') {
      const raw = tokens[i + 2];
      const decimal = raw?.startsWith('"') ? JSON.parse(raw) as string : raw;
      value = typeof decimal === 'string' && /^\d+$/.test(decimal) ? decimal : null;
    }
  }
  return value;
}

function decode(data: unknown): {raw: IMURawMessage; parsed: unknown; receiverTimeNs?: string | null; reason?: string} {
  let text: string | null = typeof data === 'string' ? data : null;
  let hex: string | undefined;
  if (data instanceof ArrayBuffer) {
    const bytes = new Uint8Array(data);
    hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    text = new TextDecoder().decode(bytes);
  }
  const raw: IMURawMessage = {rawMessage: text, rawDataType: typeof data === 'string' ? 'text' : data instanceof ArrayBuffer ? 'arraybuffer' : typeof data, rawFields: null};
  if (hex !== undefined) raw.rawBinaryHex = hex;
  if (text === null) return {raw, parsed: null, reason: 'Unsupported WebSocket message type.'};
  try {
    const parsed: unknown = JSON.parse(text);
    // Keep legacy live parsing unchanged; archival validation uses the original lexeme instead.
    const receiverTimeNs = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && Object.hasOwn(parsed, 'receiver_time_ns') ? exactReceiverTimeNs(text) : null;
    raw.rawFields = receiverTimeNs === null ? parsed : {...parsed as Record<string, unknown>, receiver_time_ns: receiverTimeNs};
    return {raw, parsed, receiverTimeNs};
  } catch { return {raw, parsed: null, reason: 'Malformed JSON.'}; }
}

/** Archives at ingress; no React state, inference, normalization, or fusion dependency. */
export function createIMURecordingSource() {
  let connection: IMUConnectionSnapshot = {state: 'disconnected', connectionId: null, url: null};
  let active: {
    context: IMURecordingContext;
    connectionAtStart: IMUConnectionSnapshot;
    packets: Record<RecordedIMUSensorId, RecordedIMUPacket[]>;
    unassigned: UnassignedIMUMessage[];
    events: IMUConnectionEvent[];
  } | null = null;

  const source: IMURecordingSource = {
    start(context) {
      if (active) throw new Error('An IMU recording is already active.');
      // No caller-owned mutable clock/configuration objects enter an active archive.
      const snapshot: IMURecordingContext = structuredClone(context);
      const session = {context: snapshot, connectionAtStart: {...connection}, packets: {imu_01: [], imu_02: []} as Record<RecordedIMUSensorId, RecordedIMUPacket[]>, unassigned: [] as UnassignedIMUMessage[], events: [] as IMUConnectionEvent[]};
      active = session;
      let result: IMURecordingSidecars | null = null;
      const handle: IMURecordingHandle = {
        getProgress() {
          return {
            recordingId: snapshot.recordingId,
            streams: Object.fromEntries(SENSORS.map(sensor => [sensor, {
              packetCount: session.packets[sensor].length,
              firstValidExperimentTimeMs: session.packets[sensor].find(p => p.validity.valid)?.experimentReceiveTimeMs ?? null,
              lastReceiptPerformanceNowMs: session.packets[sensor].at(-1)?.browserReceiverTimestamp.performanceNowMs ?? null,
            }])) as import('../type/imuRecording').IMURecordingProgress['streams'],
          };
        },
        stop(boundary) {
          if (result) return result;
          if (active === session) active = null; // Stop synchronously, before encoder finalization.
          const durationMs = Math.max(0, boundary.endPerformanceNowMs - snapshot.experimentStartPerformanceNowMs);
          result = Object.fromEntries(SENSORS.map(sensorId => [sensorId, {
            ...snapshot, schemaVersion: '1.0.0-imu-recording', sensorId,
            segment: sensorId === 'imu_01' ? 'right_upper_arm' : 'right_forearm',
            endPerformanceNowMs: boundary.endPerformanceNowMs, durationMs, stopReason: boundary.reason,
            status: session.packets[sensorId].length ? 'recorded' : 'empty', quaternionOrdering: 'wxyz',
            clockDefinitions: {
              browserReceiptSource: 'performance.now',
              experimentReceiveTimeDefinition: 'browser_receipt_minus_shared_camera_origin_ms',
              sensorTimestampField: 'timestamp_us', sensorTimestampUnit: 'microseconds',
              sensorClockOrigin: 'unknown', upstreamReceiverClock: 'unverified',
              hardwareClockSynchronizationVerified: false,
            },
            connectionAtStart: session.connectionAtStart,
            connectionEvents: session.events, packets: session.packets[sensorId], unassignedMessages: session.unassigned,
            diagnostics: summarize(session.packets[sensorId], durationMs, session.events, session.unassigned.length),
            limitations: [
              'Browser receipt timestamps do not establish sensor sampling time or hardware clock synchronization.',
              'ESP32 timestamp origin, rollover and reboot semantics are unverified; no sensor-to-browser clock offset is estimated.',
              'All attributable received messages are retained, including invalid metadata/quaternions. Unattributable messages appear in a shared log, not either sensor packet count.',
              'Sequence diagnostics are conservative inferred counter gaps, not confirmed device or network packet loss.',
              'Disconnected/silent sensors can produce empty streams. Receipt gaps do not identify their physical cause.',
              'Raw JSON text is authoritative for original fields, including numeric lexemes beyond JavaScript integer precision.',
              'Data is buffered in memory until downloaded; navigation or browser failure does not persist it.',
            ],
          }])) as IMURecordingSidecars;
          return result;
        },
      };
      return handle;
    },
  };

  return {
    source,
    connectionEvent(type: IMUConnectionEvent['type'], next: IMUConnectionSnapshot, now: number, detail?: string) {
      const interruption = connection.state === 'open' && next.state !== 'open';
      connection = {...next};
      const session = active;
      if (session) session.events.push({...next, type, browserReceiptPerformanceNowMs: now,
        experimentTimeMs: now - session.context.experimentStartPerformanceNowMs, interruption, detail});
    },
    receive(data: unknown, now: number, wallClockMs: number): unknown {
      const decoded = decode(data);
      const session = active;
      if (!session) return decoded.parsed; // Live processing still receives every parseable message.
      const time = now - session.context.experimentStartPerformanceNowMs;
      const d = decoded.parsed && typeof decoded.parsed === 'object' && !Array.isArray(decoded.parsed)
        ? decoded.parsed as Record<string, unknown> : null;
      const sensorId = d?.sensor_id;
      if (sensorId !== 'imu_01' && sensorId !== 'imu_02') {
        session.unassigned.push({...decoded.raw, browserReceiptPerformanceNowMs: now, browserReceiptWallClockMs: wallClockMs,
          experimentReceiveTimeMs: time, connectionId: connection.connectionId,
          reason: decoded.reason ?? 'Missing, invalid, or unsupported sensor_id.'});
        return decoded.parsed;
      }
      const fields = d!;
      const validity: RecordedIMUPacket['metadataValidity'] = {timestamp_us: 'missing', sequence: 'missing', accuracy: 'missing', quaternion: 'missing', receiver_time_ns: 'missing', receiver_time_utc: 'missing'};
      const issues: string[] = [];
      const number = (key: 'timestamp_us' | 'sequence' | 'accuracy') => {
        const value = fields[key];
        const valid = typeof value === 'number' && Number.isFinite(value)
          && (key === 'accuracy' || (Number.isSafeInteger(value) && value >= 0));
        validity[key] = valid ? 'valid' : Object.hasOwn(fields, key) ? 'invalid' : 'missing';
        if (!valid) issues.push(key + ': ' + validity[key]);
        return valid ? value as number : null;
      };
      const sensorTimestampUs = number('timestamp_us'), sequence = number('sequence'), accuracy = number('accuracy');
      const q = ['qw','qx','qy','qz'].map(k => fields[k]);
      const numeric = q.every(v => typeof v === 'number' && Number.isFinite(v));
      const norm = numeric ? Math.hypot(...q as number[]) : 0;
      const quaternionValid = numeric && Number.isFinite(norm) && norm > 0.000001;
      validity.quaternion = quaternionValid ? 'valid' : ['qw','qx','qy','qz'].some(k => !Object.hasOwn(fields,k)) ? 'missing' : 'invalid';
      if (!quaternionValid) issues.push('quaternion: ' + validity.quaternion);
      const coreIssues = [...issues];
      const receiverNsValid = decoded.receiverTimeNs !== null && decoded.receiverTimeNs !== undefined;
      const receiverUtcValid = typeof fields.receiver_time_utc === 'string' && fields.receiver_time_utc.length > 0;
      for (const [key, valid] of [['receiver_time_ns', receiverNsValid], ['receiver_time_utc', receiverUtcValid]] as const) {
        validity[key] = valid ? 'valid' : Object.hasOwn(fields, key) ? 'invalid' : 'missing';
        // Upstream receiver metadata is optional, but malformed supplied values remain explicit.
        if (validity[key] === 'invalid') issues.push(key + ': invalid');
      }
      session.packets[sensorId].push({
        ...decoded.raw, packetId: session.context.recordingId + ':' + sensorId + ':' + session.packets[sensorId].length,
        sensorId, sensorTimestampUs, sequence, accuracy,
        browserReceiverTimestamp: {performanceNowMs: now, wallClockMs,
          ...(receiverNsValid ? {receiverTimeNs: decoded.receiverTimeNs!} : {}),
          ...(receiverUtcValid ? {receiverTimeUtc: fields.receiver_time_utc as string} : {}),
        },
        experimentReceiveTimeMs: time, connectionId: connection.connectionId,
        normalizedQuaternion: quaternionValid ? {w: (q[0] as number)/norm, x: (q[1] as number)/norm, y: (q[2] as number)/norm, z: (q[3] as number)/norm} : null,
        metadataValidity: validity, validationIssues: issues,
        validity: {valid: coreIssues.length === 0, quaternionNormalized: quaternionValid, ...(coreIssues.length ? {rejectionReason: coreIssues.join('; ')} : {})},
        synchronization: {status: 'unverified', method: 'browser_receipt_only'},
      });
      return decoded.parsed;
    },
  };
}
