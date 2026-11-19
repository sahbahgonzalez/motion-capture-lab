import { strToU8, zipSync } from 'fflate';
import type { StereoVideoRecording, StereoRecordingProgress, RecorderStartupTiming } from '../hooks/useStereoVideoRecorder';
import { createRecordingClockExport } from '../hooks/useStereoVideoRecorder';
import type { MasterActiveSession, MasterManifest, MasterReadiness, MasterSession, MasterStreamManifest, RuntimeSnapshot, SnapshotValue } from '../type/masterSession';

/** JSON-safe deep copy/freeze. Non-finite unavailable runtime values are explicitly tagged. */
export function immutableJson<T>(value: T): T {
  const result = JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === 'function' || typeof item === 'symbol') throw new Error('Runtime snapshot contains non-serializable settings.');
    if (typeof item === 'number' && !Number.isFinite(item)) return {availability: 'unavailable', reason: 'non_finite', original: String(item)};
    return typeof item === 'bigint' ? item.toString() : item === undefined ? null : item;
  }));
  const freeze = (item: any) => { if (item && typeof item === 'object' && !Object.isFrozen(item)) { Object.values(item).forEach(freeze); Object.freeze(item); } };
  freeze(result); return result;
}
export function snapshotValue(value: unknown, provenance: SnapshotValue['provenance'], reason = 'Not available from the running application.'): SnapshotValue {
  return value === null || value === undefined
    ? {availability: 'unavailable', provenance: 'unavailable', value: null, reason}
    : {availability: 'available', provenance, value};
}
export function missingReadiness(report: MasterReadiness): string[] {
  return [...Object.entries(report.streams).filter(([,check]) => !check.ready).map(([key,check]) => key + ': ' + check.reason),
    ...(!report.processing.ready ? ['processing: ' + report.processing.reason] : [])];
}
export function evaluationReadiness(progress: StereoRecordingProgress | null, live: MasterReadiness): string[] {
  const missing = missingReadiness(live);
  if (!progress || progress.phase !== 'recording') return [...missing, 'recorders: capture is not active'];
  for (const [key, timing] of Object.entries({camera_a: progress.instrumentation.cameraA, camera_b: progress.instrumentation.cameraB})) {
    if (timing.startEventExperimentTimeMs === undefined) missing.push(key + ': waiting for MediaRecorder start event');
    if (timing.firstDataAvailableExperimentTimeMs === undefined) missing.push(key + ': waiting for non-empty encoded chunk');
    if (timing.firstTimingObservationExperimentTimeMs === undefined) missing.push(key + ': waiting for browser timing observation');
  }
  for (const sensor of ['imu_01','imu_02'] as const) {
    if (!progress.imu || progress.imu.recordingId !== progress.recordingId
      || progress.imu.streams[sensor].firstValidExperimentTimeMs === null) missing.push(sensor + ': waiting for valid archived packet');
  }
  return missing;
}
function cameraPaths(r: StereoVideoRecording | null) {
  return {camera_a: 'cameras/camera_a.' + (r?.cam1Blob.type.includes('mp4') ? 'mp4' : 'webm'),
    camera_b: 'cameras/camera_b.' + (r?.cam2Blob.type.includes('mp4') ? 'mp4' : 'webm')};
}
export function finalizeMasterSession(active: MasterActiveSession, recording: StereoVideoRecording | null): MasterSession {
  const origin = recording?.clockMetadata.liveCaptureOrigin?.originPerformanceNowMs ?? null;
  const timeline = {...active.timeline, recordingOriginPerformanceNowMs: origin};
  if (recording && origin !== null) timeline.stopPerformanceNowMs = origin + recording.duration;
  timeline.evaluationWindowEndMs = timeline.evaluationWindowStartMs === null ? null : recording?.duration ?? null;
  const paths = cameraPaths(recording);
  const errors = [...active.errors, ...(recording?.errors ?? [])];
  const warnings = [...active.warnings];
  const streams = {} as MasterManifest['streams'];
  for (const [key, blob, encoding, sidecar, timing] of [
    ['camera_a',recording?.cam1Blob,recording?.cameraAEncodingStatus,recording?.cameraATiming,recording?.startupInstrumentation.cameraA],
    ['camera_b',recording?.cam2Blob,recording?.cameraBEncodingStatus,recording?.cameraBTiming,recording?.startupInstrumentation.cameraB],
  ] as const) {
    const dataAvailable = !!blob?.size;
    const usable = dataAvailable && encoding === 'complete';
    streams[key] = {status: usable ? 'complete' : dataAvailable ? 'failed' : 'missing', dataAvailable, usable,
      count: sidecar?.observations.length ?? 0, countMeaning: 'browser_camera_observations',
      asset: paths[key], timingAsset: 'cameras/' + key + '_timing.json', timing: timing ?? null,
      recordingMetadata: {cameraId:sidecar?.cameraId ?? null,videoAssetId:sidecar?.videoAssetId ?? null,
        mimeType:blob?.type ?? null,byteLength:blob?.size ?? 0,resolution:sidecar?.resolution ?? null,
        requestedFrameRate:sidecar?.requestedFrameRate ?? null,trackReportedFrameRate:sidecar?.trackReportedFrameRate ?? null,
        timingMetadataAvailability:sidecar?.metadataAvailability ?? 'unavailable',encodingStatus:encoding ?? 'unavailable'},
      issues: [...(!usable ? ['Camera encoding is missing or failed.'] : []), ...(sidecar?.limitation ? [sidecar.limitation] : [])]};
    if (sidecar && !sidecar.observations.length) warnings.push(key + ': no browser timing observations.');
  }
  for (const key of ['imu_01','imu_02'] as const) {
    const sidecar = recording?.imuRecording?.[key];
    const aligned = sidecar?.recordingId === active.sessionId && sidecar?.experimentStartPerformanceNowMs === origin;
    const usable = !!sidecar && sidecar.diagnostics.validPacketCount > 0 && aligned;
    const interrupted = !!sidecar?.diagnostics.connectionInterruptionCount || active.interruptedStreams.has(key);
    streams[key] = {status: !sidecar?.packets.length ? 'missing' : !usable ? 'failed' : interrupted ? 'partial' : 'complete',
      dataAvailable: !!sidecar?.packets.length, usable, count: sidecar?.packets.length ?? 0,
      countMeaning: 'received_imu_packets', validPacketCount: sidecar?.diagnostics.validPacketCount ?? 0,
      invalidPacketCount: sidecar?.diagnostics.invalidPacketCount ?? 0, asset: 'imus/' + key + '.json',
      recordingMetadata: sidecar ? {sensorId:key,segment:sidecar.segment,schemaVersion:sidecar.schemaVersion,status:sidecar.status} : null,
      timing: sidecar ? {originPerformanceNowMs:sidecar.experimentStartPerformanceNowMs,stopReason:sidecar.stopReason,endPerformanceNowMs: sidecar.endPerformanceNowMs, firstReceiptTimeMs: sidecar.diagnostics.firstExperimentReceiveTimeMs,
        lastReceiptTimeMs: sidecar.diagnostics.lastExperimentReceiveTimeMs, connectionEvents: sidecar.connectionEvents} : null,
      issues: [...(!usable ? ['Required IMU stream missing, invalid, or clock/session association mismatched.'] : []),
        ...(interrupted ? ['Browser observed an availability/connection interruption.'] : [])]};
    if (sidecar?.diagnostics.invalidPacketCount) warnings.push(key + ': contains invalid packets; retained for inspection.');
    if (sidecar?.diagnostics.receiptTimingGaps.length) warnings.push(key + ': contains browser receipt gaps; not proof of hardware sample loss.');
  }
  for (const [key, stream] of Object.entries(streams)) {
    if (!stream.usable) errors.push(key + ': ' + stream.issues.join(' '));
    else if (stream.status === 'partial') warnings.push(key + ': ' + stream.issues.join(' '));
  }
  if (recording && (recording.synchronizationDiagnostics.unmatchedCameraAObservationCount
    || recording.synchronizationDiagnostics.unmatchedCameraBObservationCount)) {
    warnings.push('Some browser camera observations are unmatched; this is a synchronization diagnostic, not an encoding failure.');
  }
  const criticalMissing = Array.from(new Set([
    ...(active.configuration.initial?.criticalMissing ?? ['runtimeSnapshot']),
    ...active.configuration.changes.flatMap(change => change.snapshot.criticalMissing),
  ]));
  if (criticalMissing.length) warnings.push('Runtime configuration incomplete: ' + criticalMissing.join(', '));
  if (timeline.evaluationWindowStartMs === null) warnings.push('No evaluation-ready window was established.');
  if (active.interruptedStreams.has('camera_a') || active.interruptedStreams.has('camera_b')) warnings.push('Camera availability was interrupted during capture.');
  const usable = Object.values(streams).filter(stream => stream.usable).length;
  const status = usable === 0 ? 'failed' : usable < 4 || errors.length || criticalMissing.length
    || timeline.evaluationWindowStartMs === null || active.interruptedStreams.size
    || Object.values(streams).some(stream => stream.status !== 'complete') ? 'partial' : 'complete';
  const jsonPaths = ['manifest.json','config/runtime_snapshot.json','cameras/camera_a_timing.json','cameras/camera_b_timing.json',
    'cameras/stereo_pairing.json','imus/imu_01.json','imus/imu_02.json','diagnostics/clock.json','diagnostics/errors.json'];
  const delays = (timing: RecorderStartupTiming | undefined) => timing ? {
    startEventDelayMs: timing.startEventExperimentTimeMs === undefined || timing.startCallExperimentTimeMs === undefined ? null : timing.startEventExperimentTimeMs - timing.startCallExperimentTimeMs,
    firstChunkMs: timing.firstDataAvailableExperimentTimeMs ?? null,
    firstTimingObservationMs: timing.firstTimingObservationExperimentTimeMs ?? null,
    dataObservedBeforeStartEvent: timing.startEventExperimentTimeMs !== undefined && timing.firstDataAvailableExperimentTimeMs !== undefined
      ? timing.firstDataAvailableExperimentTimeMs < timing.startEventExperimentTimeMs : null,
  } : null;
  const manifest: MasterManifest = {
    schemaVersion: '1.0.0-master-session', sessionId: active.sessionId, createdAt: active.createdAt, status,
    clock: recording?.clockMetadata ?? null, timeline, durationMs: recording?.duration ?? 0,
    warmupExperimentStartMs: origin === null || timeline.warmupStableStartPerformanceNowMs === null
      ? null : timeline.warmupStableStartPerformanceNowMs - origin,
    readiness: {basis: 'browser_observations_only', events: active.readinessEvents.map(event => ({...event,
      experimentTimeMs: origin === null ? null : event.performanceNowMs - origin})), evaluationReady: timeline.evaluationWindowStartMs !== null},
    streams, synchronization: recording?.synchronizationDiagnostics ?? null,
    startupDelayAnalysis: {camera_a: delays(recording?.startupInstrumentation.cameraA), camera_b: delays(recording?.startupInstrumentation.cameraB),
      interpretation: 'Start events can be delayed on the main thread. A delay (including ~1.61 s) is not evidence of lost encoded frames. Inspect original videos externally.'},
    configuration: {asset: 'config/runtime_snapshot.json', completeForReplay: criticalMissing.length === 0, criticalMissing},
    files: [...jsonPaths.map(path => ({path, present: true})), ...Object.entries(paths).map(([key,path]) => ({path,present: streams[key as keyof typeof paths].dataAvailable}))],
    errors, warnings,
    limitations: [
      'Readiness/evaluation boundaries use browser observations, not verified exposure or sensor sampling readiness.',
      'Camera media-time origins are independent; callback receipts are not hardware exposure timestamps.',
      'First data chunks and start events do not prove encoded frame coverage or decodability.',
      'IMU sensor microseconds and upstream receiver nanoseconds remain separate unverified clocks; browser receipt defines experiment arrival time.',
      'No trimming, resampling, media-origin shifting, pose playback, or pipeline evaluation is performed.',
      'Configuration changes are reported when observed by application effects; exact hardware exposure changes are unavailable.',
      'Recovery persists in memory within this page only; browser closure/reload loses undownloaded sessions.',
    ],
  };
  return {manifest: immutableJson(manifest), configuration: immutableJson(active.configuration), recording};
}
export async function createMasterSessionZip(session: MasterSession): Promise<Blob> {
  const r = session.recording, paths = cameraPaths(r);
  const unavailable = {sessionId: session.manifest.sessionId, status: 'unavailable', reason: 'Capture did not start or stream was not recorded.'};
  const files: Record<string, Uint8Array> = {};
  const json = (path: string, value: unknown) => { files[path] = strToU8(JSON.stringify(value, null, 2)); };
  json('manifest.json',session.manifest); json('config/runtime_snapshot.json',session.configuration);
  json('cameras/camera_a_timing.json',r?.cameraATiming ?? unavailable);
  json('cameras/camera_b_timing.json',r?.cameraBTiming ?? unavailable);
  json('cameras/stereo_pairing.json',r?.synchronizationDiagnostics ?? unavailable);
  json('imus/imu_01.json',r?.imuRecording?.imu_01 ?? unavailable);
  json('imus/imu_02.json',r?.imuRecording?.imu_02 ?? unavailable);
  json('diagnostics/clock.json',r ? createRecordingClockExport(r) : unavailable);
  json('diagnostics/errors.json',{sessionId:session.manifest.sessionId,errors:session.manifest.errors,warnings:session.manifest.warnings,limitations:session.manifest.limitations,streams:Object.fromEntries(Object.entries(session.manifest.streams).map(([key,stream])=>[key,{status:stream.status,issues:stream.issues}]))});
  if (r?.cam1Blob.size) files[paths.camera_a] = new Uint8Array(await r.cam1Blob.arrayBuffer());
  if (r?.cam2Blob.size) files[paths.camera_b] = new Uint8Array(await r.cam2Blob.arrayBuffer());
  // STORE compression preserves exact bytes and avoids re-encoding/compressing already-encoded video.
  return new Blob([zipSync(files,{level:0,mtime:new Date(session.manifest.createdAt)})],{type:'application/zip'});
}
