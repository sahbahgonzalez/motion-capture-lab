import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMUReconstructionView } from '../../components/IMUReconstructionView';
import { useComparisonRecording } from '../useComparisonRecording';
import { useIMUWebSocket } from '../useIMUWebSocket';
import { LANDMARK_KEYS, type TriangulatedPose } from '../useTriangulation';
import type { PoseLandmarks } from '../useMediaPipePose';

const mocks = vi.hoisted(() => ({ callback: null as any, panel: null as any, dualCalls: 0, triangulate: null as any }));
vi.mock('../useDualMediaPipePose', () => ({useDualMediaPipePose: (_a: unknown,_b: unknown,_active: boolean,ref: unknown) => {
  mocks.callback=ref;mocks.dualCalls++;
  return {isLoaded:true,isRunning:true,camera1Landmarks:null,camera2Landmarks:null,runtimeConfiguration:{options:{}},error:null,debugInstanceId:'test',debugStats:{current:{}}};
}}));
vi.mock('../useCameraCalibration', () => ({useCameraCalibration: () => ({calibrationResult:{id:'stereo'},loadCalibration:vi.fn()})}));
vi.mock('../useTriangulation', async original => {
  const actual=await original<typeof import('../useTriangulation')>();
  return {...actual,triangulateAllLandmarks:(...args: unknown[])=>mocks.triangulate(...args)};
});
vi.mock('../../components/LivePipelineComparison', () => ({LivePipelineComparison:(props: unknown)=>{mocks.panel=props;return null;}}));

let renderer:ReactTestRenderer | null=null;
beforeEach(()=>{
  vi.stubGlobal('React',React);
  vi.useFakeTimers({toFake:['performance','setTimeout','clearTimeout','setInterval','clearInterval']});
  mocks.panel=null;mocks.callback=null;mocks.dualCalls=0;
  mocks.triangulate=vi.fn(()=>Object.fromEntries(LANDMARK_KEYS.map((k,i)=>[k,{x:100+i*20,y:100,z:1000}])) as TriangulatedPose);
});
afterEach(()=>{act(()=>renderer?.unmount());renderer=null;vi.useRealTimers();vi.unstubAllGlobals();});
const landmarks=()=>Object.fromEntries(LANDMARK_KEYS.map(k=>[k,{x:.5,y:.5,z:0,visibility:1}])) as PoseLandmarks;
function cycle(a:PoseLandmarks|null=landmarks(),b:PoseLandmarks|null=landmarks()) {
  act(()=>{
    vi.advanceTimersByTime(120);const now=performance.now();
    mocks.callback.current(a,b,{processingStartedPerformanceNowMs:now,inferenceCompletedPerformanceNowMs:now+5,
      cameraA:{sampledPerformanceNowMs:now,mediaTimeSeconds:1},cameraB:{sampledPerformanceNowMs:now+2,mediaTimeSeconds:2},cameraAPresentation:null,inferenceErrors:[]});
  });
}
function mountComparison() {
  let fused:TriangulatedPose|null=null;
  const advance=vi.fn((p:TriangulatedPose)=>{fused={...p,rightElbow:{x:777,y:888,z:999}};});
  const calibration={quality:'good',uaLengthMm:300};
  const rawConfig={imuCalibration:calibration};
  const video={current:{videoWidth:1280,videoHeight:720}} as any;
  act(()=>{renderer=create(React.createElement(IMUReconstructionView,{camera1Ref:video,camera2Ref:video,camera1Stream:null,camera2Stream:null,isBothCamerasActive:true,
    onCorrectedPose:advance,comparison:{getFusionSnapshot:()=>({pose:fused,diagnostics:null,imuSamples:null}),getConfiguration:()=>rawConfig,imuConnected:true,imuCalibrationStatus:'good'}}));});
  return {advance,calibration};
}

