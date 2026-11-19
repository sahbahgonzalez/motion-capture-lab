import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useStereoVideoRecorder, createRecordingClockExport, createCameraTimingObservation,
  summarizeCameraTiming, detectTimingDiscontinuities, buildSynchronizationDiagnostics,
  createUnavailableCameraTimingSidecar,
} from '../useStereoVideoRecorder';

// Exercise the real hook and queued browser event ordering; no cameras are opened.
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static failConstructor = -1;
  static failStart = -1;
  static isTypeSupported() { return true; }
  state = 'inactive';
  mimeType = 'video/webm';
  ondataavailable: any = null;
  onstart: any = null;
  onstop: any = null;
  onerror: any = null;
  index: number;
  stopCalls = 0;
  throwOnStop = false;
  constructor() {
    this.index = FakeRecorder.instances.length;
    if (this.index === FakeRecorder.failConstructor) throw new Error('constructor failed');
    FakeRecorder.instances.push(this);
  }
  start() {
    if (this.index === FakeRecorder.failStart) throw new Error('start failed');
    this.state = 'recording'; this.onstart?.();
  }
  stop() {
    this.stopCalls++;
    if (this.throwOnStop) throw new Error('stop failed');
    this.state = 'inactive'; // final data and stop events arrive later, even though state is inactive
  }
  data(value = 'video') { this.ondataavailable?.({ data: new Blob([value]) }); }
  finish(value = 'video') { this.state = 'inactive'; this.data(value); this.onstop?.(); }
  fail() { this.onerror?.(new Error('encoder failure')); }
}

