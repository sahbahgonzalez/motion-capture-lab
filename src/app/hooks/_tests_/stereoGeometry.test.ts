import { describe, expect, it } from 'vitest';
import reference from './fixtures/stereoGeometryReference.json';
import { prepareStereoGeometry, triangulateRawObservations, validateStereoCalibration, projectRawPoint, STEREO_GEOMETRY_METHOD } from '../../utils/stereoGeometry';
import { triangulateAllLandmarks, LANDMARK_KEYS, type StereoGeometryDiagnostics } from '../useTriangulation';
import type { StereoCalibration } from '../../type/calibration';
import type { PoseLandmarks } from '../useMediaPipePose';
import { buildComparisonFrame, createComparisonRecorder, processComparisonCycle } from '../../utils/pipelineComparison';

const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const pixel=(v:number[])=>({x:v[0],y:v[1]});
const error=(p:{x:number;y:number;z:number},expected:number[])=>Math.hypot(p.x-expected[0],p.y-expected[1],p.z-expected[2]);
const first=reference.cases[0];
const cal=()=>clone(first.calibration) as StereoCalibration;
const sizes=(c:typeof first)=>c.captureSizes as [number,number,number,number];
const landmarks=(p:number[])=>Object.fromEntries(LANDMARK_KEYS.map(k=>[k,{x:p[0],y:p[1],z:123,visibility:1}])) as PoseLandmarks;

describe('independent OpenCV synthetic references',()=>{
  for(const fixture of reference.cases) {
    it(fixture.name+': known Camera A points, original units and independent reprojection',()=>{
      const c=clone(fixture.calibration) as StereoCalibration, context=prepareStereoGeometry(c,sizes(fixture));
      let worst=0,worstReprojection=0;
      fixture.pointsCameraA.forEach((expected,i)=>{
        const p=triangulateRawObservations(context,pixel(fixture.observationsA[i]),pixel(fixture.observationsB[i]));
        expect(p.reason).toBeNull();expect(p.point).not.toBeNull();
        worst=Math.max(worst,error(p.point!,expected));
        expect(error(p.point!,expected)).toBeLessThan(1e-5);
        worstReprojection=Math.max(worstReprojection,p.reprojectionErrorCameraAPx!,p.reprojectionErrorCameraBPx!);
        expect(p.reprojectionErrorCameraAPx).toBeLessThan(1e-6);expect(p.reprojectionErrorCameraBPx).toBeLessThan(1e-6);
        const raw=projectRawPoint({x:expected[0],y:expected[1],z:expected[2]},c.camera1,context.sizes[0],context.sizes[1])!;
        expect(Math.hypot(raw.x-fixture.observationsA[i][0]*context.sizes[0],raw.y-fixture.observationsA[i][1]*context.sizes[1])).toBeLessThan(1e-7);
        if(c.R1) expect(p.rectifiedEpipolarResidualPx).toBeLessThan(1e-6);
        expect(p.normalizedEpipolarResidual).toBeLessThan(1e-9);
      });
      console.info(`[geometry ${fixture.name}] max 3D error ${worst.toExponential(3)} mm; live reprojection ${worstReprojection.toExponential(3)} px`);
    });
  }
  it('matches analytical depth from disparity without relying on fixture projection code',()=>{
    const c=cal();c.camera1.K=[[1000,0,640],[0,1000,360],[0,0,1]];c.camera2={...clone(c.camera1)};
    c.extrinsic.R=[[1,0,0],[0,1,0],[0,0,1]];c.extrinsic.T=[-200,0,0];
    // X=300,Y=150,Z=2000 gives A=(790,435), B=(690,435).
    const p=triangulateRawObservations(prepareStereoGeometry(c,[1280,720,1280,720]),{x:790/1280,y:435/720},{x:690/1280,y:435/720});
    expect(error(p.point!,[300,150,2000])).toBeLessThan(1e-8);
  });
  it('does not mix rectified camera axes into Camera A output or apply rectification twice',()=>{
    const f=reference.cases[1],c=clone(f.calibration) as StereoCalibration;
    const before=triangulateRawObservations(prepareStereoGeometry(c,sizes(f)),pixel(f.observationsA[0]),pixel(f.observationsB[0]));
    expect(error(before.point!,f.pointsRectifiedCameraA[0])).toBeGreaterThan(10);
    delete c.R1;delete c.R2;c.P1=[[1,0,0,999],[0,1,0,999],[0,0,1,0]];c.P2=clone(c.P1);
    const after=triangulateRawObservations(prepareStereoGeometry(c,sizes(f)),pixel(f.observationsA[0]),pixel(f.observationsB[0]));
    expect(after.point).toEqual(before.point);expect(after.rectifiedEpipolarResidualPx).toBeNull();
  });
  it('supports vertical rectified rigs without mislabeling the constrained axis',()=>{
    const f=reference.cases.find(c=>c.name==='vertical_baseline')!;
    const p=triangulateRawObservations(prepareStereoGeometry(f.calibration as StereoCalibration,sizes(f)),pixel(f.observationsA[0]),pixel(f.observationsB[0]));
    expect(p.rectifiedEpipolarAxis).toBe('x');
  });
});

