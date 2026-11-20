import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useCameraCalibration } from '../useCameraCalibration';
import fixture from './fixtures/stereoGeometryReference.json';
import type { CalibrationCapture } from '../../type/calibration';

let renderer:ReactTestRenderer|null=null;
afterEach(()=>{act(()=>renderer?.unmount());renderer=null;vi.unstubAllGlobals();vi.restoreAllMocks();});
function mount() {
  let hook!:ReturnType<typeof useCameraCalibration>;
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()});
  function Harness(){hook=useCameraCalibration();return null;}
  act(()=>{renderer=create(createElement(Harness));});
  return {get hook(){return hook;}};
}
it('loads complete legacy calibration without rectification matrices and preserves optical parameters',()=>{
  const h=mount(),c=structuredClone(fixture.cases.at(-1)!.calibration);
  act(()=>{h.hook.loadCalibration(JSON.stringify(c));});
  expect(h.hook.calibrationResult).toEqual(c);expect(h.hook.calibrationResult!.camera2.distortion).toHaveLength(14);
});
it('rejects projection-only files without replacing the current valid calibration',()=>{
  const h=mount(),c=structuredClone(fixture.cases[0].calibration);
  act(()=>{h.hook.loadCalibration(JSON.stringify(c));});
  const invalid={...c,extrinsic:undefined};
  expect(()=>h.hook.loadCalibration(JSON.stringify(invalid))).toThrow(/complete calibration or recalibrate/);
  expect(h.hook.calibrationResult).toEqual(c);
});
it('round trips rectification rotations and explicit image transforms without altering K/R/T',()=>{
  const h=mount(),c=structuredClone(fixture.cases[1].calibration) as any;
  c.camera1.imageGeometry={observationSpace:'raw_distorted',rawToCalibrationNormalized:[[-1,0,1279/1280],[0,1,0],[0,0,1]],description:'known flip'};
  let loaded:any;act(()=>{loaded=h.hook.loadCalibration(JSON.stringify(c));});
  expect(JSON.parse(JSON.stringify(loaded))).toEqual(c);
});
it('rejects mixed browser calibration resolutions before invoking OpenCV calibration',async()=>{
  const h=mount();vi.stubGlobal('window',{cv:{Mat:function(){}}});
  const image=(w:number)=>({imageWidth:w,imageHeight:720,corners:[[10,10]],cornersDetected:true});
  const captures=Array.from({length:10},(_,i)=>({bothCornersDetected:true,camera1Image:image(1280),camera2Image:image(i===9?640:1280)})) as CalibrationCapture[];
  act(()=>h.hook.importCaptures(captures));
  // One inner corner isolates the subsequent resolution guard.
  await act(async()=>{await expect(h.hook.performCalibration(1,1,25)).rejects.toThrow(/same known resolution/);});
  expect(h.hook.calibrationResult).toBeNull();expect(h.hook.isCalibrating).toBe(false);
});