function video() {
  let next = 0;
  const callbacks = new Map<number, any>();
  return {
    videoWidth: 1280, videoHeight: 720, currentTime: 0,
    callbacks,
    requestVideoFrameCallback: vi.fn((callback: any) => { callbacks.set(++next, callback); return next; }),
    cancelVideoFrameCallback: vi.fn((id: number) => callbacks.delete(id)),
    fire(mediaTime = 1, presentedFrames = 1) {
      const [id, callback] = callbacks.entries().next().value!;
      callbacks.delete(id); this.currentTime = mediaTime;
      callback(performance.now(), { mediaTime, presentedFrames });
    },
  };
}
const stream = () => ({ getVideoTracks: () => [{
  label: 'camera', getSettings: () => ({ deviceId: 'device', width: 1280, height: 720, frameRate: 30 }),
  getConstraints: () => ({ frameRate: { ideal: 30 } }),
}] }) as unknown as MediaStream;
let renderer: ReactTestRenderer | undefined;
function mount() {
  const a = video(), b = video();
  const options = {
    cameraA: { videoRef: { current: a as unknown as HTMLVideoElement }, cameraId: 'A' },
    cameraB: { videoRef: { current: b as unknown as HTMLVideoElement }, cameraId: 'B' },
    experimentSessionId: 'session-original',
  };
  let hook!: ReturnType<typeof useStereoVideoRecorder>;
  const streams = [stream(), stream()];
  function Harness() { hook = useStereoVideoRecorder(streams[0], streams[1], options); return null; }
  act(() => { renderer = create(createElement(Harness)); });
  return { get hook() { return hook; }, a, b, options };
}
const start = (h: ReturnType<typeof mount>) => act(() => h.hook.startRecording());
function stop(h: ReturnType<typeof mount>) {
  let promise!: ReturnType<typeof h.hook.stopRecording>;
  act(() => { promise = h.hook.stopRecording(); });
  return promise;
}
async function finish(h: ReturnType<typeof mount>, a = 'A-video', b = 'B-video') {
  const p = stop(h);
  act(() => { FakeRecorder.instances.at(-2)!.finish(a); FakeRecorder.instances.at(-1)!.finish(b); });
  let result!: Awaited<typeof p>;
  await act(async () => { result = await p; });
  return result!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  FakeRecorder.instances = []; FakeRecorder.failConstructor = -1; FakeRecorder.failStart = -1;
  vi.stubGlobal('MediaRecorder', FakeRecorder);
});
afterEach(() => {
  act(() => { renderer?.unmount(); }); renderer = undefined;
  act(() => { vi.runOnlyPendingTimers(); });
  vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('Stage 2A recording lifecycle', () => {
  it('blocks start through stopping/finalization and returns the same stop promise', async () => {
    const h = mount(); start(h); const p = stop(h);
    expect(stop(h)).toBe(p);
    start(h); expect(FakeRecorder.instances).toHaveLength(2);
    act(() => FakeRecorder.instances[0].finish('old-A'));
    start(h); expect(FakeRecorder.instances).toHaveLength(2);
    act(() => FakeRecorder.instances[1].finish('old-B'));
    const old = (await p)!;
    start(h); expect(FakeRecorder.instances).toHaveLength(4);
    expect(await old.cam1Blob.text()).toBe('old-A');
    const fresh = await finish(h, 'new-A', 'new-B');
    expect(await fresh.cam1Blob.text()).toBe('new-A'); expect(fresh.id).not.toBe(old.id);
    expect(h.hook.recordings).toHaveLength(2);
  });

  it('ignores late events from an old recorder and preserves finalized metadata', async () => {
    const h = mount(); start(h);
    const old = FakeRecorder.instances[0];
    const lateData = old.ondataavailable, lateError = old.onerror, lateStart = old.onstart;
    h.a.fire(); const recording = await finish(h);
    const before = JSON.stringify(createRecordingClockExport(recording));
    start(h);
    act(() => { lateData({data: new Blob(['late'])}); lateError(); lateStart(); });
    const next = await finish(h, 'next-A', 'next-B');
    expect(await next.cam1Blob.text()).toBe('next-A');
    expect(JSON.stringify(createRecordingClockExport(recording))).toBe(before);
    expect(old.ondataavailable).toBeNull(); expect(old.onerror).toBeNull();
  });

  it.each([
    ['A', 'B', 'complete', 'complete', 'complete'],
    ['', 'B', 'partial', 'failed', 'complete'],
    ['A', '', 'partial', 'complete', 'failed'],
    ['', '', 'failed', 'failed', 'failed'],
  ])('validates blobs %j / %j as %s', async (a, b, status, statusA, statusB) => {
    const h = mount(); start(h); const r = await finish(h, a, b);
    expect(r.status).toBe(status); expect(r.cameraAEncodingStatus).toBe(statusA);
    expect(r.cameraBEncodingStatus).toBe(statusB);
    if (!a || !b) expect(r.errors.join(' ')).toContain('empty video blob');
  });

  it('retains the last queued chunks before stop and snapshots start options', async () => {
    const h = mount(); start(h); const p = stop(h);
    h.options.experimentSessionId = 'changed-after-start';
    act(() => {
      FakeRecorder.instances[0].data('chunk-');
      FakeRecorder.instances[0].finish('tail'); FakeRecorder.instances[1].finish('B');
    });
    const r = (await p)!;
    expect(await r.cam1Blob.text()).toBe('chunk-tail');
    expect(r.experimentSessionId).toBe('session-original');
  });

  it('coordinates mid-recording errors, keeps final chunks, and never clears error diagnostics', async () => {
    const h = mount(); start(h); const queuedCallback = h.a.callbacks.values().next().value;
    act(() => FakeRecorder.instances[0].fail());
    expect(FakeRecorder.instances[1].stopCalls).toBe(1);
    expect(h.hook.recordingDiagnostics.cameraAStatus).toBe('error');
    act(() => { vi.advanceTimersByTime(250); queuedCallback(0, {mediaTime: 1}); });
    expect(h.hook.recordingDiagnostics.cameraAStatus).toBe('error');
    expect(h.a.callbacks.size).toBe(0); expect(h.b.callbacks.size).toBe(0);
    const p = stop(h);
    act(() => { FakeRecorder.instances[0].finish('error-tail'); FakeRecorder.instances[1].finish('good'); });
    const r = (await p)!;
    expect(r.status).toBe('partial'); expect(r.errors.join()).toContain('Camera A');
    expect(await r.cam1Blob.text()).toBe('error-tail');
  });

  it('waits for final data when an errored encoder is already inactive', async () => {
    const h = mount(); start(h); FakeRecorder.instances[0].state = 'inactive';
    act(() => FakeRecorder.instances[0].fail()); const p = stop(h);
    act(() => FakeRecorder.instances[1].finish('peer'));
    expect(h.hook.recordings).toHaveLength(0);
    act(() => FakeRecorder.instances[0].finish('queued-tail'));
    const r = (await p)!; expect(await r.cam1Blob.text()).toBe('queued-tail');
  });

  it('handles unexpected encoder stop by finalizing its peer', async () => {
    const h = mount(); start(h);
    act(() => FakeRecorder.instances[0].finish('unexpected'));
    expect(FakeRecorder.instances[1].stopCalls).toBe(1);
    const p = stop(h); act(() => FakeRecorder.instances[1].finish('peer'));
    expect((await p)!.status).toBe('partial');
  });

  it('bounds a missing stop event and detaches late handlers', async () => {
    const h = mount(); start(h); const p = stop(h);
    act(() => FakeRecorder.instances[0].finish('A'));
    act(() => vi.advanceTimersByTime(5000));
    const r = (await p)!; expect(r.status).toBe('partial');
    expect(r.errors.join()).toContain('Camera B MediaRecorder stop timed out');
    expect(FakeRecorder.instances[1].onstop).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds stop exceptions and stops the other encoder', async () => {
    const h = mount(); start(h); FakeRecorder.instances[0].throwOnStop = true;
    const p = stop(h); act(() => FakeRecorder.instances[1].finish('B'));
    act(() => vi.advanceTimersByTime(5000));
    expect((await p)!.errors.join()).toContain('stop failed');
    expect(h.hook.isRecording).toBe(false);
  });

  it('rolls back a second-camera startup failure and blocks restart during rollback', async () => {
    FakeRecorder.failStart = 1;
    const h = mount(); start(h); expect(FakeRecorder.instances[0].stopCalls).toBe(1);
    start(h); expect(FakeRecorder.instances).toHaveLength(2);
    const p = stop(h); act(() => FakeRecorder.instances[0].finish('rollback-tail'));
    expect((await p)!.status).toBe('failed'); expect(h.a.callbacks.size).toBe(0);
  });

  it('settles constructor failures without a hanging timer', async () => {
    FakeRecorder.failConstructor = 1;
    const h = mount(); start(h);
    expect(h.hook.isRecording).toBe(false); expect(h.hook.recordings[0].status).toBe('failed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels observers and stops both encoders on unmount', async () => {
    const h = mount(); start(h); const p = stop(h);
    act(() => { renderer!.unmount(); renderer = undefined; });
    expect(h.a.callbacks.size).toBe(0); expect(h.b.callbacks.size).toBe(0);
    act(() => { FakeRecorder.instances[0].finish('A'); FakeRecorder.instances[1].finish('B'); });
    await p; expect(vi.getTimerCount()).toBe(0);
    expect(FakeRecorder.instances.every(r => r.onstop === null)).toBe(true);
  });

  it('unmounts during capture and cleans up even when no stop events arrive', () => {
    const h = mount(); start(h);
    act(() => { renderer!.unmount(); renderer = undefined; });
    expect(FakeRecorder.instances.map(r => r.stopCalls)).toEqual([1, 1]);
    expect(h.a.callbacks.size + h.b.callbacks.size).toBe(0);
    act(() => vi.advanceTimersByTime(5000));
    expect(vi.getTimerCount()).toBe(0); expect(FakeRecorder.instances[0].onerror).toBeNull();
  });

  it('does not alter completed recordings on unmount', async () => {
    const h = mount(); start(h); const r = await finish(h);
    const before = JSON.stringify(r);
    act(() => { renderer!.unmount(); renderer = undefined; });
    expect(JSON.stringify(r)).toBe(before); expect(r.status).toBe('complete');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves shared clock, sensor-independent camera timing, and startup instrumentation', async () => {
    const h = mount(); start(h);
    act(() => { vi.advanceTimersByTime(30); h.a.fire(12, 2); vi.advanceTimersByTime(4); h.b.fire(5, 8); });
    const r = await finish(h);
    expect(r.cameraATiming.experimentStartPerformanceNowMs).toBe(r.cameraBTiming.experimentStartPerformanceNowMs);
    expect(r.cameraATiming.observations[0].mediaTimeSeconds).toBe(12);
    expect(r.cameraBTiming.observations[0].mediaTimeSeconds).toBe(5);
    expect(r.startupInstrumentation.cameraA.firstTimingObservationExperimentTimeMs).toBe(30);
    expect(r.cameraATiming.limitation).toBeUndefined();
    expect(r.synchronizationDiagnostics.timingUncertaintyMs).toBeUndefined();
  });

  it('cleans up fallback animation-frame observers and deduplicates media time', async () => {
    const callbacks = new Map<number, FrameRequestCallback>(); let next = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++next, callback); return next;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    const h = mount();
    (h.a as any).requestVideoFrameCallback = undefined;
    (h.b as any).requestVideoFrameCallback = undefined;
    start(h);
    const fire = () => {
      const entries = [...callbacks]; callbacks.clear();
      act(() => entries.forEach(([,callback]) => callback(performance.now())));
    };
    fire(); fire(); // Same currentTime: only one observation per camera.
    const r = await finish(h);
    expect(r.cameraATiming.metadataAvailability).toBe('fallback_current_time');
    expect(r.cameraATiming.observations).toHaveLength(1);
    expect(r.limitations.join()).toContain('not frame-specific');
    expect(callbacks.size).toBe(0);
  });

  it('rejects queued old timing callbacks after a new session starts', async () => {
    const h = mount(); start(h);
    const late = h.a.callbacks.values().next().value;
    const old = await finish(h);
    start(h);
    act(() => late(0, {mediaTime: 999, presentedFrames: 999}));
    const fresh = await finish(h);
    expect(old.cameraATiming.observations).toHaveLength(0);
    expect(fresh.cameraATiming.observations).toHaveLength(0);
  });

  it('exports status, camera failures, errors, limitations, and association in the existing six downloads', async () => {
    const h = mount(); start(h); const r = await finish(h, '', 'B');
    const blobs: Blob[] = []; const names: string[] = [];
    vi.stubGlobal('document', { body: {appendChild() {},removeChild() {}}, createElement: () => ({
      href: '', download: '', click() { names.push(this.download); },
    }) });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob as Blob); return 'blob:test'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    h.hook.downloadRecording(r);
    expect(blobs).toHaveLength(6); expect(names[4]).toContain('_recording_clock.json');
    const metadata = JSON.parse(await blobs[4].text());
    expect(metadata.recordingId).toBe(r.id); expect(metadata.authoritativeClock).toBe('live_performance_now');
    expect(metadata.recordingSummary.status).toBe('partial');
    expect(metadata.recordingSummary.cameraAEncodingStatus).toBe('failed');
    expect(metadata.recordingSummary.errors.join()).toContain('empty');
    expect(metadata.recordingSummary.limitations.join()).toContain('decodability');
    vi.restoreAllMocks();
  });
});

function observation(time: number, previousTime?: number, presentedFrames?: number, previousPresentedFrames?: number) {
  return createCameraTimingObservation({recordingId: 'timing', cameraRole: 'camera_a', sequence: time,
    experimentStartPerformanceNowMs: 0, browserObservedPerformanceNowMs: time,
    mediaTimeSeconds: time / 1000, previousMediaTimeSeconds: previousTime === undefined ? undefined : previousTime / 1000,
    observationMethod: 'request_video_frame_callback', mediaTimestampSource: 'rvfc_media_time',
    presentedFrames, previousPresentedFrames});
}
describe('Stage 2A timing semantics', () => {
  it('keeps subthreshold skipped presentation observations separate from significant gaps', () => {
    const observations = [observation(0, undefined, 1), observation(66, 0, 3, 1)];
    const summary = summarizeCameraTiming(observations);
    expect(summary.skippedFrameCount).toBe(1); expect(summary.frameGapCount).toBe(1);
    expect(summary.significantGapCount).toBe(0); expect(detectTimingDiscontinuities(observations)).toEqual([]);
  });
  it('includes the exact 100 ms boundary without requiring presentation counters', () => {
    const observations = [observation(0), observation(100, 0)];
    expect(summarizeCameraTiming(observations).significantGapCount).toBe(1);
    expect(detectTimingDiscontinuities(observations)).toHaveLength(1);
  });
  it('detects media-only gaps while retaining independent skipped counts', () => {
    const observations = [observation(0), {...observation(33, 0),mediaTimeDeltaMs: 150}];
    expect(summarizeCameraTiming(observations).significantGapCount).toBe(1);
    expect(summarizeCameraTiming(observations).skippedFrameCount).toBe(0);
  });
  it('reports signed and absolute pairing statistics without exposure uncertainty', () => {
    const a = createUnavailableCameraTimingSidecar('timing','camera_a','A',0,'unavailable');
    const b = createUnavailableCameraTimingSidecar('timing','camera_b','B',0,'unavailable');
    a.observations = [observation(100), observation(200), observation(300), observation(400)];
    b.observations = [observation(90), observation(202), observation(306), observation(420)];
    const sync = buildSynchronizationDiagnostics('timing',a,b);
    expect(sync.meanBrowserObservationOffsetMs).toBe(4.5);
    expect(sync.meanAbsoluteBrowserObservationOffsetMs).toBe(9.5);
    expect(sync.medianAbsoluteBrowserObservationOffsetMs).toBe(8);
    expect(sync.p95AbsoluteBrowserObservationOffsetMs).toBe(20);
    expect(sync.maxAbsoluteBrowserObservationOffsetMs).toBe(20);
    expect(sync.cameraPairMetadata.uncertaintyMs).toBeUndefined();
  });
  it('enforces one-to-one tolerance pairing and leaves media clock offsets unspecified', () => {
    const a = createUnavailableCameraTimingSidecar('timing','camera_a','A',0,'unavailable');
    const b = createUnavailableCameraTimingSidecar('timing','camera_b','B',0,'unavailable');
    a.observations = [observation(0),observation(100)]; b.observations = [observation(5)];
    const sync = buildSynchronizationDiagnostics('timing',a,b);
    expect(sync.matchedObservationCount).toBe(1); expect(sync.unmatchedCameraAObservationCount).toBe(1);
    expect(sync.meanMediaTimeOffsetMs).toBeUndefined(); expect(sync.timingUncertaintyMs).toBeUndefined();
    expect(sync.hardwareExposureSynchronizationVerified).toBe(false);
  });
});