describe('resolution and optical image transforms',()=>{
  it('scales each camera independently without changing 3D units',()=>{
    const c=cal();const a=pixel(first.observationsA[0]),b=pixel(first.observationsB[0]);
    const original=triangulateRawObservations(prepareStereoGeometry(c,[1280,720,1600,900]),a,b);
    const resized=triangulateRawObservations(prepareStereoGeometry(c,[2560,1440,800,450]),a,b);
    expect(resized.point).toEqual(original.point);
  });
  it('accounts for explicit per-camera mirroring, not CSS display transforms',()=>{
    const c=cal();
    for(const cam of [c.camera1,c.camera2]) cam.imageGeometry={observationSpace:'raw_distorted',rawToCalibrationNormalized:[[-1,0,(cam.imageWidth-1)/cam.imageWidth],[0,1,0],[0,0,1]],description:'verified horizontal flip'};
    const a={x:1-1/c.camera1.imageWidth-first.observationsA[0][0],y:first.observationsA[0][1]};
    const b={x:1-1/c.camera2.imageWidth-first.observationsB[0][0],y:first.observationsB[0][1]};
    const p=triangulateRawObservations(prepareStereoGeometry(c,[1280,720,1600,900]),a,b);
    expect(error(p.point!,first.pointsCameraA[0])).toBeLessThan(1e-7);
    expect(p.reprojectionErrorCameraAPx).toBeLessThan(1e-7);
  });
  it('maps a verified crop and a 90-degree orientation independently',()=>{
    const c=cal();c.camera1.imageGeometry={observationSpace:'raw_distorted',rawToCalibrationNormalized:[[.8,0,.1],[0,.9,.05],[0,0,1]],description:'verified crop'};
    c.camera2.imageGeometry={observationSpace:'raw_distorted',rawToCalibrationNormalized:[[0,1,0],[-1,0,1-1/c.camera2.imageHeight],[0,0,1]],description:'90 degree rotated decoded frame'};
    const a={x:(first.observationsA[0][0]-.1)/.8,y:(first.observationsA[0][1]-.05)/.9};
    const b={x:1-1/c.camera2.imageHeight-first.observationsB[0][1],y:first.observationsB[0][0]};
    const p=triangulateRawObservations(prepareStereoGeometry(c,[1024,648,900,1600]),a,b);
    expect(error(p.point!,first.pointsCameraA[0])).toBeLessThan(1e-7);
  });
  it('rejects unknown aspect-ratio changes and invalid decoded dimensions',()=>{
    expect(()=>prepareStereoGeometry(cal(),[640,480,1600,900])).toThrow(/aspect ratio/);
    expect(()=>prepareStereoGeometry(cal(),[0,0,1600,900])).toThrow(/dimensions/);
  });
  it('accepts an explicitly verified full-frame anisotropic resize',()=>{
    const c=cal();c.camera1.imageGeometry={observationSpace:'raw_distorted',rawToCalibrationNormalized:[[1,0,0],[0,1,0],[0,0,1]],fullFrameResizeVerified:true,description:'verified full-frame stretch, no crop'};
    const p=triangulateRawObservations(prepareStereoGeometry(c,[640,480,1600,900]),pixel(first.observationsA[0]),pixel(first.observationsB[0]));
    expect(error(p.point!,first.pointsCameraA[0])).toBeLessThan(1e-7);
  });
  it('rejects explicit already-rectified inputs to avoid double transforms',()=>{
    const c=cal();c.camera1.imageGeometry={observationSpace:'rectified' as any,rawToCalibrationNormalized:[[1,0,0],[0,1,0],[0,0,1]],description:'unsupported input'};
    expect(validateStereoCalibration(c).valid).toBe(false);
  });
});

