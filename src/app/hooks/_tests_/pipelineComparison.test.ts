import { describe, expect, it, vi } from 'vitest';
import { createComparisonRecorder, buildComparisonFrame, emptyComparisonPose, processComparisonCycle, summarizeComparison, COMPARISON_LIMITATIONS } from '../../utils/pipelineComparison';
import { createFusionController, NO_SIMULATED_FAILURES, type FusionFrameInput } from '../useIMUFusionController';
import { LANDMARK_KEYS, type TriangulatedPose } from '../useTriangulation';
import type { PoseLandmarks } from '../useMediaPipePose';
import type { ComparisonCycleInput } from '../../type/pipelineComparison';

const visual = () => Object.fromEntries(LANDMARK_KEYS.map((k, i) => [k, {x: i / 20, y: 0.5, z: 0.01, visibility: 0.9}])) as PoseLandmarks;
const pose = () => ({...emptyComparisonPose(), rightShoulder: {x: 0,y: 0,z: 1000}, rightElbow: {x: 300,y: 0,z: 1000}, rightWrist: {x: 550,y: 0,z: 1000}}) as TriangulatedPose;
function input(id = 1, now = 1100): ComparisonCycleInput {
  return {cycleId: id, timing: {processingStartedPerformanceNowMs: now, inferenceCompletedPerformanceNowMs: now + 10,
    cameraA: {sampledPerformanceNowMs: now,mediaTimeSeconds: 50},cameraB: {sampledPerformanceNowMs: now+5,mediaTimeSeconds: 40},cameraAPresentation: null,inferenceErrors: []},
    cameraA: visual(), cameraB: visual(), p2: pose(), p3: pose(), correction: [],
    fusion: {pose: pose(),diagnostics: null,imuSamples: {receiver_time_ns:'1795122513071000001'}},
    calibrationAvailable: true, errors: [], processingCompletedPerformanceNowMs: now+20};
}
const frame = (id = 1, now = 1100) => buildComparisonFrame(input(id, now));

