import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIMUWebSocket } from '../useIMUWebSocket';
import { useStereoVideoRecorder, createRecordingClockExport } from '../useStereoVideoRecorder';
class Socket {
  static instances: Socket[] = [];
  static throwConstructor = false;
  binaryType = '';
  onopen: any = null; onclose: any = null; onmessage: any = null; onerror: any = null;
  closeCalls = 0;
  constructor(public url: string) { if (Socket.throwConstructor) throw new Error('offline'); Socket.instances.push(this); }
  open() { this.onopen?.(); }
  message(data: unknown) { this.onmessage?.({data}); }
  close() { this.closeCalls++; }
}
class Recorder {
  static instances: Recorder[] = [];
  static failStart = -1;
  static isTypeSupported() { return true; }
  state = 'inactive'; mimeType = 'video/webm';
  ondataavailable: any = null; onstart: any = null; onstop: any = null; onerror: any = null;
  index = Recorder.instances.length;
  constructor() { Recorder.instances.push(this); }
  start() { if (this.index === Recorder.failStart) throw new Error('start failure'); this.state = 'recording'; this.onstart?.(); }
  stop() { this.state = 'inactive'; }
  finish() { this.ondataavailable?.({data: new Blob(['video'])}); this.onstop?.(); }
}
const packet = (sensor_id = 'imu_01', sequence = 1, extra = {}) => JSON.stringify({sensor_id,sequence,timestamp_us: 5000,accuracy: 3,qw: 2,qx: 0,qy: 0,qz: 0,...extra});
const stream = {getVideoTracks: ()=>[]} as unknown as MediaStream;
let renderer: ReactTestRenderer | undefined;
function mount() {
  let imu!: ReturnType<typeof useIMUWebSocket>, camera!: ReturnType<typeof useStereoVideoRecorder>;
  function Harness() {
    imu = useIMUWebSocket();
    camera = useStereoVideoRecorder(stream,stream,{imuRecordingSource: imu.recordingSource});
    return null;
  }
  act(()=>{renderer=create(createElement(Harness));});
  return {get imu(){return imu;},get camera(){return camera;}};
}
function start(h: ReturnType<typeof mount>) { act(()=>h.camera.startRecording()); }
function stop(h: ReturnType<typeof mount>) {
  let p!: ReturnType<typeof h.camera.stopRecording>;
  act(()=>{p=h.camera.stopRecording();}); return p;
}
async function finish(h: ReturnType<typeof mount>) {
  const p=stop(h);
  act(()=>{Recorder.instances.at(-2)!.finish();Recorder.instances.at(-1)!.finish();});
  await act(async()=>{await p;}); return (await p)!;
}
beforeEach(()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval','performance']});
  Socket.instances=[];Socket.throwConstructor=false;Recorder.instances=[];Recorder.failStart=-1;
  vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('MediaRecorder',Recorder);
});
afterEach(()=>{
  act(()=>{renderer?.unmount();});renderer=undefined;
  act(()=>{vi.runOnlyPendingTimers();});vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();
});

