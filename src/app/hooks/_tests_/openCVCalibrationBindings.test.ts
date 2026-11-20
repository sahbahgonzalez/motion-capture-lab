import {beforeAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {validateStereoCalibration} from '../../utils/stereoGeometry';
let cv:any;
beforeAll(async()=>{const file=path.resolve(process.env.MCL_OPENCV_CANDIDATE??'public/opencv.js'),box:any={module:{exports:{}},exports:{},require:createRequire(file),process,console,Buffer,__dirname:path.dirname(file),setTimeout,clearTimeout,performance,WebAssembly};vm.runInNewContext(readFileSync(file,'utf8'),box,{filename:file});const runtime=box.module.exports;await new Promise<void>((resolve,reject)=>{const done=(module:any)=>{cv=module;resolve();};if(runtime.then)runtime.then(done,reject);else done(runtime);});},30000);
it('exports every calibration function and the official termination constants',()=>{for(const name of ['findChessboardCorners','cornerSubPix','calibrateCamera','stereoCalibrate','stereoRectify'])expect(typeof cv[name]).toBe('function');expect(cv.TermCriteria_EPS).toBe(2);expect(cv.TermCriteria_MAX_ITER).toBe(1);});
it('detects and refines 24 corners on a synthetic 6x4 board using the real WASM routines',()=>{const image=new cv.Mat(360,280,cv.CV_8UC1),corners=new cv.Mat();try{image.data.fill(255);for(let r=0;r<7;r++)for(let c=0;c<5;c++)for(let y=40+r*40;y<80+r*40;y++)for(let x=40+c*40;x<80+c*40;x++)image.data[y*280+x]=(r+c)%2?255:0;expect(cv.findChessboardCorners(image,new cv.Size(4,6),corners,cv.CALIB_CB_ADAPTIVE_THRESH|cv.CALIB_CB_NORMALIZE_IMAGE)).toBe(true);expect(corners.rows).toBe(24);cv.cornerSubPix(image,corners,new cv.Size(11,11),new cv.Size(-1,-1),new cv.TermCriteria(cv.TermCriteria_EPS|cv.TermCriteria_MAX_ITER,30,.001));expect(Math.min(...Array.from(corners.data32F).filter((_,i)=>i%2===0) as number[])).toBeCloseTo(79.5,0);expect(Array.from(corners.data32F).every(Number.isFinite)).toBe(true);}finally{image.delete();corners.delete();}});
it('runs real calibration and rectification with the app signatures and exports compatible matrices',()=>{const mats:any[]=[],keep=(m:any)=>{mats.push(m);return m;};try{
 const objects=keep(new cv.MatVector()),imagesA=keep(new cv.MatVector()),imagesB=keep(new cv.MatVector()),rvecA=keep(new cv.MatVector()),tvecA=keep(new cv.MatVector()),rvecB=keep(new cv.MatVector()),tvecB=keep(new cv.MatVector());
 for(let view=0;view<12;view++){const obj:number[]=[],a:number[]=[],b:number[]=[],ax=(view%4-1.5)*.16,ay=(Math.floor(view/4)-1)*.22,cx=Math.cos(ax),sx=Math.sin(ax),cy=Math.cos(ay),sy=Math.sin(ay);
  for(let row=0;row<6;row++)for(let col=0;col<4;col++){const x=col*35,y=row*35,z=0;obj.push(x,y,z);const X=cy*x+sy*sx*y-100+(view%3)*30,Y=cx*y-80+view*5,Z=-sy*x+cy*sx*y+800+view*35;a.push(900*X/Z+640,880*Y/Z+360);b.push(910*(X-150)/Z+638,890*Y/Z+362);}
  objects.push_back(keep(cv.matFromArray(24,1,cv.CV_32FC3,obj)));imagesA.push_back(keep(cv.matFromArray(24,1,cv.CV_32FC2,a)));imagesB.push_back(keep(cv.matFromArray(24,1,cv.CV_32FC2,b)));
 }
 const K1=keep(new cv.Mat()),D1=keep(new cv.Mat()),K2=keep(new cv.Mat()),D2=keep(new cv.Mat()),size=new cv.Size(1280,720);
 expect(cv.calibrateCamera(objects,imagesA,size,K1,D1,rvecA,tvecA)).toBeLessThan(.01);expect(cv.calibrateCamera(objects,imagesB,size,K2,D2,rvecB,tvecB)).toBeLessThan(.01);
 const R=keep(new cv.Mat()),T=keep(new cv.Mat()),E=keep(new cv.Mat()),F=keep(new cv.Mat());expect(cv.stereoCalibrate(objects,imagesA,imagesB,K1,D1,K2,D2,size,R,T,E,F,cv.CALIB_FIX_INTRINSIC)).toBeLessThan(.02);
 const R1=keep(new cv.Mat()),R2=keep(new cv.Mat()),P1=keep(new cv.Mat()),P2=keep(new cv.Mat()),Q=keep(new cv.Mat());cv.stereoRectify(K1,D1,K2,D2,size,R,T,R1,R2,P1,P2,Q,cv.CALIB_ZERO_DISPARITY,0,size);
 const matrix=(m:any)=>Array.from({length:m.rows},(_,r)=>Array.from(m.data64F.slice(r*m.cols,(r+1)*m.cols))),camera=(K:any,D:any)=>({K:matrix(K),distortion:Array.from(D.data64F),imageWidth:1280,imageHeight:720,reprojectionError:0});
 const calibration={camera1:camera(K1,D1),camera2:camera(K2,D2),extrinsic:{R:matrix(R),T:Array.from(T.data64F),E:matrix(E),F:matrix(F)},R1:matrix(R1),R2:matrix(R2),P1:matrix(P1),P2:matrix(P2),units:'mm',stereoReprojectionError:0,calibrationDate:'synthetic API regression',checkerboardConfig:{rows:6,cols:4,squareSize:35}};expect(validateStereoCalibration(JSON.parse(JSON.stringify(calibration))).valid).toBe(true);expect(T.data64F[0]).toBeCloseTo(-150,1);
 }finally{for(const mat of mats.reverse())mat.delete();}},30000);
