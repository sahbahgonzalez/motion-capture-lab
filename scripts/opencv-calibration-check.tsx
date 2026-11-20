import React from 'react';
import {createRoot} from 'react-dom/client';
import {CalibrationView} from '../src/app/components/CalibrationView';
import {validateStereoCalibration,prepareStereoGeometry,triangulateRawObservations} from '../src/app/utils/stereoGeometry';
import '../src/styles/index.css';
const output=()=>document.getElementById('opencv-verification')!;
function fail(error:unknown){output().dataset.result='failed';output().textContent=String(error);}
window.addEventListener('error',e=>fail(e.message));
window.addEventListener('unhandledrejection',e=>fail(e.reason));
const pause=()=>new Promise(resolve=>setTimeout(resolve,200));
async function until(predicate:()=>boolean,message:string,seconds=90){const end=performance.now()+seconds*1000;while(!predicate()){if(output().dataset.result==='failed')throw Error(output().textContent??'Browser error');if(performance.now()>end)throw Error(message+'; '+document.body.innerText.slice(-3500));await pause();}}
function button(label:string){return Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()===label);}
const blobs:Blob[]=[];const originalURL=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{if(blob instanceof Blob)blobs.push(blob);return originalURL(blob);};
// Intercept downloads in this isolated test profile; application export code still runs.
HTMLAnchorElement.prototype.click=function(){};
async function verify(){
 const captures=await fetch('/__opencv_captures').then(r=>r.json());
 createRoot(document.getElementById('root')!).render(<CalibrationView camera1Stream={null} camera2Stream={null} camera1Ref={{current:null}} camera2Ref={{current:null}} isBothCamerasActive={false}/>);
 await until(()=>!!button('Import Captures JSON'),'Calibration UI did not render');
 await until(()=>typeof window.cv?.findChessboardCorners==='function'&&typeof window.cv?.stereoCalibrate==='function','Required OpenCV bindings unavailable');await pause();
 const input=Array.from(document.querySelectorAll<HTMLInputElement>('input[type=file]')).find(i=>!i.getAttribute('aria-label'))!,transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(captures)],'stationary-captures.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
 await until(()=>!!button('Run Calibration')&&!button('Run Calibration')!.disabled,'Import/detection did not produce enough valid pairs',120);
 button('Export Captures JSON')!.click();const processed=JSON.parse(await blobs.at(-1)!.text());
 const detection=processed.captures.map((c:any)=>({id:c.id,cameraA:c.camera1Image.detectionStatus,cameraB:c.camera2Image.detectionStatus,countA:c.camera1Image.corners?.length??0,countB:c.camera2Image.corners?.length??0}));
 if(detection.length!==captures.captures.length||detection.some((d:any)=>d.cameraA!=='detected'||d.cameraB!=='detected'||d.countA!==24||d.countB!==24))throw Error('Checkerboard detection incomplete: '+JSON.stringify(detection));
 // Exercise explicit reprocessing as well as the initial import route.
 button('Reprocess Captured Images')!.click();await pause();await until(()=>!button('Reprocess Captured Images')!.disabled,'Explicit reprocess did not finish');
 button('Run Calibration')!.click();await until(()=>!!button('Save stereo_calibration.json'),'Run Calibration did not complete',180);
 button('Save stereo_calibration.json')!.click();const calibration=JSON.parse(await blobs.at(-1)!.text()),compatible=validateStereoCalibration(calibration);if(!compatible.valid)throw Error(compatible.errors.join(' '));
 const perPair=processed.captures.map((pair:any)=>{const a=pair.camera1Image,b=pair.camera2Image,context=prepareStereoGeometry(calibration,[a.imageWidth,a.imageHeight,b.imageWidth,b.imageHeight]);return {id:pair.id,corners:a.corners.map((p:number[],i:number)=>triangulateRawObservations(context,{x:p[0]/a.imageWidth,y:p[1]/a.imageHeight},{x:b.corners[i][0]/b.imageWidth,y:b.corners[i][1]/b.imageHeight}))};});
 const summary=(values:number[])=>{const s=values.sort((a,b)=>a-b);return {n:s.length,median:s[Math.floor(s.length/2)]??null,p95:s[Math.floor((s.length-1)*.95)]??null,max:s.at(-1)??null};};
 const points=perPair.flatMap((p:any)=>p.corners),valid=points.filter((p:any)=>p.point&&p.reason===null);
 if(valid.length!==processed.captures.length*24)throw Error('Generated calibration rejected '+(points.length-valid.length)+' corners in production geometry.');
 const report={schemaVersion:'1.0.0-opencv-browser-verification',dataset:'Existing stationary checkerboard capture export; calibration training data, not held-out validation',pairCount:detection.length,detection,observations:processed.captures.map((p:any)=>({id:p.id,cameraA:p.camera1Image.corners,cameraB:p.camera2Image.corners})),productionGeometry:perPair,calibration,compatible,cameraAReprojectionPx:summary(valid.map((p:any)=>p.reprojectionErrorCameraAPx)),cameraBReprojectionPx:summary(valid.map((p:any)=>p.reprojectionErrorCameraBPx)),validTriangulatedCorners:valid.length,uiRoutes:['Import Captures JSON','Reprocess Captured Images','Run Calibration','Save stereo_calibration.json']};
 await fetch('/__opencv_report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
 output().dataset.result='passed';output().textContent=JSON.stringify({...report,calibration:undefined,observations:undefined,productionGeometry:undefined,compatible:compatible.valid});
}
void verify().catch(fail);
