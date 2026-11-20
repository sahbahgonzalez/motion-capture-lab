import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { createFusionController, useIMUFusionController, DEFAULT_FUSION_CONFIG, FUSION_FAILURE_POLICY, NO_SIMULATED_FAILURES, type FusionFrameInput, type FusionFrameResult } from '../useIMUFusionController';
import { usePoseFailureCorrection } from '../usePoseFailureCorrection';
import { triangulateAllLandmarks, LANDMARK_KEYS, type TriangulatedPose } from '../useTriangulation';
import type { PoseLandmarks } from '../useMediaPipePose';
import { buildComparisonFrame, createComparisonRecorder, emptyComparisonPose } from '../../utils/pipelineComparison';
import type { StereoCalibration } from '../../type/calibration';

const shoulder={x:0,y:0,z:2000};
const statuses=()=>['rightShoulder','rightElbow','rightWrist'].map(joint=>({joint:joint as 'rightShoulder'|'rightElbow'|'rightWrist',failureType:'none' as const,reliable:true,correctionMethod:'none' as const,requiresIMU:false}));
function input(delta=.5,overrides:Partial<FusionFrameInput>={}):FusionFrameInput {
  const elbow={x:300*(1+delta),y:0,z:2000},wrist={x:550*(1+delta),y:0,z:2000};
  return {stereoShoulder:shoulder,stereoElbow:elbow,stereoWrist:wrist,imuUADir:[0,1,0],imuFADir:[0,0,1],jointStatuses:statuses(),calibrationValid:true,calibUaLengthMm:300,calibFaLengthMm:250,imu01AgeMs:10,imu02AgeMs:10,simulated:NO_SIMULATED_FAILURES,nowMs:1000,...overrides};
}
function expectStereo(r:FusionFrameResult,i:FusionFrameInput) {
  expect(r.diagnostics.uaState).toBe('STEREO');expect(r.diagnostics.faState).toBe('STEREO');
  for(const [actual,expected] of [[r.finalShoulder,i.stereoShoulder],[r.finalElbow,i.stereoElbow],[r.finalWrist,i.stereoWrist]]) {
    expect(actual!.x).toBeCloseTo(expected!.x,10);expect(actual!.y).toBeCloseTo(expected!.y,10);expect(actual!.z).toBeCloseTo(expected!.z,10);
  }
  expect(r.diagnostics.uaFailureReason).toBeNull();expect(r.diagnostics.faFailureReason).toBeNull();
}