describe('Stage 2B WebSocket and camera integration',()=>{
  it('captures every ingress packet between renders while live data retains the latest normalized pose',async()=>{
    const h=mount(),ws=Socket.instances[0];act(()=>ws.open());start(h);
    act(()=>{for(let i=0;i<200;i++)ws.message(packet(i%2?'imu_02':'imu_01',i));});
    // No 100 ms React refresh has run.
    expect(h.imu.getRawIMU('imu_01')!.latest!.sequence).toBe(198);
    expect(h.imu.getRawIMU('imu_01')!.latest!.qw).toBe(1);
    const r=await finish(h);
    expect(r.imuRecording!.imu_01.packets).toHaveLength(100);expect(r.imuRecording!.imu_02.packets).toHaveLength(100);
    expect((r.imuRecording!.imu_01.packets[0].rawFields as any).qw).toBe(2);
  });
  it('uses the exact camera ID, origin and stop boundary, not encoder finalization time',async()=>{
    const h=mount(),ws=Socket.instances[0];act(()=>vi.advanceTimersByTime(123.5));start(h);
    act(()=>{vi.advanceTimersByTime(10.25);ws.message(packet());});
    const p=stop(h);act(()=>{vi.advanceTimersByTime(1000);ws.message(packet('imu_02'));Recorder.instances[0].finish();Recorder.instances[1].finish();});
    const r=(await p)!,side=r.imuRecording!.imu_01;
    expect(side.recordingId).toBe(r.id);expect(side.experimentStartPerformanceNowMs).toBe(r.cameraATiming.experimentStartPerformanceNowMs);
    expect(side.clockMetadata).toEqual(r.clockMetadata);expect(side.durationMs).toBe(r.duration);
    expect(side.endPerformanceNowMs).toBe(side.experimentStartPerformanceNowMs+r.duration);
    expect(side.packets[0].experimentReceiveTimeMs).toBe(10.25);expect(r.imuRecording!.imu_02.packets).toHaveLength(0);
  });
  it('timestamps at handler entry before JSON parsing',async()=>{
    const h=mount();start(h);const parse=JSON.parse;
    vi.spyOn(JSON,'parse').mockImplementation((...args: Parameters<typeof JSON.parse>)=>{
      vi.advanceTimersByTime(5);return parse(...args);
    });
    act(()=>Socket.instances[0].message(packet()));vi.restoreAllMocks();
    const r=await finish(h);expect(r.imuRecording!.imu_01.packets[0].experimentReceiveTimeMs).toBe(0);
    expect(r.duration).toBe(5);
  });
  it('continues live ingestion before recording and during/after finalization without adding archival packets',async()=>{
    const h=mount(),ws=Socket.instances[0];act(()=>ws.message(packet('imu_01',0)));
    expect(h.imu.getRawIMU('imu_01')!.latest!.sequence).toBe(0);
    start(h);act(()=>ws.message(packet('imu_01',1)));const p=stop(h);
    act(()=>{ws.message(packet('imu_01',2));Recorder.instances[0].finish();Recorder.instances[1].finish();ws.message(packet('imu_01',3));});
    const r=(await p)!;expect(r.imuRecording!.imu_01.packets.map(p=>p.sequence)).toEqual([1]);
    expect(h.imu.getRawIMU('imu_01')!.latest!.sequence).toBe(3);
  });
  it('records invalid metadata faithfully while preserving legacy live fallback behavior',async()=>{
    const h=mount();start(h);
    act(()=>Socket.instances[0].message(JSON.stringify({sensor_id:'imu_01',qw:1,qx:0,qy:0,qz:0})));
    expect(h.imu.getRawIMU('imu_01')!.latest!.timestamp_us).toBe(0);
    const r=await finish(h);expect(r.imuRecording!.imu_01.packets[0].sensorTimestampUs).toBeNull();
    expect(r.imuRecording!.imu_01.diagnostics.invalidPacketCount).toBe(1);
  });
  it('retains malformed messages and invalid sensor packets without stopping valid live processing',async()=>{
    const h=mount();start(h);const ws=Socket.instances[0];
    act(()=>{ws.message('{broken');ws.message(packet('imu_01',1,{qw:0}));ws.message(packet('imu_02',2));});
    expect(h.imu.getRawIMU('imu_01')!.latest).toBeNull();expect(h.imu.getRawIMU('imu_02')!.latest!.sequence).toBe(2);
    const r=await finish(h);expect(r.imuRecording!.imu_01.packets).toHaveLength(1);
    expect(r.imuRecording!.imu_01.unassignedMessages[0].rawMessage).toBe('{broken');
  });
  it('handles socket failure/reconnect and ignores late events from the replaced socket',async()=>{
    const h=mount(),old=Socket.instances[0];act(()=>old.open());start(h);
    const lateMessage=old.onmessage,lateClose=old.onclose,lateOpen=old.onopen;
    act(()=>{old.message(packet('imu_01',1));old.onerror();old.onclose({code:1006,reason:'lost',wasClean:false});h.imu.reconnect();});
    const next=Socket.instances[1];act(()=>{next.open();next.message(packet('imu_01',1));lateMessage({data:packet('imu_01',999)});lateClose({});lateOpen();});
    expect(h.imu.connected).toBe(true);expect(h.imu.getRawIMU('imu_01')!.latest!.sequence).toBe(1);
    const r=await finish(h),side=r.imuRecording!.imu_01;
    expect(side.packets).toHaveLength(2);expect(side.packets[0].connectionId).not.toBe(side.packets[1].connectionId);
    expect(side.diagnostics.duplicateSequenceCount).toBe(0);expect(side.diagnostics.connectionInterruptionCount).toBe(1);
    expect(old.onmessage).toBeNull();expect(old.closeCalls).toBe(1);
  });
  it('keeps disconnected sensor streams explicitly empty without failing successful cameras',async()=>{
    Socket.throwConstructor=true;const h=mount();start(h);const r=await finish(h);
    expect(r.status).toBe('complete');expect(r.imuRecording!.imu_01.status).toBe('empty');
    expect(r.imuRecording!.imu_02.status).toBe('empty');expect(r.imuRecording!.imu_01.connectionAtStart.state).toBe('error');
  });
  it('retains constructor errors and reconnection events occurring during capture',async()=>{
    const h=mount();start(h);Socket.throwConstructor=true;act(()=>h.imu.reconnect());
    const r=await finish(h);expect(r.imuRecording!.imu_01.connectionEvents.some(e=>e.type==='construction_error')).toBe(true);
  });
  it('blocks overlapping camera sessions and freezes both IMU buffers on camera error',async()=>{
    const h=mount(),ws=Socket.instances[0];start(h);act(()=>ws.message(packet()));
    act(()=>Recorder.instances[0].onerror());const p=stop(h);start(h);
    expect(Recorder.instances).toHaveLength(2);
    act(()=>{ws.message(packet('imu_02'));Recorder.instances[0].finish();Recorder.instances[1].finish();});
    const r=(await p)!;expect(r.imuRecording!.imu_01.stopReason).toBe('camera_error');
    expect(r.imuRecording!.imu_02.packets).toHaveLength(0);
    start(h);act(()=>ws.message(packet('imu_02',9)));const fresh=await finish(h);
    expect(fresh.imuRecording!.imu_01.packets).toHaveLength(0);expect(fresh.imuRecording!.imu_02.packets[0].sequence).toBe(9);
  });
  it('closes the IMU session on camera startup failure and permits a clean next recording',async()=>{
    const h=mount();Recorder.failStart=1;start(h);const p=stop(h);
    act(()=>{Socket.instances[0].message(packet());Recorder.instances[0].finish();});
    const r=(await p)!;expect(r.status).toBe('failed');expect(r.imuRecording!.imu_01.packets).toHaveLength(0);
    Recorder.failStart=-1;start(h);expect((await finish(h)).imuRecording!.imu_01.status).toBe('empty');
  });
  it('disposes socket callbacks and closes the same capture boundary on unmount',async()=>{
    const h=mount(),ws=Socket.instances[0];start(h);act(()=>{ws.open();ws.message(packet());});
    const late=ws.onmessage;
    act(()=>{renderer!.unmount();renderer=undefined;});
    const p=stop(h);act(()=>{h.imu.reconnect();late({data:packet('imu_02')});Recorder.instances[0].finish();Recorder.instances[1].finish();});
    expect(Socket.instances).toHaveLength(1);
    const r=(await p)!;expect(ws.onmessage).toBeNull();expect(ws.closeCalls).toBe(1);
    expect(r.imuRecording!.imu_01.stopReason).toContain('unmount');expect(r.imuRecording!.imu_02.packets).toHaveLength(0);
    expect(r.imuRecording!.imu_01.durationMs).toBe(r.duration);expect(vi.getTimerCount()).toBe(0);
  });
  it('does not accept packets during an encoder stop timeout',async()=>{
    const h=mount();start(h);const p=stop(h);
    act(()=>{vi.advanceTimersByTime(5000);Socket.instances[0].message(packet());});
    expect((await p)!.imuRecording!.imu_01.packets).toHaveLength(0);
  });
  it('downloads two JSON sidecars after the compatible six camera files',async()=>{
    const raw = packet().replace(/}$/, ',"receiver_time_ns":1795081234567890123}');
    const h=mount();start(h);act(()=>Socket.instances[0].message(raw));const r=await finish(h);
    const blobs:Blob[]=[],names:string[]=[];
    vi.stubGlobal('document',{body:{appendChild(){},removeChild(){}},createElement:()=>({href:'',download:'',click(){names.push(this.download);}})});
    vi.spyOn(URL,'createObjectURL').mockImplementation(blob=>{blobs.push(blob as Blob);return 'blob:test';});
    vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
    h.camera.downloadRecording(r);expect(blobs).toHaveLength(8);
    expect(names[6]).toContain('_imu_01.json');expect(names[7]).toContain('_imu_02.json');
    const a=JSON.parse(await blobs[6].text()),b=JSON.parse(await blobs[7].text());
    expect(a.recordingId).toBe(r.id);expect(b.recordingId).toBe(r.id);
    expect(a.packets[0].rawMessage).toBe(raw);expect(b.packets).toEqual([]);
    expect(a.packets[0].browserReceiverTimestamp.receiverTimeNs).toBe('1795081234567890123');
    expect(a.packets[0].rawFields.receiver_time_ns).toBe('1795081234567890123');
    expect(a.diagnostics.invalidPacketCount).toBe(0);
    expect(a.schemaVersion).toBe('1.0.0-imu-recording');
    expect(createRecordingClockExport(r).recordingSummary.imuStreams!.imu_01.packetCount).toBe(1);
  });
});
