import { describe, expect, it } from 'vitest';
import { createIMURecordingSource } from '../../utils/imuRecording';
import { createExperimentClockMetadata } from '../useStereoVideoRecorder';
const context = (id = 'camera-session', origin = 1000) => ({
  recordingId: id, experimentSessionId: 'experiment', experimentStartPerformanceNowMs: origin,
  startTime: 123456, clockMetadata: createExperimentClockMetadata(origin),
});
const packet = (sensor_id = 'imu_01', sequence: unknown = 1, extra = {}) => JSON.stringify({
  sensor_id, sequence, timestamp_us: 100000, accuracy: 3, qw: 2, qx: 0, qy: 0, qz: 0, ...extra,
});
const stop = (handle: ReturnType<ReturnType<typeof createIMURecordingSource>['source']['start']>, time = 2000) => handle.stop({endPerformanceNowMs: time, reason: 'test'});

describe('Stage 2B raw IMU archive', () => {
  it('retains every packet in independent sensor buffers, including bursts', () => {
    const capture = createIMURecordingSource(), handle = capture.source.start(context());
    for (let n = 0; n < 300; n++) capture.receive(packet(n % 2 ? 'imu_02' : 'imu_01', n, {extra: {value: n}}), 1000 + n / 10, 77);
    const r = stop(handle);
    expect(r.imu_01.packets).toHaveLength(150); expect(r.imu_02.packets).toHaveLength(150);
    expect(r.imu_01.packets[149].sequence).toBe(298); expect(r.imu_02.packets[149].sequence).toBe(299);
    expect((r.imu_01.packets[0].rawFields as any).extra).toEqual({value: 0});
    expect(r.imu_01.packets[1].packetId).not.toBe(r.imu_02.packets[1].packetId);
  });
  it('preserves raw quaternions and upstream fields separately from normalized convenience data', () => {
    const c = createIMURecordingSource(), h = c.source.start(context());
    const raw = packet('imu_01', 5, {receiver_time_ns: '1234567890123456789', receiver_time_utc: 'upstream', temperature: 31});
    c.receive(raw, 1000.125, 777);
    const p = stop(h).imu_01.packets[0];
    expect(p.rawMessage).toBe(raw); expect((p.rawFields as any).qw).toBe(2);
    expect(p.normalizedQuaternion).toEqual({w: 1, x: 0, y: 0, z: 0});
    expect((p.rawFields as any).receiver_time_ns).toBe('1234567890123456789');
    expect(p.metadataValidity.receiver_time_ns).toBe('valid');
    expect(p.experimentReceiveTimeMs).toBe(0.125); expect(p.sensorTimestampUs).toBe(100000);
    expect(p.browserReceiverTimestamp).toEqual({performanceNowMs: 1000.125,wallClockMs: 777,receiverTimeNs: '1234567890123456789',receiverTimeUtc: 'upstream'});
  });
  it('keeps missing metadata explicit with null values and missing flags', () => {
    const c = createIMURecordingSource(), h = c.source.start(context());
    c.receive(JSON.stringify({sensor_id: 'imu_01',qw: 1,qx: 0,qy: 0,qz: 0}),1001, 1);
    const p = stop(h).imu_01.packets[0];
    expect(p.sequence).toBeNull(); expect(p.sensorTimestampUs).toBeNull(); expect(p.accuracy).toBeNull();
    expect(p.metadataValidity.sequence).toBe('missing'); expect(p.validity.valid).toBe(false);
    expect((p.rawFields as any).sequence).toBeUndefined();
  });
  it('keeps invalid values in raw fields while marking interpreted metadata invalid', () => {
    const c = createIMURecordingSource(), h = c.source.start(context());
    c.receive(packet('imu_01', -5, {timestamp_us: 'bad',accuracy: null}),1001, 1);
    const r = stop(h).imu_01;
    expect((r.packets[0].rawFields as any).timestamp_us).toBe('bad');
    expect(r.packets[0].metadataValidity).toEqual({timestamp_us: 'invalid',sequence: 'invalid',accuracy: 'invalid',quaternion: 'valid',receiver_time_ns: 'missing',receiver_time_utc: 'missing'});
    expect(r.diagnostics.invalidPacketCount).toBe(1); expect(r.diagnostics.missingSequenceCount).toBeNull();
  });
  it('retains invalid and missing quaternions instead of dropping packets', () => {
    const c = createIMURecordingSource(), h = c.source.start(context());
    c.receive(packet('imu_01', 1, {qw: 0}),1001,1);
    c.receive(JSON.stringify({sensor_id: 'imu_01',sequence: 2,timestamp_us: 100001,accuracy: 3}),1002,2);
    const r = stop(h).imu_01;
    expect(r.packets).toHaveLength(2); expect(r.packets.every(p => p.normalizedQuaternion === null)).toBe(true);
    expect(r.diagnostics.invalidPacketCount).toBe(2);
  });
  it('keeps malformed and unattributable messages in a separate shared log', () => {
    const c = createIMURecordingSource(), h = c.source.start(context());
    for (const raw of ['{bad', '{}', packet('imu_03'), '[]']) c.receive(raw,1005,1);
    const r = stop(h);
    expect(r.imu_01.packets).toHaveLength(0); expect(r.imu_02.packets).toHaveLength(0);
    expect(r.imu_01.unassignedMessages).toHaveLength(4);
    expect(r.imu_01.unassignedMessages[0].rawMessage).toBe('{bad');
    expect(r.imu_01.unassignedMessages[0].reason).toContain('Malformed');
    expect(r.imu_02.diagnostics.unassignedMessageCount).toBe(4);
  });
  it('preserves original binary bytes and decodes UTF-8 JSON synchronously', () => {
    const c = createIMURecordingSource(), h = c.source.start(context());
    const bytes = new TextEncoder().encode(packet()); c.receive(bytes.buffer, 1001,1);
    const p = stop(h).imu_01.packets[0];
    expect(p.rawDataType).toBe('arraybuffer'); expect(p.rawBinaryHex).toHaveLength(bytes.length * 2);
    expect(p.rawMessage).toBe(packet());
  });
  it('computes receipt rates and 100 ms gaps without treating sensor time as browser time', () => {
    const c = createIMURecordingSource(), h = c.source.start(context());
    [1010,1060,1160].forEach((time,i) => c.receive(packet('imu_01', i),time,1));
    const r = stop(h,1200).imu_01;
    expect(r.diagnostics.observedReceiptRateHz).toBeCloseTo(2000/150);
    expect(r.diagnostics.receiptTimingGaps.map(g=>g.gapMs)).toEqual([100]);
    expect(r.diagnostics.startToFirstPacketMs).toBe(10); expect(r.diagnostics.lastPacketToStopMs).toBe(40);
    expect(r.clockDefinitions.hardwareClockSynchronizationVerified).toBe(false);
  });
  it('counts duplicates and inferred missing counters within a connection epoch', () => {
    const c = createIMURecordingSource(), h = c.source.start(context());
    [1,2,4,4].forEach((seq,i)=>c.receive(packet('imu_01',seq),1010+i,1));
    const d = stop(h).imu_01.diagnostics;
    expect(d.duplicateSequenceCount).toBe(1); expect(d.missingSequenceCount).toBe(1);
    expect(d.inferredForwardMissingSequenceCount).toBe(1); expect(d.outOfOrderSequenceCount).toBe(0);
  });
  it('does not present reordered sequences as a reliable loss estimate', () => {
    const c = createIMURecordingSource(), h = c.source.start(context());
    [1,4,2].forEach((seq,i)=>c.receive(packet('imu_01',seq,{timestamp_us: i}),1010+i,1));
    const d = stop(h).imu_01.diagnostics;
    expect(d.outOfOrderSequenceCount).toBe(1); expect(d.missingSequenceCount).toBeNull();
    expect(d.inferredForwardMissingSequenceCount).toBe(2);
  });
  it('reports sensor-clock rollback as an ambiguous reset rather than huge packet loss', () => {
    const c = createIMURecordingSource(), h = c.source.start(context());
    c.receive(packet('imu_01', 100, {timestamp_us: 1000}),1001,1);
    c.receive(packet('imu_01', 0, {timestamp_us: 0}),1002,1);
    const d = stop(h).imu_01.diagnostics;
    expect(d.sequenceResetOrWrapCount).toBe(1); expect(d.outOfOrderSequenceCount).toBe(1);
    expect(d.missingSequenceCount).toBeNull();
  });
  it('separates reconnection epochs and records one interruption for error then close', () => {
    const c = createIMURecordingSource();
    c.connectionEvent('open',{state: 'open',connectionId: 'old',url: 'ws://test'},900);
    const h = c.source.start(context());
    c.receive(packet('imu_01', 100),1001,1);
    c.connectionEvent('error',{state: 'error',connectionId: 'old',url: 'ws://test'},1010);
    c.connectionEvent('close',{state: 'closed',connectionId: 'old',url: 'ws://test'},1011);
    c.connectionEvent('open',{state: 'open',connectionId: 'new',url: 'ws://test'},1020);
    c.receive(packet('imu_01', 1),1021,1);
    const r = stop(h).imu_01;
    expect(r.diagnostics.connectionInterruptionCount).toBe(1); expect(r.diagnostics.missingSequenceCount).toBe(0);
    expect(r.connectionEvents).toHaveLength(3); expect(r.connectionAtStart.state).toBe('open');
  });
  it('exports disconnected empty streams without invented packets or zero rates', () => {
    const c = createIMURecordingSource(), h = c.source.start(context());
    const r = stop(h);
    for (const sidecar of Object.values(r)) {
      expect(sidecar.status).toBe('empty'); expect(sidecar.packets).toEqual([]);
      expect(sidecar.diagnostics.observedReceiptRateHz).toBeNull(); expect(sidecar.diagnostics.missingSequenceCount).toBeNull();
      expect(sidecar.connectionAtStart.state).toBe('disconnected');
    }
  });
  it('rejects overlapping starts and isolates repeated-session buffers', () => {
    const c = createIMURecordingSource(), first = c.source.start(context('first'));
    expect(()=>c.source.start(context('overlap'))).toThrow('already active');
    c.receive(packet(),1001,1); const old = stop(first);
    const next = c.source.start(context('second',2000)); c.receive(packet('imu_02'),2001,1);
    expect(stop(first)).toBe(old); const fresh = stop(next,2100);
    expect(old.imu_01.packets).toHaveLength(1); expect(old.imu_02.packets).toHaveLength(0);
    expect(fresh.imu_01.packets).toHaveLength(0); expect(fresh.imu_02.packets[0].experimentReceiveTimeMs).toBe(1);
  });
  it('snapshots caller metadata and ignores messages before/after recording boundaries', () => {
    const c = createIMURecordingSource(), ctx = context();
    c.receive(packet(),990,1); const h = c.source.start(ctx);
    ctx.clockMetadata.relationships.length = 0; ctx.recordingId = 'mutated';
    c.receive(packet(),1001,1); const r = stop(h); const text = JSON.stringify(r);
    c.receive(packet(),2001,1);
    expect(r.imu_01.recordingId).toBe('camera-session'); expect(r.imu_01.clockMetadata.relationships).toHaveLength(2);
    expect(JSON.stringify(r)).toBe(text); expect(JSON.parse(text).imu_01.packets).toHaveLength(1);
  });
  it('retains original numeric lexemes when values exceed JavaScript precision', () => {
    const c = createIMURecordingSource(), h = c.source.start(context());
    const raw = packet().replace('"sequence":1','"sequence":9007199254740993');
    c.receive(raw,1001,1); const r = stop(h).imu_01;
    expect(r.packets[0].sequence).toBeNull(); expect(r.packets[0].rawMessage).toBe(raw);
  });
});