describe('comparison lab wiring',()=>{
  it('uses one dual-camera hook and captures P4 after the working fusion callback',()=>{
    const h=mountComparison();expect(mocks.dualCalls).toBe(1);
    act(()=>mocks.panel.recorder.start(0,mocks.panel.getConfiguration()));cycle();
    expect(mocks.triangulate).toHaveBeenCalledOnce();expect(h.advance).toHaveBeenCalledOnce();
    const {latest,session}=mocks.panel.recorder;
    expect(latest.pipelines.P4.pose.rightElbow).toEqual({x:777,y:888,z:999});
    expect(session.frames[0].pipelines.P4.pose).toEqual(latest.pipelines.P4.pose);
    expect(session.frames[0].pipelines.P3.pose.rightElbow.x).not.toBe(777);
  });
  it('records every callback between UI updates, including both missing poses',()=>{
    mountComparison();act(()=>mocks.panel.recorder.start(0,mocks.panel.getConfiguration()));
    cycle(null,landmarks());cycle(landmarks(),null);cycle(null,null);
    expect(mocks.panel.recorder.session.frames).toHaveLength(3);
    expect(mocks.panel.recorder.session.frames.map((f:any)=>f.cycleId)).toEqual([0,1,2]);
    expect(mocks.panel.recorder.latest.pipelines.P3.pose.rightElbow).toBeNull();
  });
  it('start and stop leave calibration and processing history intact',()=>{
    const h=mountComparison();cycle();const before=h.advance.mock.calls.length;
    act(()=>mocks.panel.recorder.start(1000,mocks.panel.getConfiguration()));
    expect(h.advance).toHaveBeenCalledTimes(before);expect(h.calibration).toEqual({quality:'good',uaLengthMm:300});
    cycle();act(()=>mocks.panel.recorder.stop());const stopped=mocks.panel.recorder.session;cycle();
    expect(stopped.frames).toHaveLength(1);expect(h.advance).toHaveBeenCalledTimes(before+2);
  });
  it('the original IMU reconstruction lab retains its missing-pose early return',()=>{
    const video={current:{videoWidth:1280,videoHeight:720}} as any;const callback=vi.fn();
    act(()=>{renderer=create(React.createElement(IMUReconstructionView,{camera1Ref:video,camera2Ref:video,camera1Stream:null,camera2Stream:null,isBothCamerasActive:true,onCorrectedPose:callback}));});
    cycle(null,null);expect(callback).not.toHaveBeenCalled();cycle();expect(callback).toHaveBeenCalledOnce();
  });
});

describe('comparison hook boundaries',()=>{
  it('finalizes synchronously on unmount and rejects later callbacks',()=>{
    let recording!:ReturnType<typeof useComparisonRecording>;
    function Harness(){recording=useComparisonRecording();return null;}
    act(()=>{renderer=create(React.createElement(Harness));});act(()=>recording.start(0,{calibration:'same'}));
    const session=recording.session!;act(()=>{vi.advanceTimersByTime(25);renderer!.unmount();});renderer=null;
    expect(session.status).toBe('stopped');expect(session.stopReason).toBe('component_unmount');expect(session.durationMs).toBe(25);
  });
});

describe('live IMU provenance',()=>{
  it('preserves absent counters as null without changing normalized live packets',()=>{
    class Socket {static latest:Socket;onopen:any;onclose:any;onmessage:any;onerror:any;close(){}constructor(){Socket.latest=this;}}
    vi.stubGlobal('WebSocket',Socket);let imu!:ReturnType<typeof useIMUWebSocket>;
    function Harness(){imu=useIMUWebSocket();return null;}
    act(()=>{renderer=create(React.createElement(Harness));});
    act(()=>{vi.advanceTimersByTime(10);Socket.latest.onmessage({data:JSON.stringify({sensor_id:'imu_01',qw:2,qx:0,qy:0,qz:0})});});
    expect(imu.getRawIMU('imu_01')!.sourceMetadata!.sequence).toBeNull();expect(imu.getRawIMU('imu_01')!.sourceMetadata!.timestampUs).toBeNull();
    expect(imu.getRawIMU('imu_01')!.latest!.qw).toBe(1);expect(imu.getRawIMU('imu_01')!.lastReceivedAt).toBe(10);
  });
});