describe('comparison records and session ownership', () => {
  it('associates all pipelines with one cycle and preserves independent camera clocks', () => {
    const f = frame(); expect(f.cycleId).toBe(1); expect(Object.keys(f.pipelines)).toEqual(['P1','P2','P3','P4']);
    expect(f.timing.cameraA.mediaTimeSeconds).toBe(50); expect(f.timing.cameraB.mediaTimeSeconds).toBe(40);
    expect(f.processingDurationMs).toBe(20); expect(f.pipelines.P1.pose.rightElbow).toEqual(visual().rightElbow);
  });
  it('snapshots final P4 independently from P3 and runtime references', () => {
    const i = input(); i.fusion.pose!.rightElbow = {x: 0,y: 300,z: 1000}; const f = buildComparisonFrame(i);
    expect(f.pipelines.P3.pose.rightElbow!.x).toBe(300); expect(f.pipelines.P4.pose.rightElbow!.y).toBe(300);
    i.fusion.pose!.rightElbow!.y = 999; i.p3.rightElbow!.x = 999;
    expect(f.pipelines.P4.pose.rightElbow!.y).toBe(300); expect(f.pipelines.P3.pose.rightElbow!.x).toBe(300);
  });
  it.each(['cameraA','cameraB'] as const)('retains explicit %s failures', key => {
    const i = input(); i[key] = null; i.p2 = emptyComparisonPose() as TriangulatedPose; i.p3 = i.p2; i.fusion.pose = i.p2;
    const f = buildComparisonFrame(i); expect(f.cameras[key].valid).toBe(false);
    expect(f.pipelines.P2.joints.rightElbow.reason).toBe(key === 'cameraA' ? 'missing_camera_a_pose' : 'missing_camera_b_pose');
    expect(f.pipelines.P2.pose.rightElbow).toBeNull();
  });
  it('distinguishes low visibility and failed triangulation', () => {
    const i = input(); i.cameraB!.rightElbow.visibility = 0.1; i.p2.rightElbow = null; i.p2.rightWrist = null;
    const f = buildComparisonFrame(i); expect(f.pipelines.P2.joints.rightElbow.reason).toBe('low_visibility');
    expect(f.pipelines.P2.joints.rightWrist.reason).toBe('triangulation_unavailable');
  });
  it('keeps a real zero coordinate valid and missing/nonfinite points null', () => {
    const i = input(); i.p2.rightShoulder = {x:0,y:0,z:0}; i.p2.rightElbow = null; i.p2.rightWrist = {x:NaN,y:0,z:0};
    const f = buildComparisonFrame(i); expect(f.pipelines.P2.joints.rightShoulder.valid).toBe(true);
    expect(f.pipelines.P2.pose.rightElbow).toBeNull(); expect(f.pipelines.P2.pose.rightWrist).toBeNull();
  });
  it('protects pre-start and post-stop boundaries and blocks overlapping starts', () => {
    const r = createComparisonRecorder(); const config = {calibration:{id:'unchanged'}};
    r.append(frame(),config); expect(r.getSession()).toBeNull();
    expect(r.start('s',1000,5000,200,config,null)).toBe(true); expect(r.start('other',1001,5001,0,{},null)).toBe(false);
    r.append(frame(0,999),config); expect(r.getSession()!.frames).toHaveLength(0);
    r.append(frame(),config); r.stop(1300,5300); r.append(frame(2,1400),config);
    expect(r.getSession()!.frames).toHaveLength(1); expect(config).toEqual({calibration:{id:'unchanged'}});
    expect(r.getSession()!.durationMs).toBe(300);
  });
  it('retains warmup samples and marks exact measurement boundary', () => {
    const r=createComparisonRecorder();r.start('s',1000,5000,200,{},null);r.append(frame(1,1199),{});r.append(frame(2,1200),{});
    expect(r.getSession()!.frames.map(f=>[f.experimentTimeMs,f.phase])).toEqual([[199,'warmup'],[200,'measurement']]);
  });
  it('detaches metadata, archived frames, preview and repeated sessions', () => {
    const r=createComparisonRecorder(), config={calibration:{id:1}};r.start('a',1000,0,0,config,frame());
    const shown=r.append(frame(),config);shown.pipelines.P4.pose.rightElbow!.x=999;config.calibration.id=2;
    r.stop(1200,200); const old=r.getSession()!;expect((old.metadata as typeof config).calibration.id).toBe(1);
    expect(old.frames[0].pipelines.P4.pose.rightElbow!.x).toBe(300);
    expect(r.clear()).toBe(true);r.start('b',2000,1000,0,{},null);r.append(frame(2,2100),{});
    expect(old.frames).toHaveLength(1);expect(r.getSession()!.sessionId).toBe('b');
  });
  it('journals configuration changes without modifying initial calibration', () => {
    const r=createComparisonRecorder();r.start('s',1000,0,0,{calibration:1},null);
    r.append(frame(),{calibration:1});r.append(frame(2,1200),{calibration:2});r.append(frame(3,1300),{calibration:2});
    expect(r.getSession()!.configurationChanges).toEqual([{experimentTimeMs:200,configuration:{calibration:2}}]);
    expect(r.getSession()!.metadata).toEqual({calibration:1});expect(r.clear()).toBe(false);
  });
  it('exports complete serializable frames and exact string timestamps', () => {
    const r=createComparisonRecorder();expect(()=>r.exportJson()).toThrow();r.start('s',1000,0,0,{limitations:COMPARISON_LIMITATIONS},null);
    r.append(frame(),{limitations:COMPARISON_LIMITATIONS});expect(()=>r.exportJson()).toThrow();r.stop(1300,300);
    const saved=JSON.parse(r.exportJson());expect(saved.frames[0].imuSamples.receiver_time_ns).toBe('1795122513071000001');
    expect(saved.schemaVersion).toBe('1.0.0-live-pipeline-comparison');expect(saved.diagnostics.totalProcessingCycles).toBe(1);
    expect(saved.frames[0].pipelines.P4.pose).toEqual(frame().pipelines.P4.pose);
  });
  it('handles empty sessions honestly and preserves the first stop boundary', () => {
    const r=createComparisonRecorder();r.start('s',1000,0,0,{},null);r.stop(1200,200,'component_unmount');r.stop(9999,9999);
    expect(r.getSession()!.durationMs).toBe(200);expect(r.getSession()!.diagnostics!.observedProcessingRateHz).toBeNull();
    expect(r.getSession()!.stopReason).toBe('component_unmount');
  });
  it('rejects duplicate cycle IDs and invalid warmup', () => {
    const r=createComparisonRecorder();expect(()=>r.start('s',1000,0,NaN,{},null)).toThrow();
    r.start('s',1000,0,0,{},null);r.append(frame(),{});r.append(frame(),{});expect(r.getSession()!.frames).toHaveLength(1);
  });
});