describe('Lossless optional receiver nanoseconds', () => {
  const digits = '1795081234567890123';
  const rawPacket = (token: string, extra = '') => packet('imu_01', 7).replace(/}$/, ',"receiver_time_ns":' + token + extra + '}');
  function record(raw: string) {
    const capture = createIMURecordingSource(), handle = capture.source.start(context());
    const live = capture.receive(raw, 1012.375, 123456.5);
    const sidecar = stop(handle).imu_01;
    return {sidecar, p: sidecar.packets[0], live};
  }

  it.each([digits, JSON.stringify(digits)])('preserves a 19-digit numeric or string timestamp exactly: %s', token => {
    const raw = rawPacket(token), {p, sidecar} = record(raw);
    expect(p.metadataValidity.receiver_time_ns).toBe('valid');
    expect(p.browserReceiverTimestamp.receiverTimeNs).toBe(digits);
    expect((p.rawFields as any).receiver_time_ns).toBe(digits);
    expect(p.rawMessage).toBe(raw); expect(p.validity.valid).toBe(true);
    expect(p.validity.rejectionReason).toBeUndefined();
    const exported = JSON.parse(JSON.stringify(sidecar));
    expect(exported.packets[0].browserReceiverTimestamp.receiverTimeNs).toBe(digits);
    expect(exported.packets[0].rawFields.receiver_time_ns).toBe(digits);
    expect(exported.packets[0].rawMessage).toBe(raw);
  });

  it.each(['null','-1','1.5','1e18','true','{}','[]','""','"bad"','"1.5"','"-1"','" 123"','"123 "'])('rejects malformed optional metadata without rejecting orientation: %s', token => {
    const {p, sidecar} = record(rawPacket(token));
    expect(p.metadataValidity.receiver_time_ns).toBe('invalid');
    expect(p.browserReceiverTimestamp.receiverTimeNs).toBeUndefined();
    expect(p.validationIssues).toContain('receiver_time_ns: invalid');
    expect(p.validity.valid).toBe(true); expect(p.validity.rejectionReason).toBeUndefined();
    expect(sidecar.diagnostics).toMatchObject({packetCount: 1,validPacketCount: 1,invalidPacketCount: 0});
  });

  it('keeps missing optional metadata explicit and does not invent a timestamp', () => {
    const {p, sidecar} = record(packet());
    expect(p.metadataValidity.receiver_time_ns).toBe('missing');
    expect(p.browserReceiverTimestamp.receiverTimeNs).toBeUndefined();
    expect(p.validity.valid).toBe(true); expect(sidecar.diagnostics.invalidPacketCount).toBe(0);
  });

  it('separates malformed optional UTC metadata from core packet rejection too', () => {
    const {p} = record(rawPacket(digits, ',"receiver_time_utc":null'));
    expect(p.metadataValidity.receiver_time_utc).toBe('invalid');
    expect(p.validationIssues).toContain('receiver_time_utc: invalid'); expect(p.validity.valid).toBe(true);
  });

  it('does not change sensor timing, counters, accuracy, quaternion, receipt clocks or the live parser', () => {
    const withNs = record(rawPacket(digits)), withoutNs = record(packet('imu_01', 7));
    for (const key of ['sensorTimestampUs','sequence','accuracy','normalizedQuaternion','experimentReceiveTimeMs','synchronization'] as const) {
      expect(withNs.p[key]).toEqual(withoutNs.p[key]);
    }
    expect(withNs.p.browserReceiverTimestamp.performanceNowMs).toBe(1012.375);
    expect(withNs.p.browserReceiverTimestamp.wallClockMs).toBe(123456.5);
    expect(withNs.sidecar.clockMetadata).toEqual(withoutNs.sidecar.clockMetadata);
    expect(withNs.live).toEqual(JSON.parse(rawPacket(digits))); // Legacy live path is unchanged.
  });

  it('selects only the top-level value, honors escaped keys and duplicate-key last-wins semantics', () => {
    const nested = record(rawPacket(digits, ',"nested":{"receiver_time_ns":3},"note":"receiver_time_ns: 4"'));
    expect(nested.p.browserReceiverTimestamp.receiverTimeNs).toBe(digits);
    const escaped = rawPacket(digits).replace('receiver_time_ns', 'receiver_time_' + String.fromCharCode(92) + 'u006es');
    expect(record(escaped).p.browserReceiverTimestamp.receiverTimeNs).toBe(digits);
    expect(record(rawPacket('2', ',"receiver_time_ns":' + digits)).p.browserReceiverTimestamp.receiverTimeNs).toBe(digits);
    expect(record(rawPacket(digits, ',"receiver_time_ns":null')).p.metadataValidity.receiver_time_ns).toBe('invalid');
  });

  it('counts genuine core failures separately from optional metadata defects for both sensors', () => {
    const c = createIMURecordingSource(), h = c.source.start(context());
    for (const sensor of ['imu_01','imu_02']) {
      c.receive(rawPacket(digits).replace('imu_01',sensor),1001,1);
      c.receive(rawPacket('"bad"').replace('imu_01',sensor),1002,2);
      c.receive(rawPacket('null').replace('imu_01',sensor).replace('"qw":2','"qw":0'),1003,3);
    }
    for (const stream of Object.values(stop(h))) {
      expect(stream.diagnostics).toMatchObject({packetCount:3,validPacketCount:2,invalidPacketCount:1});
      expect(stream.packets[2].validity.rejectionReason).toBe('quaternion: invalid');
    }
  });

  it('can revalidate an old sidecar from its original raw messages without new capture', () => {
    const originalRaw = rawPacket(digits);
    const old = {rawMessage: originalRaw,rawFields: JSON.parse(originalRaw),
      browserReceiverTimestamp:{performanceNowMs:1012.375,wallClockMs:123456.5},
      validity:{valid:false,rejectionReason:'receiver_time_ns: invalid'}};
    const c = createIMURecordingSource(), h = c.source.start(context());
    c.receive(old.rawMessage, old.browserReceiverTimestamp.performanceNowMs, old.browserReceiverTimestamp.wallClockMs);
    const recovered = stop(h).imu_01;
    expect(recovered.diagnostics.invalidPacketCount).toBe(0);
    expect(recovered.packets[0].browserReceiverTimestamp.receiverTimeNs).toBe(digits);
    expect(recovered.packets[0].experimentReceiveTimeMs).toBe(12.375);
    expect(old.validity.valid).toBe(false); // The original artifact remains untouched.
  });

  it('retains exact nanoseconds from binary JSON through serializable export', () => {
    const c = createIMURecordingSource(), h = c.source.start(context());
    const raw = rawPacket(digits);
    c.receive(new TextEncoder().encode(raw).buffer,1001,1);
    const exported = JSON.parse(JSON.stringify(stop(h).imu_01));
    expect(exported.packets[0].browserReceiverTimestamp.receiverTimeNs).toBe(digits);
    expect(exported.packets[0].rawMessage).toBe(raw);
  });
});
