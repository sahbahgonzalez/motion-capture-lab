import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LivePipelineComparison } from '../../components/LivePipelineComparison';
import { SkeletonView } from '../../components/PoseSkeletonView';
import { useComparisonRecording } from '../useComparisonRecording';
import { buildComparisonFrame, emptyComparisonPose } from '../../utils/pipelineComparison';
import type { TriangulatedPose } from '../useTriangulation';
import type { ComparisonFrame } from '../../type/pipelineComparison';

let renderer:ReactTestRenderer|null=null;
beforeEach(()=>{vi.stubGlobal('React',React);vi.useFakeTimers({toFake:['performance','setTimeout','clearTimeout']});});
afterEach(()=>{act(()=>renderer?.unmount());renderer=null;vi.useRealTimers();vi.unstubAllGlobals();});
function frame(x=100):ComparisonFrame {
  const pose={...emptyComparisonPose(),rightShoulder:{x:0,y:0,z:1000},rightElbow:{x,y:100,z:1000}} as TriangulatedPose;
  return buildComparisonFrame({cycleId:x,timing:{processingStartedPerformanceNowMs:performance.now(),inferenceCompletedPerformanceNowMs:performance.now(),cameraA:{sampledPerformanceNowMs:performance.now(),mediaTimeSeconds:1},cameraB:{sampledPerformanceNowMs:performance.now(),mediaTimeSeconds:2},cameraAPresentation:null,inferenceErrors:[]},
    cameraA:null,cameraB:null,p2:pose,p3:pose,correction:[],fusion:{pose:{...pose,rightElbow:{x:x+100,y:100,z:1000}},diagnostics:null,imuSamples:null},calibrationAvailable:true,errors:[],processingCompletedPerformanceNowMs:performance.now()});
}
it('renders four panels, passes recorded final P4 to the renderer, and keeps one fixed shared viewport',()=>{
  let recorder!:ReturnType<typeof useComparisonRecording>;
  function Harness(){recorder=useComparisonRecording();return React.createElement(LivePipelineComparison,{recorder,getConfiguration:()=>({}),camerasActive:true,processing:true,error:null,imuConnected:false,imuCalibrationStatus:'missing'});}
  act(()=>{renderer=create(React.createElement(Harness));});act(()=>recorder.start(0,{}));
  act(()=>{vi.advanceTimersByTime(120);recorder.accept(frame(),{});});
  const panels=renderer!.root.findAllByType('article');expect(panels).toHaveLength(4);
  let skeletons=renderer!.root.findAllByType(SkeletonView);expect(skeletons).toHaveLength(3);
  expect(skeletons[2].props.pose3D).toEqual(recorder.session!.frames[0].pipelines.P4.pose);
  expect(skeletons[2].props.pose3D).not.toEqual(skeletons[1].props.pose3D);
  const bounds=skeletons[0].props.sharedBounds;expect(skeletons.every(s=>s.props.sharedBounds===bounds)).toBe(true);
  act(()=>{vi.advanceTimersByTime(120);recorder.accept(frame(1000),{});});
  skeletons=renderer!.root.findAllByType(SkeletonView);expect(skeletons.every(s=>s.props.sharedBounds===bounds)).toBe(true);
});
