import {describe,expect,it} from 'vitest';
import {LANDMARK_KEYS} from '../useTriangulation';
import {evaluateSession} from '../../evaluation/metrics';
import {evaluationCsv,evaluationSidecar,evaluationSummary,metricsRows} from '../../evaluation/exports';
import {importComparisonSession} from '../../evaluation/importSession';
import {statistics} from '../../evaluation/statistics';
import type {Annotation} from '../../evaluation/types';

const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
function frame(index:number,ua='STEREO',fa='STEREO'):any {
  const pose=Object.fromEntries(LANDMARK_KEYS.map((joint,i)=>[joint,{x:i*10,y:0,z:1000}]));
  pose.rightShoulder={x:0,y:0,z:1000};pose.rightElbow={x:300,y:0,z:1000};pose.rightWrist={x:550,y:0,z:1000};
  return {cycleId:index,experimentTimeMs:index*100,phase:'measurement',processingDurationMs:10,
    timing:{processingStartedPerformanceNowMs:1000+index*100,inferenceCompletedPerformanceNowMs:1004+index*100,cameraAPresentation:{presentedFrames:index}},processingCompletedPerformanceNowMs:1010+index*100,
    pipelines:Object.fromEntries(['P1','P2','P3','P4'].map(id=>[id,{pose:clone(pose),joints:Object.fromEntries(LANDMARK_KEYS.map(j=>[j,{valid:true,reason:null}]))}])),
    fusion:{uaState:ua,faState:fa,uaFailureReason:ua==='IMU_CORRECTION'?'Shoulder missing':null,faFailureReason:fa==='IMU_CORRECTION'?'Wrist missing':null,simulated:{shoulder:false,elbow:false,wrist:false}},
    imuCorrectionActive:[ua,fa].some(s=>s==='IMU_CORRECTION'||s==='RECOVERY'),correction:[]};
}
function session(frames=Array.from({length:5},(_,i)=>frame(i))):any {
  return {schemaVersion:'1.0.0-live-pipeline-comparison',sessionId:'synthetic',status:'stopped',durationMs:frames.length*100,originPerformanceNowMs:1000,warmupEndExperimentTimeMs:0,
    metadata:{imuCalibration:{quality:'good',uaLengthMm:300,faLengthMm:250},stereoGeometry:{method:'synthetic-test-geometry'}},configurationChanges:[],frames};
}
function invalid(f:any,id='P3',joint='rightWrist'){f.pipelines[id].joints[joint]={valid:false,reason:'low_visibility'};}
const whole=(s:any,config:any={})=>evaluateSession(s,config).scopes[0];

