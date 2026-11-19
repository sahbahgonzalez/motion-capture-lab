import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { useDualCamera } from '../useDualCamera';
import { useMasterExperimentRecorder } from '../useMasterExperimentRecorder';
import { createIMURecordingSource } from '../../utils/imuRecording';
import { createMasterSessionZip, immutableJson, snapshotValue } from '../../utils/masterSession';
import type { MasterControllerOptions, MasterReadiness, RuntimeSnapshot } from '../../type/masterSession';

class Encoder {
  static instances: Encoder[]=[];static startDelay=0;static failStart=-1;static mime='video/webm';
  static isTypeSupported(){return true;}
  state='inactive';mimeType=Encoder.mime;index=Encoder.instances.length;
  onstart:any=null;ondataavailable:any=null;onstop:any=null;onerror:any=null;
  constructor(){Encoder.instances.push(this);}
  start(){if(this.index===Encoder.failStart)throw Error('start failure');this.state='recording';
    if(Encoder.startDelay)setTimeout(()=>this.onstart?.(),Encoder.startDelay);else this.onstart?.();}
  stop(){this.state='inactive';}
  data(text='video'){this.ondataavailable?.({data:new Blob([text])});}
  finish(text='video'){this.data(text);this.onstop?.();}
}
function video(){let id=0;const callbacks=new Map<number,any>();return {
  callbacks,videoWidth:1280,videoHeight:720,currentTime:0,
  requestVideoFrameCallback:(cb:any)=>{callbacks.set(++id,cb);return id;},
  cancelVideoFrameCallback:(key:number)=>callbacks.delete(key),
  fire(mediaTime=5){const entry=callbacks.entries().next().value;if(!entry)return;callbacks.delete(entry[0]);
    entry[1](performance.now(),{mediaTime,presentedFrames:1});},
};}
const packet=(sensor:string,seq=1)=>'{"sensor_id":"'+sensor+'","timestamp_us":100000,"sequence":'+seq+',"accuracy":3,"qw":1,"qx":0,"qy":0,"qz":0,"receiver_time_ns":1795081234567890123}';
const stream={getVideoTracks:()=>[{getSettings:()=>({width:1280,height:720,frameRate:30}),getConstraints:()=>({frameRate:{ideal:30}})}]} as unknown as MediaStream;
const ready=():MasterReadiness=>({streams:Object.fromEntries(['camera_a','camera_b','imu_01','imu_02'].map(id=>[id,{ready:true,reason:'live stream missing'}])) as MasterReadiness['streams'],processing:{ready:true,reason:'processing missing'}});
let renderer:ReactTestRenderer|undefined;
function mount(settings:{warmupMs?:number;captureStream?:MediaStream|null;clear?:boolean;createZip?:MasterControllerOptions['createZip']}={}){
  const a=video(),b=video(),imu=createIMURecordingSource();
  imu.connectionEvent('open',{state:'open',connectionId:'socket_1',url:'ws://test'},performance.now());
  const report=ready();
  const snapshot:RuntimeSnapshot={schemaVersion:'1.0.0-runtime-snapshot',values:{calibration:snapshotValue({R:[1,2,3],alpha:0.6},'runtime'),missing:snapshotValue(null,'runtime')},criticalMissing:[]};
  let hook!:ReturnType<typeof useMasterExperimentRecorder>;
  const options:MasterControllerOptions={warmupMs:settings.warmupMs??3000,getReadiness:()=>report,getRuntimeSnapshot:()=>snapshot,
    imuRecordingSource:imu.source,cameraA:{videoRef:{current:a as unknown as HTMLVideoElement}},cameraB:{videoRef:{current:b as unknown as HTMLVideoElement}},createZip:settings.createZip};
  function Harness(){hook=useMasterExperimentRecorder(settings.captureStream===null?null:stream,stream,options);return null;}
  act(()=>{renderer=create(createElement(Harness));});
  if(settings.clear!==false)act(()=>hook.sessions.forEach(session=>hook.deleteSession(session.manifest.sessionId)));
  return {get hook(){return hook;},a,b,imu,report,snapshot,options,
    start(){act(()=>hook.startRecording());},
    evidence(){act(()=>{a.fire(12);b.fire(2);Encoder.instances.at(-2)?.data('A-initial');Encoder.instances.at(-1)?.data('B-initial');
      imu.receive(packet('imu_01'),performance.now(),Date.now());imu.receive(packet('imu_02'),performance.now(),Date.now());});},
  };
}
function advance(ms:number){act(()=>vi.advanceTimersByTime(ms));}
async function finish(h:ReturnType<typeof mount>,a='A-final',b='B-final'){
  let p!:ReturnType<typeof h.hook.stopRecording>;act(()=>{p=h.hook.stopRecording();});
  act(()=>{Encoder.instances.at(-2)?.finish(a);Encoder.instances.at(-1)?.finish(b);});
  let result!:Awaited<typeof p>;await act(async()=>{result=await p;});return result!;
}
beforeEach(()=>{vi.useFakeTimers({toFake:['performance','setTimeout','clearTimeout','setInterval','clearInterval']});
  Encoder.instances=[];Encoder.startDelay=0;Encoder.failStart=-1;Encoder.mime='video/webm';vi.stubGlobal('MediaRecorder',Encoder);});