describe('production fusion has no segment-length failure condition',()=>{
  it.each([.1,.3,.5,1,2,-.1,-.3,-.5,-.8,-1])('keeps both segments stereo with %s fractional mismatch',delta=>{
    const ctrl=createFusionController();
    for(let frame=0;frame<20;frame++) {
      const i=input(delta,{nowMs:1000+frame*33,imuUADir:frame%2?[1,0,0]:[0,1,0],imuFADir:frame%2?[0,0,1]:[0,-1,0]});
      expectStereo(ctrl.processFusionFrame(i),i);
    }
  });
  it('never rejects reliable stereo because IMUs are stale or calibration is unavailable',()=>{
    const i=input(3,{imu01AgeMs:9999,imu02AgeMs:9999,calibrationValid:false,imuUADir:null,imuFADir:null,calibUaLengthMm:0,calibFaLengthMm:0});
    expectStereo(createFusionController().processFusionFrame(i),i);
  });
  it('removes the active tolerance configuration and ignores legacy tolerance values',()=>{
    expect(DEFAULT_FUSION_CONFIG).not.toHaveProperty('segLengthTolerance');
    const i=input(4);expectStereo(createFusionController({segLengthTolerance:0} as any).processFusionFrame(i),i);
  });
  it('preserves wrist failure while the mismatched upper arm remains stereo',()=>{
    const ctrl=createFusionController();ctrl.processFusionFrame(input(1));
    const r=ctrl.processFusionFrame(input(1,{stereoWrist:null,nowMs:1033}));
    expect(r.diagnostics.uaState).toBe('STEREO');expect(r.diagnostics.faState).toBe('IMU_CORRECTION');expect(r.finalWrist).not.toBeNull();
  });
  it('does not reject a healthy forearm because its fused proximal endpoint moved',()=>{
    const ctrl=createFusionController();ctrl.processFusionFrame(input(0));
    const i=input(1,{simulated:{shoulder:true,elbow:false,wrist:false},nowMs:1033});
    const r=ctrl.processFusionFrame(i);
    expect(r.diagnostics.uaState).toBe('IMU_CORRECTION');expect(r.diagnostics.faState).toBe('STEREO');expect(r.finalWrist).toEqual(i.stereoWrist);
  });
  it('treats a missing visual elbow as a legitimate failure for both adjacent segments',()=>{
    const ctrl=createFusionController();ctrl.processFusionFrame(input(0));
    const r=ctrl.processFusionFrame(input(1,{stereoElbow:null,nowMs:1033}));
    expect(r.diagnostics.uaState).toBe('IMU_CORRECTION');expect(r.diagnostics.faState).toBe('IMU_CORRECTION');
  });
  it.each(['shoulder','elbow','wrist'] as const)('retains explicit simulated %s failure',joint=>{
    const ctrl=createFusionController();ctrl.processFusionFrame(input(0));
    const r=ctrl.processFusionFrame(input(.5,{simulated:{...NO_SIMULATED_FAILURES,[joint]:true},nowMs:1033}));
    expect(joint==='wrist'?r.diagnostics.faState:r.diagnostics.uaState).toBe('IMU_CORRECTION');
  });
  it('retains independent correction-layer unreliability with no geometric substitution',()=>{
    const ctrl=createFusionController();ctrl.processFusionFrame(input());
    const joints=statuses();joints[2]={...joints[2],reliable:false};
    const r=ctrl.processFusionFrame(input(2,{jointStatuses:joints,nowMs:1033}));
    expect(r.diagnostics.uaState).toBe('STEREO');expect(r.diagnostics.faState).toBe('IMU_CORRECTION');
  });
  it('retains stale IMU fallback after an actual stereo failure',()=>{
    const ctrl=createFusionController();ctrl.processFusionFrame(input());
    const r=ctrl.processFusionFrame(input(2,{stereoWrist:null,imu02AgeMs:9999,nowMs:1033}));
    expect(r.diagnostics.uaState).toBe('STEREO');expect(r.diagnostics.faState).toBe('UNAVAILABLE');
  });
  it('keeps coincident reliable joints stereo and retains calibrated lengths for later missing-joint reconstruction',()=>{
    const ctrl=createFusionController();const initial=input(-1);expectStereo(ctrl.processFusionFrame(initial),initial);
    const r=ctrl.processFusionFrame(input(-1,{stereoElbow:null,stereoWrist:null,nowMs:1033}));
    expect(r.diagnostics.uaState).toBe('IMU_CORRECTION');expect(r.diagnostics.faState).toBe('IMU_CORRECTION');
    expect(r.diagnostics.uaReferenceLengthMm).toBe(300);expect(r.diagnostics.faReferenceLengthMm).toBe(250);
  });
  it('confirms and blends recovery despite large, changing length mismatches',()=>{
    const ctrl=createFusionController();ctrl.processFusionFrame(input(0));
    const failed=ctrl.processFusionFrame(input(0,{stereoElbow:null,stereoWrist:null,nowMs:1033}));
    expect(failed.diagnostics.uaState).toBe('IMU_CORRECTION');expect(failed.diagnostics.faState).toBe('IMU_CORRECTION');
    let r=ctrl.processFusionFrame(input(.5,{nowMs:1066}));
    expect(r.diagnostics.uaRecoveryPhase).toBe('confirming');expect(r.diagnostics.faRecoveryPhase).toBe('confirming');
    let sawBlend=false,last=input(.5);
    for(let n=0;n<12;n++) {
      last=input([.1,.3,.5,2][n%4],{nowMs:1099+33*n});r=ctrl.processFusionFrame(last);
      if(r.diagnostics.uaRecoveryPhase==='blending')sawBlend=true;
      expect(r.diagnostics.uaState).not.toBe('IMU_CORRECTION');expect(r.diagnostics.faState).not.toBe('IMU_CORRECTION');
    }
    expect(sawBlend).toBe(true);expectStereo(r,last);
  });
  it('recovers from UNAVAILABLE to stereo despite mismatch and absent IMUs',()=>{
    const ctrl=createFusionController();ctrl.processFusionFrame(input(0,{stereoElbow:null,stereoWrist:null,imuUADir:null,imuFADir:null}));
    let r!:FusionFrameResult,last=input();
    // Without either IMU, the existing FA safety dependency waits for the UA
    // endpoint to become available, then completes its own confirmation/blend.
    const completeBoth = 2*(1+DEFAULT_FUSION_CONFIG.recoveryConfirmFrames+DEFAULT_FUSION_CONFIG.blendFrames)+2;
    for(let n=0;n<completeBoth;n++){last=input(2,{imuUADir:null,imuFADir:null,nowMs:1033+33*n});r=ctrl.processFusionFrame(last);}
    expectStereo(r,last);
  });
});

