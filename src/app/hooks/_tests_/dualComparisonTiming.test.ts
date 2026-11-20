import { createElement, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useDualMediaPipePose } from '../useDualMediaPipePose';

const vision=vi.hoisted(()=>({models:[] as any[],create:vi.fn()}));
vi.mock('@mediapipe/tasks-vision',()=>({FilesetResolver:{forVisionTasks:async()=>({})},PoseLandmarker:{createFromOptions:async()=>{
  const model={detectForVideo:vi.fn(()=>({landmarks:[]})),close:vi.fn()};vision.models.push(model);vision.create();return model;
}}}));
let renderer:ReactTestRenderer|null=null;
afterEach(()=>{act(()=>renderer?.unmount());renderer=null;vi.unstubAllGlobals();vi.restoreAllMocks();vision.models=[];vision.create.mockClear();});
it('uses two camera models per shared cycle and retains inference failures without killing scheduling',async()=>{
  const callbacks:Array<()=>void>=[];
  vi.stubGlobal('requestAnimationFrame',(cb:()=>void)=>{callbacks.push(cb);return callbacks.length;});
  vi.stubGlobal('cancelAnimationFrame',vi.fn());
  vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({drawImage:vi.fn()})})});
  const a={readyState:2,videoWidth:640,videoHeight:480,currentTime:10} as HTMLVideoElement;
  const b={readyState:2,videoWidth:640,videoHeight:480,currentTime:20} as HTMLVideoElement;
  const received=vi.fn();
  function Harness(){const ref=useRef(received);useDualMediaPipePose(a,b,true,ref);return null;}
  await act(async()=>{renderer=create(createElement(Harness));});
  expect(vision.create).toHaveBeenCalledTimes(2);
  act(()=>callbacks.shift()!());
  expect(vision.models[0].detectForVideo).toHaveBeenCalledOnce();expect(vision.models[1].detectForVideo).toHaveBeenCalledOnce();
  expect(received).toHaveBeenCalledOnce();const timing=received.mock.calls[0][2];
  expect(timing.cameraA.mediaTimeSeconds).toBe(10);expect(timing.cameraB.mediaTimeSeconds).toBe(20);
  expect(timing.inferenceCompletedPerformanceNowMs).toBeGreaterThanOrEqual(timing.processingStartedPerformanceNowMs);
  vision.models[0].detectForVideo.mockImplementationOnce(()=>{throw Error('GPU error');});a.currentTime=11;
  act(()=>callbacks.shift()!());expect(received).toHaveBeenCalledTimes(2);
  expect(received.mock.calls[1][2].inferenceErrors[0]).toContain('camera_a');expect(callbacks).toHaveLength(1);
  expect(vision.create).toHaveBeenCalledTimes(2);
});