describe('invalid geometry and conservative rejection',()=>{
  it.each(['K','distortion','imageWidth'] as const)('requires actual %s instead of inventing defaults',field=>{
    const c=cal();delete (c.camera1 as any)[field];expect(validateStereoCalibration(c).valid).toBe(false);
    expect(()=>prepareStereoGeometry(c,[1280,720,1600,900])).toThrow(/calibration/);
  });
  it('reuses complete legacy K/D/R/T calibrations without saved rectification matrices',()=>{
    const c=cal();delete c.R1;delete c.R2;delete c.P1;delete c.P2;delete c.units;
    const result=validateStereoCalibration(c);expect(result.valid).toBe(true);expect(result.warnings.join(' ')).toContain('Legacy calibration scale');
  });
  it('rejects invalid rotations, zero baseline and unknown units',()=>{
    const c=cal();c.extrinsic.R[0][0]=2;expect(validateStereoCalibration(c).valid).toBe(false);
    const zero=cal();zero.extrinsic.T=[0,0,0];expect(validateStereoCalibration(zero).valid).toBe(false);
    const units=cal();delete units.units;delete (units as any).checkerboardConfig;expect(validateStereoCalibration(units).valid).toBe(false);
  });
  it('rejects parallel and near-parallel rays',()=>{
    const c=cal();c.camera2=clone(c.camera1);const context=prepareStereoGeometry(c,[1280,720,1280,720]);
    expect(triangulateRawObservations(context,{x:.5,y:.5},{x:.5,y:.5}).reason).toBe('degenerate_near_parallel_rays');
    expect(triangulateRawObservations(context,{x:.5,y:.5},{x:.5-1e-9,y:.5}).point).toBeNull();
  });
  it('rejects behind-camera and nonfinite observations',()=>{
    const c=cal();c.camera2=clone(c.camera1);const context=prepareStereoGeometry(c,[1280,720,1280,720]);
    expect(triangulateRawObservations(context,{x:.5,y:.5},{x:.6,y:.5}).reason).toBe('behind_camera');
    expect(triangulateRawObservations(context,{x:NaN,y:.5},{x:.4,y:.5}).reason).toBe('non_finite_observation');
  });
  it('reports missing/low-visibility joints, degenerate counts and live fit separately',()=>{
    const a=landmarks(first.observationsA[0]),b=landmarks(first.observationsB[0]);
    (a as any).nose=null;a.rightWrist.visibility=.1;b.rightElbow={...a.rightElbow};
    const c=cal();c.camera2=clone(c.camera1);let diag!:StereoGeometryDiagnostics;
    const result=triangulateAllLandmarks(c,a,b,1280,720,1280,720,{onDiagnostics:d=>{diag=d;}});
    expect(result.nose).toBeNull();expect(result.rightWrist).toBeNull();expect(result.rightElbow).toBeNull();
    expect(diag.joints.nose!.reason).toBe('missing_landmark');expect(diag.joints.rightWrist!.reason).toBe('low_visibility');
    expect(diag.degenerateJointCount).toBeGreaterThan(0);expect(diag.calibrationFitErrorPx).toBe(.25);
  });
  it('emits explicit invalid-calibration diagnostics without crashing a processing loop',()=>{
    let diag!:StereoGeometryDiagnostics;const bad=cal();delete (bad as any).extrinsic;
    const p=triangulateAllLandmarks(bad,landmarks(first.observationsA[0]),landmarks(first.observationsB[0]),1280,720,1600,900,{onDiagnostics:d=>{diag=d;}});
    expect(Object.values(p).every(v=>v===null)).toBe(true);expect(diag.status).toBe('invalid_calibration_or_capture');
    expect(diag.invalidJointCount).toBe(13);
  });
  it('does not triangulate invalid visibility or nonfinite landmark coordinates',()=>{
    const a=landmarks(first.observationsA[0]),b=landmarks(first.observationsB[0]);
    a.rightWrist.visibility=NaN;a.rightElbow.x=Infinity;let diag!:StereoGeometryDiagnostics;
    const p=triangulateAllLandmarks(cal(),a,b,1280,720,1600,900,{onDiagnostics:d=>{diag=d;}});
    expect(p.rightWrist).toBeNull();expect(p.rightElbow).toBeNull();
    expect(diag.joints.rightWrist!.reason).toBe('invalid_visibility');expect(diag.joints.rightElbow!.reason).toBe('non_finite_observation');
  });
});

it('preserves corrected geometry through P2/P3/P4 association and JSON export without altering P1',()=>{
  const c=reference.cases[1],a=landmarks(c.observationsA[0]),b=landmarks(c.observationsB[0]),before=clone(a);
  let diag:StereoGeometryDiagnostics|null=null, fused:any=null;
  const frame=processComparisonCycle({cycleId:42,timing:{processingStartedPerformanceNowMs:1100,inferenceCompletedPerformanceNowMs:1105,cameraA:{sampledPerformanceNowMs:1100,mediaTimeSeconds:1},cameraB:{sampledPerformanceNowMs:1102,mediaTimeSeconds:2},cameraAPresentation:null,inferenceErrors:[]},cameraA:a,cameraB:b,calibrationAvailable:true},{
    triangulate:()=>triangulateAllLandmarks(c.calibration as StereoCalibration,a,b,...sizes(c),{onDiagnostics:d=>{diag=d;}}),
    correct:p=>({correctedPose:p,jointStatuses:[]}),advanceLiveFusion:p=>{fused={...p,rightWrist:{x:1,y:2,z:3}};},readFusion:()=>({pose:fused,diagnostics:null,imuSamples:null}),readGeometry:()=>diag,now:()=>1110});
  const recorder=createComparisonRecorder();recorder.start('geometry-session',1000,0,0,{method:STEREO_GEOMETRY_METHOD},null);recorder.append(frame,{method:STEREO_GEOMETRY_METHOD});recorder.stop(1200,200);
  const saved=JSON.parse(recorder.exportJson()).frames[0];
  expect(a).toEqual(before);expect(saved.pipelines.P1.pose).toEqual(before);
  expect(error(saved.pipelines.P2.pose.rightElbow,c.pointsCameraA[0])).toBeLessThan(1e-5);
  expect(saved.pipelines.P3.pose.rightWrist).not.toEqual(saved.pipelines.P4.pose.rightWrist);
  expect(saved.geometry.method).toBe(STEREO_GEOMETRY_METHOD);expect(saved.geometry.validJointCount).toBe(13);
});