describe('shared processing with the existing fusion controller', () => {
  function setup() {
    const ctrl=createFusionController();let latest: ReturnType<typeof ctrl.processFusionFrame> | null=null;
    const correct=vi.fn((p:TriangulatedPose)=>({correctedPose:p,jointStatuses:LANDMARK_KEYS.map(joint=>({joint,reliable:p[joint]!==null,failureType:'none' as const,correctionMethod:'none' as const,requiresIMU:false}))}));
    const raw=pose();const triangulate=vi.fn(()=>raw);
    let age=20;
    const advanceLiveFusion=vi.fn((p:TriangulatedPose,_n:number,statuses:ReturnType<typeof correct>['jointStatuses'])=>{
      latest=ctrl.processFusionFrame({stereoShoulder:p.rightShoulder,stereoElbow:p.rightElbow,stereoWrist:p.rightWrist,
        imuUADir:[0,1,0],imuFADir:[0,1,0],jointStatuses:statuses,calibrationValid:true,calibUaLengthMm:300,calibFaLengthMm:250,
        imu01AgeMs:age,imu02AgeMs:age,simulated:NO_SIMULATED_FAILURES,nowMs:now} as FusionFrameInput);
    });
    let now=1100,id=0;
    const run=()=>{const i=input(++id,now);now+=33;return processComparisonCycle(i,{triangulate,correct,advanceLiveFusion,
      readFusion:()=>({pose:{...raw,rightShoulder:latest!.finalShoulder,rightElbow:latest!.finalElbow,rightWrist:latest!.finalWrist},diagnostics:latest!.diagnostics,imuSamples:null}),now:()=>now});};
    return {run,raw,triangulate,correct,advanceLiveFusion,setAge:(value:number)=>{age=value;}};
  }
  it('runs triangulation/correction/fusion once and healthy P4 follows P3 despite distinct IMUs', () => {
    const s=setup(),f=s.run();expect(s.triangulate).toHaveBeenCalledTimes(1);expect(s.correct).toHaveBeenCalledTimes(1);expect(s.advanceLiveFusion).toHaveBeenCalledTimes(1);
    expect(f.pipelines.P4.pose.rightElbow).toEqual(f.pipelines.P3.pose.rightElbow);expect(f.imuCorrectionActive).toBe(false);
  });
  it('records actual IMU substitutions without contaminating P3', () => {
    const s=setup();s.run();s.raw.rightElbow=null;s.raw.rightWrist=null;let f=s.run();for(let n=0;n<5;n++)f=s.run();
    expect(f.fusion!.uaState).toBe('IMU_CORRECTION');expect(f.imuCorrectionActive).toBe(true);
    expect(f.pipelines.P3.pose.rightElbow).toBeNull();expect(f.pipelines.P4.pose.rightElbow).not.toBeNull();
  });
  it('uses the existing stale-IMU fallback', () => {
    const s=setup();s.run();s.raw.rightElbow=null;s.raw.rightWrist=null;s.setAge(1000);const f=s.run();
    expect(f.fusion!.uaState).toBe('UNAVAILABLE');expect(f.pipelines.P4.pose.rightElbow).toBeNull();
  });
  it('preserves recovery confirmation/blending and counts transitions', () => {
    const s=setup(),frames=[s.run()];s.raw.rightElbow=null;s.raw.rightWrist=null;frames.push(s.run());
    Object.assign(s.raw,pose());frames.push(s.run());expect(frames.at(-1)!.fusion!.uaState).toBe('RECOVERY');
    expect(frames.at(-1)!.imuCorrectionActive).toBe(true);
    expect(frames.at(-1)!.fusion!.uaRecoveryPhase).toBe('confirming');
    for(let n=0;n<12;n++)frames.push(s.run());expect(frames.at(-1)!.fusion!.uaState).toBe('STEREO');
    expect(summarizeComparison(frames).events.upperArmIMUEntries).toBe(1);expect(summarizeComparison(frames).events.upperArmRecoveryEntries).toBe(1);
  });
  it('advances missing-person cycles and does not reuse a stale visual skeleton', () => {
    const correct=vi.fn((p:TriangulatedPose)=>({correctedPose:p,jointStatuses:[]})),advance=vi.fn(),triangulate=vi.fn(()=>pose());
    const f=processComparisonCycle({...input(),cameraA:null,cameraB:null},{triangulate,correct,advanceLiveFusion:advance,readFusion:()=>({pose:emptyComparisonPose() as TriangulatedPose,diagnostics:null,imuSamples:null}),now:()=>1120});
    expect(triangulate).not.toHaveBeenCalled();expect(correct).toHaveBeenCalledOnce();expect(advance).toHaveBeenCalledOnce();
    expect(f.pipelines.P1.status).toBe('unavailable');expect(f.pipelines.P3.status).toBe('unavailable');
  });
  it('retains processing errors as a failed cycle', () => {
    const f=processComparisonCycle(input(),{triangulate:()=>{throw Error('bad SVD');},correct:()=>{throw Error('bad correction');},advanceLiveFusion:()=>{},readFusion:()=>{throw Error('must not read stale fusion');},now:()=>1120});
    expect(f.errors).toHaveLength(2);expect(f.pipelines.P4.status).toBe('unavailable');
  });
  it('protects the P3 baseline even if an integration mutates its fusion input', () => {
    let fused=pose();
    const f=processComparisonCycle(input(),{triangulate:pose,correct:p=>({correctedPose:p,jointStatuses:[]}),
      advanceLiveFusion:p=>{p.rightElbow={x:777,y:0,z:1000};fused=p;},readFusion:()=>({pose:fused,diagnostics:null,imuSamples:null}),now:()=>1120});
    expect(f.pipelines.P3.pose.rightElbow!.x).toBe(300);expect(f.pipelines.P4.pose.rightElbow!.x).toBe(777);
  });
});