describe('availability, warmup and phase semantics',()=>{
  it('evaluates fully visible healthy stereo without activating IMUs',()=>{
    const r=evaluateSession(session());const s=r.scopes[0];
    expect(s.frameCount).toBe(5);expect(s.availability.P4.rightWrist.availabilityPercent).toBe(100);
    expect(s.performance.effectiveFps).toBe(10);expect(s.controllers.forearm.correctionActivations).toBe(0);
    expect(s.controllers.forearm.stateTimeMs.STEREO).toBe(500);expect(s.controllers.forearm.activationsDuringAnnotatedHealthy).toBeNull();
  });
  it('counts actual false validity despite finite coordinates and preserves P4 recovery counts',()=>{
    const frames=[frame(0),frame(1,'STEREO','IMU_CORRECTION'),frame(2,'STEREO','IMU_CORRECTION'),frame(3,'STEREO','RECOVERY'),frame(4)];
    invalid(frames[1]);invalid(frames[2]);const r=evaluateSession(session(frames)),s=r.scopes[0];
    expect(s.availability.P3.rightWrist.validFrames).toBe(3);expect(s.availability.P3.rightWrist.availabilityPercent).toBe(60);
    expect(s.availability.P3.rightWrist.longestMissingIntervalMs).toBe(200);expect(s.availability.P3.rightWrist.meanCompleteMissingIntervalMs).toBe(200);
    expect(s.p3VersusP4.rightWrist).toEqual({bothValid:3,bothInvalid:0,recoveredByP4:2,lostByP4:0,improvementPercentagePoints:40});
    expect(s.imuActiveFrames).toBe(3);expect(s.controllers.forearm.correctionFramePercent).toBe(40);
    expect(s.controllers.forearm.stateTimeMs).toEqual({STEREO:200,IMU_CORRECTION:200,RECOVERY:100,UNAVAILABLE:0,UNKNOWN:0});
    expect(s.controllers.forearm.correctionDurationMs.mean).toBe(200);expect(s.controllers.forearm.recoveryDurationMs.mean).toBe(100);
    const e=r.events.find(e=>e.kind==='correction_activation')!;expect(e.recordedCycleSeparationMs).toBe(0);expect(e.failureToActivationMs).toBeNull();
  });
  it('counts both-invalid and P3-only valid cycles without inferring an improvement',()=>{
    const fs=[frame(0),frame(1),frame(2)];invalid(fs[0]);invalid(fs[0],'P4');invalid(fs[1],'P4');
    expect(whole(session(fs)).p3VersusP4.rightWrist).toEqual({bothValid:1,bothInvalid:1,recoveredByP4:0,lostByP4:1,improvementPercentagePoints:-100/3});
  });
  it('excludes warmup by default and retains explicit whole-session evaluation',()=>{
    const s=session();s.warmupEndExperimentTimeMs=200;s.frames[0].phase=s.frames[1].phase='warmup';
    const r=evaluateSession(s);expect(r.summary.warmupCycles).toBe(2);expect(r.scopes[0].frameIndices).toEqual([2,3,4]);
    expect(r.scopes[0].motion.P4.rightWrist.overall.intervals).toBe(2);
    expect(whole(s,{includeWarmup:true}).frameCount).toBe(5);
  });
  it('uses half-open timestamp and absolute-index phases with separate healthy annotations',()=>{
    const s=session(Array.from({length:6},(_,i)=>frame(i)));
    const annotations:Annotation[]=[{id:'visible',label:'Visible',coordinate:'time_ms',start:0,end:300,healthyVisibility:true},{id:'occluded',label:'Occluded',coordinate:'frame_index',start:3,end:6,healthyVisibility:false}];
    const r=evaluateSession(s,{annotations});expect(r.scopes.find(s=>s.id==='visible')!.frameIndices).toEqual([0,1,2]);
    expect(r.scopes.find(s=>s.id==='occluded')!.frameIndices).toEqual([3,4,5]);expect(r.scopes.find(s=>s.id==='unlabeled')!.frameCount).toBe(0);
    expect(r.scopes[0].controllers.upperArm.activationsDuringAnnotatedHealthy).toBe(0);
  });
  it('rejects overlapping, reversed, invalid and reserved annotation boundaries',()=>{
    const a:Annotation={id:'a',label:'test',coordinate:'time_ms',start:0,end:200,healthyVisibility:false};
    expect(()=>evaluateSession(session(),{annotations:[a,{...a,id:'b',start:100}]})).toThrow(/Overlapping/);
    expect(()=>evaluateSession(session(),{annotations:[{...a,end:0}]})).toThrow();
    expect(()=>evaluateSession(session(),{annotations:[{...a,id:'whole'}]})).toThrow(/reserved/);
    expect(()=>evaluateSession(session(),{annotations:[{...a,coordinate:'frame_index',end:100}]})).toThrow(/indices/);
  });
  it('does not bridge non-contiguous state-filtered samples',()=>{
    const fs=[frame(0),frame(1,'IMU_CORRECTION'),frame(2)];
    const s=whole(session(fs),{controllerFilter:{controller:'upperArm',state:'STEREO'}});
    expect(s.frameIndices).toEqual([0,2]);expect(s.motion.P4.rightWrist.overall.intervals).toBe(0);expect(s.performance.effectiveFps).toBeNull();
  });
  it('censors missing runs that reach recording boundaries',()=>{
    const fs=[frame(0),frame(1),frame(2)];invalid(fs[0]);invalid(fs[2]);const a=whole(session(fs)).availability.P3.rightWrist;
    expect(a.missingIntervals[0].leftCensored).toBe(true);expect(a.missingIntervals[1].rightCensored).toBe(true);expect(a.meanCompleteMissingIntervalMs).toBeNull();
  });
});
describe('controller transitions and observable latency',()=>{
  it('retains correction activations and interrupted versus completed recoveries',()=>{
    const fs=['STEREO','IMU_CORRECTION','RECOVERY','IMU_CORRECTION','RECOVERY','STEREO'].map((s,i)=>frame(i,'STEREO',s));
    const m=whole(session(fs)).controllers.forearm;
    expect(m.correctionActivations).toBe(2);expect(m.activationReasons['Wrist missing']).toBe(2);
    expect(m.recoveryEpisodes).toHaveLength(2);expect(m.interruptedRecoveries).toBe(1);expect(m.unsuccessfulRecoveries).toBe(1);
  });
  it('does not count a correction already active at recording start as a new activation',()=>{
    const s=whole(session([frame(0,'IMU_CORRECTION','IMU_CORRECTION'),frame(1,'IMU_CORRECTION','IMU_CORRECTION')]));
    expect(s.controllers.upperArm.correctionActivations).toBe(0);expect(s.controllers.upperArm.correctionEpisodes[0].leftCensored).toBe(true);
  });
  it('reports sampled positive lag only when prior failure onset and timing are observable',()=>{
    const fs=[frame(0),frame(1),frame(2,'STEREO','IMU_CORRECTION')];invalid(fs[1]);invalid(fs[2]);
    const e=evaluateSession(session(fs)).events.find(e=>e.kind==='correction_activation')!;
    expect(e.failureObservedIndex).toBe(1);expect(e.failureToActivationMs).toBe(100);
    const unknown=[frame(0),frame(1,'STEREO','IMU_CORRECTION')];invalid(unknown[0]);invalid(unknown[1]);
    expect(evaluateSession(session(unknown)).events[0].failureToActivationMs).toBeNull();
  });
  it('counts activations during explicitly healthy annotations without inferring labels from states',()=>{
    const r=evaluateSession(session([frame(0),frame(1,'STEREO','IMU_CORRECTION')]),{annotations:[{id:'healthy',label:'User marked visible',coordinate:'time_ms',start:0,end:200,healthyVisibility:true}]});
    expect(r.scopes[0].controllers.forearm.activationsDuringAnnotatedHealthy).toBe(1);
  });
  it('separates unknown controller states and does not infer activation through them',()=>{
    const fs=[frame(0),frame(1),frame(2,'STEREO','IMU_CORRECTION')];delete fs[1].fusion;
    const r=evaluateSession(session(fs));expect(r.scopes[0].controllers.forearm.stateFrames.UNKNOWN).toBe(1);expect(r.scopes[0].controllers.forearm.correctionActivations).toBe(0);
  });
});
describe('anatomy, continuity and computation',()=>{
  it('computes population dispersion, MAD, IQR and interpolated percentiles',()=>{
    const s=statistics([1,2,3,4,null,NaN]);expect(s.mean).toBe(2.5);expect(s.stdDev).toBeCloseTo(Math.sqrt(1.25));expect(s.mad).toBe(1);expect(s.iqr).toBe(1.5);expect(s.p95).toBeCloseTo(3.85);
    expect(statistics([]).mean).toBeNull();expect(statistics([7]).stdDev).toBe(0);
  });
  it('uses active calibration changes rather than learned FK reference lengths',()=>{
    const s=session(Array.from({length:4},(_,i)=>frame(i)));
    s.frames.forEach((f:any)=>{f.fusion.uaReferenceLengthMm=999;});
    s.configurationChanges=[{experimentTimeMs:200,configuration:{imuCalibration:{quality:'good',uaLengthMm:600,faLengthMm:300}}}];
    const a=whole(s).anatomical.P3.rightUpperArm;
    expect(a.framesWithReference).toBe(4);expect(a.calibratedReferenceMm.mean).toBe(450);expect(a.exceedingThresholdFrames).toBe(2);expect(a.exceedingThresholdPercent).toBe(50);
  });
  it('uses explicit per-frame calibrated lengths before configuration and keeps left-arm reference unavailable',()=>{
    const s=session();s.frames.forEach((f:any)=>{f.fusion.segmentLengthDiagnostics={upperArm:{calibratedMm:400}};});
    const a=whole(s).anatomical.P4;expect(a.rightUpperArm.deviationMm.mean).toBe(-100);expect(a.rightUpperArm.exceedingThresholdPercent).toBe(0);
    expect(a.leftUpperArm.framesWithReference).toBe(0);expect(a.leftUpperArm.exceedingThresholdPercent).toBeNull();
  });
  it('groups P2/P3/P4 lengths by the actual P4 controller state without creating P1 metric lengths',()=>{
    const r=whole(session([frame(0),frame(1,'STEREO','IMU_CORRECTION')]));
    expect(r.anatomical.P3.rightForearm.byControllerState.IMU_CORRECTION!.count).toBe(1);expect(r.anatomical).not.toHaveProperty('P1');
  });
  it('uses elapsed time, keeps transition neighborhoods separate and reports screening counts',()=>{
    const fs=[frame(0),frame(1),frame(2,'STEREO','IMU_CORRECTION'),frame(3,'STEREO','RECOVERY')];
    [550,560,580,620].forEach((x,i)=>{fs[i].pipelines.P4.pose.rightWrist.x=x;});
    const m=whole(session(fs),{transitionWindowMs:0,jumpDistanceMm:25,jumpSpeedMmPerSecond:250}).motion.P4.rightWrist;
    expect(m.overall.displacement.mean).toBeCloseTo(70/3);expect(m.overall.speed.p95).toBeCloseTo(380);
    expect(m.overall.largeDisplacementCount).toBe(1);expect(m.overall.largeSpeedCount).toBe(1);
    expect(m.ordinary.intervals).toBe(1);expect(m.nearActivation.displacement.mean).toBe(20);expect(m.nearRecovery.displacement.mean).toBe(40);
  });
  it('does not bridge missing joints or over-limit timing gaps',()=>{
    const fs=[frame(0),frame(1),frame(2),frame(3)];invalid(fs[1],'P4');fs[3].experimentTimeMs=1000;
    const s=whole(session(fs));expect(s.motion.P4.rightWrist.overall.intervals).toBe(0);expect(s.motion.P4.rightWrist.excludedTimingGaps).toBe(1);
  });
  it('does not mix inferred P1 depth with normalized XY continuity',()=>{
    const fs=[frame(0),frame(1)];fs[1].pipelines.P1.pose.rightWrist.z=99999;
    const m=whole(session(fs)).motion.P1.rightWrist;expect(m.units).toBe('normalized_image_xy');expect(m.overall.displacement.mean).toBe(0);
  });
  it('keeps shared computational spans distinct from cadence and per-pipeline timings',()=>{
    const p=whole(session()).performance;expect(p.effectiveFps).toBe(10);expect(p.processingDurationMs.mean).toBe(10);expect(p.inferenceSpanMs.mean).toBe(4);expect(p.postInferenceSpanMs.mean).toBe(6);
    expect(p.perPipelineDurationMs.P4.mean).toBeNull();
  });
  it('handles duplicate and reversed timestamps without sorting or fabricating speeds',()=>{
    const s=session();[0,100,100,50,500].forEach((t,i)=>{s.frames[i].experimentTimeMs=t;});
    const r=evaluateSession(s);expect(r.quality.duplicateTimestamps).toBe(1);expect(r.quality.nonMonotonicTimestamps).toBe(1);
    expect(r.frames.map(f=>f.timeMs)).toEqual([0,100,100,50,500]);expect(r.scopes[0].motion.P4.rightWrist.overall.intervals).toBe(1);
    expect(r.scopes[0].performance.largeObservationGaps).toBe(1);
  });
  it('reports cycle/presentation counter gaps as indicators',()=>{
    const s=session([frame(0),frame(1)]);s.frames[1].cycleId=4;s.frames[1].timing.cameraAPresentation.presentedFrames=3;
    const p=whole(s).performance;expect(p.skippedCycleIdIndicators).toBe(3);expect(p.skippedCameraAPresentationIndicators).toBe(2);
  });
});
describe('legacy, malformed, deterministic and exported reports',()=>{
  it('accepts earlier comparison exports with missing optional fields',()=>{
    const s=session();delete s.schemaVersion;delete s.metadata.stereoGeometry;
    for(const f of s.frames){for(const id of ['P1','P2','P3','P4'])delete f.pipelines[id].joints;delete f.fusion;delete f.processingDurationMs;delete f.timing;delete f.processingCompletedPerformanceNowMs;}
    const r=evaluateSession(s);expect(r.source.schema).toBe('legacy-comparison');expect(r.quality.inferredValiditySamples).toBe(5*13*4);
    expect(r.scopes[0].availability.P4.rightWrist.validFrames).toBe(5);expect(r.scopes[0].performance.processingDurationMs.mean).toBeNull();
    expect(r.warnings.some(w=>w.includes('Geometry version'))).toBe(true);
  });
  it('retains malformed known-schema cycles as missing observations',()=>{
    const s=session([frame(0),null,{}]);const r=evaluateSession(s);expect(r.summary.totalCycles).toBe(3);expect(r.quality.malformedFrames).toBe(2);
    expect(r.scopes[0].availability.P4.rightWrist.missingFrames).toBe(2);
  });
  it('reports missing time as unavailable rather than zero durations',()=>{
    const s=session();delete s.originPerformanceNowMs;for(const f of s.frames){delete f.experimentTimeMs;delete f.timing;}
    const r=evaluateSession(s);expect(r.quality.missingTimestamps).toBe(5);expect(r.scopes[0].controllers.forearm.stateTimeMs.STEREO).toBeNull();expect(r.scopes[0].motion.P4.rightWrist.overall.speed.mean).toBeNull();
  });
  it('derives explicit relative times only from the recorded shared origin',()=>{
    const s=session();delete s.frames[1].experimentTimeMs;expect(importComparisonSession(s).frames[1].timeMs).toBe(100);expect(importComparisonSession(s).frames[1].timeSource).toBe('performance_origin');
  });
  it('handles empty recordings with null statistical results',()=>{
    const r=evaluateSession(session([]));expect(r.summary.completeness).toBe('empty');expect(r.scopes[0].frameCount).toBe(0);expect(r.scopes[0].availability.P4.rightWrist.availabilityPercent).toBeNull();
    expect(r.scopes[0].performance.effectiveFps).toBeNull();expect(r.scopes[0].anatomical.P4.rightUpperArm.lengthMm.mean).toBeNull();
  });
  it('never treats low visibility or invalid/nonfinite positions as valid despite a true flag',()=>{
    const s=session();s.frames[0].pipelines.P4.pose.rightWrist.visibility=.1;s.frames[1].pipelines.P4.pose.rightWrist.x=NaN;s.frames[2].pipelines.P4.pose.rightWrist=null;
    expect(whole(s).availability.P4.rightWrist.validFrames).toBe(2);
  });
  it('is deterministic and does not mutate a source recording or configuration',()=>{
    const s=session(),before=JSON.stringify(s),c={annotations:[]};const r=evaluateSession(s,c);
    expect(JSON.stringify(evaluateSession(s,c))).toBe(JSON.stringify(r));expect(JSON.stringify(s)).toBe(before);expect(c).toEqual({annotations:[]});
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
  it('exports CSV, neutral narrative and a session-bound configuration sidecar',()=>{
    const s=session([frame(0),frame(1,'STEREO','IMU_CORRECTION')]);s.frames[1].fusion.faFailureReason='=SUM(1,2)';
    const r=evaluateSession(s),csv=evaluationCsv(r),sidecar=JSON.parse(evaluationSidecar(r)),summary=evaluationSummary(r);
    expect(csv.startsWith('session_id,')).toBe(true);expect(csv).toContain('availability');expect(metricsRows(r).length).toBeGreaterThan(100);
    expect(sidecar.sessionId).toBe('synthetic');expect(sidecar.config).toEqual(r.config);
    expect(summary).toContain('not proven positional accuracy');expect(summary).toContain('latency not identifiable');
  });
  it('rejects unsupported schemas, single-pipeline files and invalid thresholds clearly',()=>{
    expect(()=>evaluateSession({...session(),schemaVersion:'2.0.0'})).toThrow(/Unsupported/);
    expect(()=>evaluateSession({frames:[{landmarks:{}}]})).toThrow(/single-pipeline/);
    expect(()=>evaluateSession(session(),{maxObservationGapMs:0})).toThrow(/threshold/);
  });
});