afterEach(()=>{act(()=>renderer?.unmount());renderer=undefined;act(()=>vi.runOnlyPendingTimers());vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

describe('Stage 2C master lifecycle and readiness',()=>{
  it('captures warmup without trimming and marks evaluation only after stabilization plus evidence',async()=>{
    const h=mount();h.start();expect(Encoder.instances).toHaveLength(2);h.evidence();
    advance(2900);expect(h.hook.phase).toBe('initializing');expect(h.hook.evaluationStartMs).toBeNull();
    advance(100);expect(h.hook.phase).toBe('ready');expect(h.hook.evaluationStartMs).toBe(3000);
    const r=await finish(h);expect(r.manifest.status).toBe('complete');
    expect(r.recording!.imuRecording!.imu_01.packets[0].experimentReceiveTimeMs).toBe(0);
    expect(r.recording!.cameraATiming.observations[0].mediaTimeSeconds).toBe(12);
    expect(r.recording!.cameraBTiming.observations[0].mediaTimeSeconds).toBe(2);
    expect(r.manifest.timeline.evaluationWindowStartMs).toBe(3000);
    expect(r.manifest.timeline.warmupEndPerformanceNowMs).toBe(3000);
  });
  it('reports missing streams and never assumes three seconds creates readiness',async()=>{
    const h=mount();h.report.streams.imu_02.ready=false;h.start();advance(5000);
    expect(Encoder.instances).toHaveLength(0);expect(h.hook.phase).toBe('warming_up');expect(h.hook.missing.join()).toContain('imu_02');
    let p!:ReturnType<typeof h.hook.stopRecording>;act(()=>{p=h.hook.stopRecording();});const r=(await p)!;
    expect(r.manifest.status).toBe('failed');expect(r.manifest.clock).toBeNull();expect(r.recording).toBeNull();
  });
  it('waits for unavailable cameras at precheck and handles a camera missing at actual start',async()=>{
    const h=mount({captureStream:null});h.start();expect(Encoder.instances).toHaveLength(0);
    expect(h.hook.sessions[0].manifest.status).toBe('failed');expect(h.hook.isRecording).toBe(false);
  });
  it('keeps delayed recorder start events separate from data and observation times',async()=>{
    Encoder.startDelay=1610;const h=mount({warmupMs:0});h.start();h.evidence();
    advance(1600);expect(h.hook.evaluationStartMs).toBeNull();advance(100);
    expect(h.hook.evaluationStartMs).toBe(1700);const r=await finish(h);
    expect((r.manifest.startupDelayAnalysis as any).camera_a.startEventDelayMs).toBe(1610);
    expect((r.manifest.startupDelayAnalysis as any).camera_a.dataObservedBeforeStartEvent).toBe(true);
    expect(r.recording!.cameraATiming.observations[0].experimentTimeMs).toBe(0);
    expect(r.manifest.limitations.join()).toContain('not hardware exposure');
  });
  it('does not mark evaluation ready without a valid post-start packet from each IMU',async()=>{
    const h=mount({warmupMs:0});h.start();act(()=>{h.a.fire();h.b.fire();Encoder.instances[0].data();Encoder.instances[1].data();h.imu.receive(packet('imu_01'),0,0);});
    advance(1000);expect(h.hook.evaluationStartMs).toBeNull();expect(h.hook.missing.join()).toContain('imu_02');
    const r=await finish(h);expect(r.manifest.status).toBe('partial');expect(r.manifest.streams.imu_02.status).toBe('missing');
  });
  it('restarts stabilization after a readiness loss but never shifts captured timestamps',async()=>{
    const h=mount();h.start();h.evidence();advance(2000);h.report.streams.imu_01.ready=false;advance(100);
    h.report.streams.imu_01.ready=true;advance(100);advance(2900);expect(h.hook.evaluationStartMs).toBeNull();advance(100);
    expect(h.hook.evaluationStartMs).toBe(5200);const r=await finish(h);
    expect(r.recording!.imuRecording!.imu_01.packets[0].experimentReceiveTimeMs).toBe(0);expect(r.manifest.status).toBe('partial');
  });
  it('stops during initialization and leaves recoverable partial streams without an evaluation window',async()=>{
    const h=mount();h.start();h.evidence();advance(500);const r=await finish(h);
    expect(r.manifest.status).toBe('partial');expect(r.manifest.timeline.evaluationWindowStartMs).toBeNull();
    expect(r.recording!.cam1Blob.size).toBeGreaterThan(0);
  });
  it('does not infer recorder readiness from elapsed stabilization alone',async()=>{
    const h=mount();h.start();act(()=>{h.b.fire();Encoder.instances[0].data();Encoder.instances[1].data();
      h.imu.receive(packet('imu_01'),0,0);h.imu.receive(packet('imu_02'),0,0);});
    advance(4000);expect(h.hook.evaluationStartMs).toBeNull();expect(h.hook.missing.join()).toContain('camera_a');
    act(()=>h.a.fire());advance(100);expect(h.hook.evaluationStartMs).toBe(4100);await finish(h);
  });
  it('cleans up while waiting for warmup readiness without creating encoders',()=>{
    const h=mount();h.report.processing.ready=false;h.start();advance(1000);
    act(()=>{renderer!.unmount();renderer=undefined;});expect(Encoder.instances).toHaveLength(0);expect(vi.getTimerCount()).toBe(0);
    const next=mount({clear:false});expect(next.hook.sessions[0].manifest.status).toBe('failed');
  });
  it('keeps empty required streams failed rather than complete',async()=>{
    const h=mount({warmupMs:0});h.start();advance(100);const r=await finish(h,'','');
    expect(r.manifest.status).toBe('failed');expect(Object.values(r.manifest.streams).every(stream=>!stream.usable)).toBe(true);
  });
  it('retains snapshot failures explicitly without starting recorders or substituting defaults',()=>{
    const h=mount();h.options.getRuntimeSnapshot=()=>{throw Error('snapshot unavailable');};h.start();
    expect(h.hook.sessions[0].manifest.status).toBe('failed');expect(h.hook.sessions[0].manifest.errors.join()).toContain('snapshot unavailable');
    expect(h.hook.isRecording).toBe(false);expect(Encoder.instances).toHaveLength(0);expect(vi.getTimerCount()).toBe(0);
  });

  it('uses one ID and exact shared origin across manifest, cameras and IMUs',async()=>{
    const h=mount({warmupMs:0});advance(23);h.start();h.evidence();advance(100);const r=await finish(h);
    const id=r.manifest.sessionId,origin=r.manifest.timeline.recordingOriginPerformanceNowMs;
    expect(r.recording!.id).toBe(id);expect(r.recording!.experimentSessionId).toBe(id);
    for(const sidecar of [r.recording!.cameraATiming,r.recording!.cameraBTiming,...Object.values(r.recording!.imuRecording!)]){
      expect(sidecar.recordingId).toBe(id);expect(sidecar.experimentStartPerformanceNowMs).toBe(origin);
    }
    expect(r.recording!.imuRecording!.imu_01.durationMs).toBe(r.manifest.durationMs);
  });
  it('blocks repeated starts/stops and isolates consecutive sessions',async()=>{
    const h=mount({warmupMs:0});h.start();h.start();h.evidence();advance(100);
    let p!:ReturnType<typeof h.hook.stopRecording>;act(()=>{p=h.hook.stopRecording();expect(h.hook.stopRecording()).toBe(p);h.hook.startRecording();});
    expect(Encoder.instances).toHaveLength(2);act(()=>{Encoder.instances[0].finish('first');Encoder.instances[1].finish('first');});const first=(await p)!;
    h.start();h.evidence();advance(100);const second=await finish(h);
    expect(first.manifest.sessionId).not.toBe(second.manifest.sessionId);expect(second.recording!.imuRecording!.imu_01.packets).toHaveLength(1);
    expect(h.hook.sessions).toHaveLength(2);
  });
  it('records actual configuration immutably and journals explicit runtime changes',async()=>{
    const h=mount({warmupMs:0});h.start();h.evidence();advance(100);
    (h.snapshot.values.calibration.value as any).alpha=0.3;
    act(()=>h.hook.notifyConfigurationChange());const r=await finish(h);
    expect((r.configuration.initial!.values.calibration.value as any).alpha).toBe(0.6);
    expect((r.configuration.changes[0].snapshot.values.calibration.value as any).alpha).toBe(0.3);
    (h.snapshot.values.calibration.value as any).alpha=0.1;
    expect((r.configuration.changes[0].snapshot.values.calibration.value as any).alpha).toBe(0.3);
    expect(r.configuration.initial!.values.missing.availability).toBe('unavailable');
    expect(Object.isFrozen(r.configuration.initial)).toBe(true);
  });
  it('marks a missing critical configuration snapshot as partial instead of substituting defaults',async()=>{
    const h=mount({warmupMs:0});h.snapshot.criticalMissing=['imuCalibration'];h.start();h.evidence();advance(100);const r=await finish(h);
    expect(r.manifest.status).toBe('partial');expect(r.manifest.configuration.completeForReplay).toBe(false);
  });
  it('preserves a disconnected IMU archive and reports partial completion',async()=>{
    const h=mount({warmupMs:0});h.start();h.evidence();advance(100);
    act(()=>h.imu.connectionEvent('close',{state:'closed',connectionId:'socket_1',url:'ws://test'},performance.now()));
    const r=await finish(h);expect(r.manifest.status).toBe('partial');expect(r.manifest.streams.imu_01.status).toBe('partial');
    expect(r.recording!.imuRecording!.imu_02.packets).toHaveLength(1);
  });
  it('coordinates camera errors and preserves available source data',async()=>{
    const h=mount({warmupMs:0});h.start();h.evidence();advance(100);act(()=>Encoder.instances[0].onerror());const r=await finish(h);
    expect(r.manifest.status).toBe('partial');expect(r.manifest.streams.camera_a.status).toBe('failed');expect(r.manifest.errors.join()).toContain('Camera A');
  });
  it('publishes late finalization to a lab remounted before the encoders finish',async()=>{
    const h=mount({warmupMs:0});h.start();h.evidence();advance(100);
    act(()=>{renderer!.unmount();renderer=undefined;});
    const next=mount({clear:false});expect(next.hook.sessions).toHaveLength(0);
    act(()=>{Encoder.instances[0].finish('late-A');Encoder.instances[1].finish('late-B');});
    expect(next.hook.sessions).toHaveLength(1);expect(await next.hook.sessions[0].recording!.cam1Blob.text()).toContain('late-A');
  });

  it('retains a failed startup without orphaned recorders or clocks',async()=>{
    Encoder.failStart=1;const h=mount({warmupMs:0});h.start();const r=await finish(h);
    expect(r.manifest.status).not.toBe('complete');expect(h.hook.isRecording).toBe(false);expect(vi.getTimerCount()).toBe(0);
  });
  it('settles encoder timeouts without extending the IMU or evaluation stop boundary',async()=>{
    const h=mount({warmupMs:0});h.start();h.evidence();advance(100);
    let p!:ReturnType<typeof h.hook.stopRecording>;act(()=>{p=h.hook.stopRecording();});advance(5000);const r=(await p)!;
    expect(r.manifest.durationMs).toBe(100);expect(r.recording!.imuRecording!.imu_01.durationMs).toBe(100);expect(vi.getTimerCount()).toBe(0);
  });
  it('recovers a session finalized after unmount in the same page',async()=>{
    const h=mount({warmupMs:0});h.start();h.evidence();advance(100);
    act(()=>{renderer!.unmount();renderer=undefined;});
    expect(Encoder.instances[0].state).toBe('inactive');
    act(()=>{Encoder.instances[0].finish('recover-A');Encoder.instances[1].finish('recover-B');});
    expect(h.a.callbacks.size+h.b.callbacks.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
    const recovered=mount({clear:false});const session=recovered.hook.sessions[0];
    expect(session.manifest.errors.join()).toContain('unmount');expect(await session.recording!.cam1Blob.text()).toContain('recover-A');
  });
});

describe('Stage 2C ZIP and export recovery',()=>{
  it('exports the stable directory structure and original bytes including exact receiver nanoseconds',async()=>{
    const h=mount({warmupMs:0});h.start();h.evidence();advance(100);const r=await finish(h);
    const zip=unzipSync(new Uint8Array(await (await createMasterSessionZip(r)).arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(['manifest.json','config/runtime_snapshot.json','cameras/camera_a.webm','cameras/camera_b.webm',
      'cameras/camera_a_timing.json','cameras/camera_b_timing.json','cameras/stereo_pairing.json','imus/imu_01.json','imus/imu_02.json','diagnostics/clock.json','diagnostics/errors.json'].sort());
    const secondZip=new Uint8Array(await (await createMasterSessionZip(r)).arrayBuffer());
    expect(new Uint8Array(await (await createMasterSessionZip(r)).arrayBuffer())).toEqual(secondZip);
    expect(zip['cameras/camera_a.webm']).toEqual(new Uint8Array(await r.recording!.cam1Blob.arrayBuffer()));
    expect(zip['cameras/camera_b.webm']).toEqual(new Uint8Array(await r.recording!.cam2Blob.arrayBuffer()));
    const imu=JSON.parse(strFromU8(zip['imus/imu_01.json']));
    expect(imu.packets[0].rawMessage).toBe(packet('imu_01'));expect(imu.packets[0].browserReceiverTimestamp.receiverTimeNs).toBe('1795081234567890123');
    expect(JSON.parse(strFromU8(zip['manifest.json'])).sessionId).toBe(r.manifest.sessionId);
    expect(JSON.parse(strFromU8(zip['diagnostics/clock.json'])).recordingId).toBe(r.manifest.sessionId);
  });
  it('adapts filenames to actual MP4 video blobs',async()=>{
    Encoder.mime='video/mp4';const h=mount({warmupMs:0});h.start();h.evidence();advance(100);const r=await finish(h);
    const files=unzipSync(new Uint8Array(await (await createMasterSessionZip(r)).arrayBuffer()));expect(files['cameras/camera_a.mp4']).toBeDefined();expect(files['cameras/camera_a.webm']).toBeUndefined();
  });
  it('exports honest missing-stream metadata for cancellation before capture',async()=>{
    const h=mount();h.report.streams.camera_a.ready=false;h.start();let p!:ReturnType<typeof h.hook.stopRecording>;act(()=>{p=h.hook.stopRecording();});const r=(await p)!;
    const files=unzipSync(new Uint8Array(await (await createMasterSessionZip(r)).arrayBuffer()));
    expect(files['cameras/camera_a.webm']).toBeUndefined();expect(JSON.parse(strFromU8(files['imus/imu_01.json'])).status).toBe('unavailable');
    expect(r.manifest.files.find(f=>f.path==='cameras/camera_a.webm')!.present).toBe(false);
  });
  it('does not fail usable streams merely because stereo callback pairing is imperfect',async()=>{
    const h=mount({warmupMs:0});h.start();act(()=>h.a.fire());advance(50);act(()=>h.b.fire());
    act(()=>{Encoder.instances[0].data();Encoder.instances[1].data();h.imu.receive(packet('imu_01'),50,0);h.imu.receive(packet('imu_02'),50,0);});advance(100);
    const r=await finish(h);expect(r.manifest.synchronization!.matchedObservationCount).toBe(0);expect(r.manifest.status).toBe('complete');
  });
  it('retains source sessions after ZIP failure and deduplicates concurrent download attempts',async()=>{
    let reject!: (reason:Error)=>void;
    const factory=vi.fn(()=>new Promise<Blob>((_resolve,no)=>{reject=no;}));const h=mount({warmupMs:0,createZip:factory});h.start();h.evidence();advance(100);const r=await finish(h);
    let first!:Promise<Blob>,second!:Promise<Blob>;act(()=>{first=h.hook.downloadSession(r);second=h.hook.downloadSession(r);});expect(second).toBe(first);
    await act(async()=>{await Promise.resolve();reject(Error('ZIP failure'));await first.catch(()=>{});});
    expect(factory).toHaveBeenCalledTimes(1);expect(h.hook.error).toContain('retained for retry');expect(h.hook.sessions.some(s=>s.manifest.sessionId===r.manifest.sessionId)).toBe(true);
    const names:string[]=[];vi.stubGlobal('document',{body:{appendChild(){},removeChild(){}},createElement:()=>({href:'',download:'',click(){names.push(this.download);}})});
    vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
    factory.mockImplementation(()=>Promise.resolve(new Blob(['zip'])));
    await act(async()=>{await h.hook.downloadSession(r);});expect(names).toEqual(['experiment_session_'+r.manifest.sessionId+'.zip']);
  });
  it('hands an in-flight ZIP to a remounted lab without duplicate generation or download',async()=>{
    let resolve!:(blob:Blob)=>void;const factory=vi.fn(()=>new Promise<Blob>(yes=>{resolve=yes;}));
    const h=mount({warmupMs:0,createZip:factory});h.start();h.evidence();advance(100);const r=await finish(h);
    let old!:Promise<Blob>;act(()=>{old=h.hook.downloadSession(r);});await act(async()=>{await Promise.resolve();});
    act(()=>{renderer!.unmount();renderer=undefined;});const next=mount({clear:false,createZip:factory});
    const names:string[]=[];vi.stubGlobal('document',{body:{appendChild(){},removeChild(){}},createElement:()=>({href:'',download:'',click(){names.push(this.download);}})});
    vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
    let handed!:Promise<Blob>;act(()=>{handed=next.hook.downloadSession(r);});
    await act(async()=>{resolve(new Blob(['zip']));await old;await handed;});
    expect(factory).toHaveBeenCalledTimes(1);expect(names).toEqual(['experiment_session_'+r.manifest.sessionId+'.zip']);
  });

  it('rejects non-serializable configuration rather than silently replacing it with defaults',()=>{
    expect(()=>immutableJson({callback:()=>{}})).toThrow('non-serializable');
    expect((immutableJson({value:Infinity}) as any).value.availability).toBe('unavailable');
  });
});


describe('Stage 2C camera-owner cleanup',()=>{
  function cameraEnvironment(getUserMedia:any){
    // This cleanup fixture intentionally enumerates no physical cameras.
    vi.spyOn(console,'log').mockImplementation(()=>{});vi.spyOn(console,'warn').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
    vi.stubGlobal('navigator',{mediaDevices:{enumerateDevices:async()=>[],getUserMedia,addEventListener(){},removeEventListener(){}}});
  }
  it('releases both current camera streams when the lab unmounts',async()=>{
    const stopA=vi.fn(),stopB=vi.fn();
    const makeStream=(stop:any)=>({getTracks:()=>[{stop}],getVideoTracks:()=>[{label:'camera',getSettings:()=>({})}]});
    cameraEnvironment(vi.fn().mockResolvedValueOnce(makeStream(stopA)).mockResolvedValueOnce(makeStream(stopB)));
    let hook!:ReturnType<typeof useDualCamera>;function Harness(){hook=useDualCamera();return null;}
    await act(async()=>{renderer=create(createElement(Harness));});
    await act(async()=>{await hook.startCamera1('A');await hook.startCamera2('B');});
    act(()=>{renderer!.unmount();renderer=undefined;});expect(stopA).toHaveBeenCalledTimes(1);expect(stopB).toHaveBeenCalledTimes(1);
  });
  it.each([1,2])('releases camera %i acquired after unmount instead of orphaning a track',async(camera)=>{
    let resolve!:(stream:any)=>void;const stop=vi.fn();cameraEnvironment(vi.fn(()=>new Promise(yes=>{resolve=yes;})));
    let hook!:ReturnType<typeof useDualCamera>;function Harness(){hook=useDualCamera();return null;}
    await act(async()=>{renderer=create(createElement(Harness));});
    let pending!:Promise<void>;act(()=>{pending=camera===1?hook.startCamera1('A'):hook.startCamera2('B');});
    act(()=>{renderer!.unmount();renderer=undefined;});
    await act(async()=>{resolve({getTracks:()=>[{stop}]});await pending;});expect(stop).toHaveBeenCalledTimes(1);
  });
});