let renderer:ReactTestRenderer|null=null;
afterEach(()=>{act(()=>renderer?.unmount());renderer=null;});
function productionHooks() {
  let controller!:ReturnType<typeof useIMUFusionController>,correction!:ReturnType<typeof usePoseFailureCorrection>;
  function Harness(){controller=useIMUFusionController();correction=usePoseFailureCorrection();return null;}
  act(()=>{renderer=create(createElement(Harness));});
  return {get controller(){return controller;},get correction(){return correction;}};
}
const calibration:StereoCalibration={camera1:{K:[[1000,0,640],[0,1000,360],[0,0,1]],distortion:[0,0,0,0,0],imageWidth:1280,imageHeight:720,reprojectionError:0},
  camera2:{K:[[1000,0,640],[0,1000,360],[0,0,1]],distortion:[0,0,0,0,0],imageWidth:1280,imageHeight:720,reprojectionError:0},
  extrinsic:{R:[[1,0,0],[0,1,0],[0,0,1]],T:[-200,0,0],E:[],F:[]},units:'mm',stereoReprojectionError:0,calibrationDate:'synthetic',checkerboardConfig:{rows:7,cols:10,squareSize:25}};
function observations(cameraB=false):PoseLandmarks {
  const p={...emptyComparisonPose(),rightShoulder:shoulder,rightElbow:input(.5).stereoElbow,rightWrist:input(.5).stereoWrist} as TriangulatedPose;
  return Object.fromEntries(LANDMARK_KEYS.map(k=>{const point=p[k]??{x:0,y:0,z:2000};return[k,{x:(1000*(point.x-(cameraB?200:0))/point.z+640)/1280,y:(1000*point.y/point.z+360)/720,z:0,visibility:1}];})) as PoseLandmarks;
}
describe('real hook, correction, triangulation and export integration',()=>{
  it('keeps P4 equal to actual corrected P3 until low visibility removes a joint',()=>{
    const h=productionHooks(),a=observations(),b=observations(true);
    const run=(now:number)=>{
      const raw=triangulateAllLandmarks(calibration,a,b,1280,720,1280,720),p3=h.correction.correct(raw);
      const i=input(.5,{stereoShoulder:p3.correctedPose.rightShoulder,stereoElbow:p3.correctedPose.rightElbow,stereoWrist:p3.correctedPose.rightWrist,jointStatuses:p3.jointStatuses,nowMs:now});
      return {p3,i,r:h.controller.processFusionFrame(i)};
    };
    let current=run(1000);expectStereo(current.r,current.i);
    b.rightWrist.visibility=.1;current=run(1033);
    expect(current.p3.correctedPose.rightWrist).toBeNull();expect(current.r.diagnostics.uaState).toBe('STEREO');expect(current.r.diagnostics.faState).toBe('IMU_CORRECTION');
    b.rightWrist.visibility=1;for(let n=0;n<12;n++)current=run(1066+n*33);expectStereo(current.r,current.i);
  });
  it('exports observational lengths and deviations from the real hook without an active length threshold',()=>{
    const h=productionHooks(),i=input(.5),r=h.controller.processFusionFrame(i);
    const p3={...emptyComparisonPose(),rightShoulder:i.stereoShoulder,rightElbow:i.stereoElbow,rightWrist:i.stereoWrist} as TriangulatedPose;
    const frame=buildComparisonFrame({cycleId:1,timing:{processingStartedPerformanceNowMs:1000,inferenceCompletedPerformanceNowMs:1001,cameraA:{sampledPerformanceNowMs:1000,mediaTimeSeconds:0},cameraB:{sampledPerformanceNowMs:1000,mediaTimeSeconds:0},cameraAPresentation:null,inferenceErrors:[]},cameraA:observations(),cameraB:observations(true),p2:p3,p3,correction:statuses(),fusion:{pose:{...p3,rightShoulder:r.finalShoulder,rightElbow:r.finalElbow,rightWrist:r.finalWrist},diagnostics:r.diagnostics,imuSamples:null},calibrationAvailable:true,errors:[],processingCompletedPerformanceNowMs:1002});
    const config={fusionConfiguration:DEFAULT_FUSION_CONFIG,fusionFailurePolicy:FUSION_FAILURE_POLICY};
    const recorder=createComparisonRecorder();recorder.start('no-length-gates',900,0,0,config,null);recorder.append(frame,config);recorder.stop(1100,200);
    const saved=JSON.parse(recorder.exportJson());const diag=saved.frames[0].fusion.segmentLengthDiagnostics;
    expect(diag.usage).toBe('diagnostic_only');expect(diag.upperArm).toEqual({observedStereoMm:450,calibratedMm:300,deviationMm:150,deviationFraction:.5});
    expect(diag.forearm).toEqual({observedStereoMm:375,calibratedMm:250,deviationMm:125,deviationFraction:.5});
    expect(saved.metadata.fusionConfiguration).not.toHaveProperty('segLengthTolerance');expect(saved.metadata.fusionFailurePolicy.segmentLengthDeviation).toBe('diagnostic_only');
    expect(saved.frames[0].pipelines.P4.pose).toEqual(saved.frames[0].pipelines.P3.pose);
  });
});
