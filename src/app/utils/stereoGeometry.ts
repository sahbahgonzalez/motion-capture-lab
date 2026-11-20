import { Matrix, SVD } from 'ml-matrix';
import type { IntrinsicCalibration, StereoCalibration } from '../type/calibration';

export const STEREO_GEOMETRY_METHOD = 'undistorted-normalized-dlt-camera-a-v1';
export const STEREO_GEOMETRY_DESCRIPTION = {
  method: STEREO_GEOMETRY_METHOD,
  input: 'raw distorted MediaPipe image-normalized XY; separate per-camera calibration image transforms',
  transformation: 'calibration-domain pixels -> K inverse -> inverse OpenCV distortion -> normalized rays -> DLT [I|0], [R|T]',
  output: 'original Camera A optical frame: X right, Y down, Z forward; calibration translation units (mm for application calibrations)',
  storedRectifiedProjections: 'P1/P2 and R1/R2 are not used for triangulation; optional rectified epipolar diagnostics only',
  distortionModels: 'OpenCV pinhole 0/4/5/8/12/14 coefficients; rational radial, tangential, thin prism, sensor tilt; not fisheye',
  resizing: 'normalized raw coordinates mapped independently to each calibration image; full-frame resize assumed unless explicit affine imageGeometry is supplied',
  limitations: ['Unknown driver crops, zoom/focus changes, optical orientation changes and camera swaps cannot be inferred from dimensions.',
    'Legacy image orientation/crop provenance is unavailable. Recalibrate if it differs from the current raw frames.',
    'Reprojection residuals measure fit to observations, not independent accuracy. Calibration fit error remains separate.',
    'No hardware exposure synchronization; motion between sequential camera observations can cause inconsistent rays.',
    'High-order distortion may be non-invertible outside the calibrated region; numerical convergence is not proof of calibration quality.'],
};

export interface GeometryPoint { x: number; y: number; z: number; }
export interface Pixel { x: number; y: number; }
type Mat = number[][];
const IDENTITY = [[1,0,0],[0,1,0],[0,0,1]];
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const matrix = (m: unknown, rows: number, cols: number): m is Mat => Array.isArray(m) && m.length === rows && m.every(r => Array.isArray(r) && r.length === cols && r.every(finite));
const norm = (v: number[]) => Math.hypot(...v);
const mul = (m: Mat, v: number[]) => m.map(row => row.reduce((sum, x, i) => sum + x * v[i], 0));
const transpose = (m: Mat) => m[0].map((_, i) => m.map(row => row[i]));
const cross = (a: number[], b: number[]) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function isRotation(r: unknown): r is Mat {
  if (!matrix(r,3,3)) return false;
  const determinant = r[0].reduce((sum, x, i) => sum + x * cross(r[1],r[2])[i], 0);
  return Math.abs(determinant - 1) < 1e-3 && r.every((row,i) => r.every((other,j) => Math.abs(row.reduce((s,v,k)=>s+v*other[k],0) - (i===j ? 1 : 0)) < 1e-3));
}
function isAffine(m: unknown): m is Mat {
  return matrix(m,3,3) && Math.abs(m[2][0])+Math.abs(m[2][1])+Math.abs(m[2][2]-1) < 1e-12 && Math.abs(m[0][0]*m[1][1]-m[0][1]*m[1][0]) > 1e-12;
}

/** Validate required optical parameters, never synthesize missing K/D/R/T. */
export function validateStereoCalibration(value: unknown): {valid: boolean; errors: string[]; warnings: string[]} {
  const c = value as StereoCalibration | null;
  const errors: string[] = [], warnings: string[] = [];
  for (const [name, cam] of [['camera1',c?.camera1],['camera2',c?.camera2]] as const) {
    if (!cam || !matrix(cam.K,3,3) || cam.K[0][0] <= 0 || cam.K[1][1] <= 0 || Math.abs(cam.K[1][0])+Math.abs(cam.K[2][0])+Math.abs(cam.K[2][1])+Math.abs(cam.K[2][2]-1) > 1e-10) errors.push(name + ': valid OpenCV pinhole K is required.');
    if (!cam || !Array.isArray(cam.distortion) || ![0,4,5,8,12,14].includes(cam.distortion.length) || !cam.distortion.every(finite)) errors.push(name + ': explicit OpenCV distortion coefficients (0/4/5/8/12/14) are required.');
    if (!cam || !finite(cam.imageWidth) || !finite(cam.imageHeight) || cam.imageWidth <= 0 || cam.imageHeight <= 0) errors.push(name + ': calibration resolution is required.');
    if (cam?.imageGeometry) {
      if (cam.imageGeometry.observationSpace !== 'raw_distorted' || !isAffine(cam.imageGeometry.rawToCalibrationNormalized)) errors.push(name + ': imageGeometry must describe raw distorted observations with an invertible affine mapping.');
    } else warnings.push(name + ': legacy orientation/crop metadata absent; current raw frames must match calibration orientation and field of view.');
  }
  if (!isRotation(c?.extrinsic?.R)) errors.push('A proper camera-A-to-camera-B rotation R is required.');
  if (!Array.isArray(c?.extrinsic?.T) || c!.extrinsic.T.length !== 3 || !c!.extrinsic.T.every(finite) || norm(c!.extrinsic.T) <= 1e-9) errors.push('A finite nonzero stereo translation T is required.');
  if (c?.units !== undefined && c.units !== 'mm') errors.push('This application requires calibration translation units in millimeters.');
  if (!c?.units && !(finite(c?.checkerboardConfig?.squareSize) && c!.checkerboardConfig.squareSize > 0)) errors.push('Calibration units are unavailable; provide verified millimeter units or recalibrate with a measured checkerboard square size.');
  else if (!c?.units) warnings.push('Legacy calibration scale is inherited from its checkerboard square size, specified in mm by the application.');
  if (!(isRotation(c?.R1) && isRotation(c?.R2) && matrix(c?.P1,3,4) && matrix(c?.P2,3,4))) warnings.push('Rectified pixel epipolar diagnostic unavailable: complete R1/R2/P1/P2 not saved. They are not required for normalized-ray triangulation.');
  return {valid: errors.length === 0, errors, warnings};
}

function affine(m: Mat, p: Pixel): Pixel { return {x:m[0][0]*p.x+m[0][1]*p.y+m[0][2],y:m[1][0]*p.x+m[1][1]*p.y+m[1][2]}; }
function inverseAffine(m: Mat, p: Pixel): Pixel {
  const d=m[0][0]*m[1][1]-m[0][1]*m[1][0], x=p.x-m[0][2], y=p.y-m[1][2];
  return {x:(m[1][1]*x-m[0][1]*y)/d,y:(-m[1][0]*x+m[0][0]*y)/d};
}

/** OpenCV forward pinhole distortion. The tilt formula is the homogeneous
 * tilted-sensor projection documented by OpenCV calib3d (not a camera rotation). */
export function distortNormalized(p: Pixel, d: number[]): Pixel | null {
  const [k1=0,k2=0,p1=0,p2=0,k3=0,k4=0,k5=0,k6=0,s1=0,s2=0,s3=0,s4=0,tx=0,ty=0]=d;
  const {x,y}=p, r2=x*x+y*y, r4=r2*r2, r6=r4*r2;
  const denominator=1+k4*r2+k5*r4+k6*r6;
  if (Math.abs(denominator)<1e-14) return null;
  const radial=(1+k1*r2+k2*r4+k3*r6)/denominator;
  if (!finite(radial) || radial <= 0) return null;
  let xd=x*radial+2*p1*x*y+p2*(r2+2*x*x)+s1*r2+s2*r4;
  let yd=y*radial+p1*(r2+2*y*y)+2*p2*x*y+s3*r2+s4*r4;
  if (tx || ty) {
    const cx=Math.cos(tx), sx=Math.sin(tx), cy=Math.cos(ty), sy=Math.sin(ty);
    const rx=cy*xd+sy*sx*yd-sy*cx, ry=cx*yd+sx, rz=sy*xd-cy*sx*yd+cy*cx;
    if (Math.abs(rz)<1e-14) return null;
    xd=(cy*cx*rx+sy*cx*rz)/rz; yd=(cy*cx*ry-sx*rz)/rz;
  }
  return finite(xd)&&finite(yd) ? {x:xd,y:yd} : null;
}

/** Damped Newton inversion, checked by forward distortion rather than silently
 * accepting a fixed iteration count. No OpenCV runtime/browser dependency. */
export function undistortNormalized(target: Pixel, d: number[]): Pixel | null {
  let p={...target};
  for (let i=0;i<50;i++) {
    const f=distortNormalized(p,d); if (!f) return null;
    const ex=f.x-target.x, ey=f.y-target.y, error=Math.hypot(ex,ey);
    if (error<1e-12) return p;
    const h=1e-6;
    const xp=distortNormalized({x:p.x+h,y:p.y},d), xm=distortNormalized({x:p.x-h,y:p.y},d);
    const yp=distortNormalized({x:p.x,y:p.y+h},d), ym=distortNormalized({x:p.x,y:p.y-h},d);
    if (!xp||!xm||!yp||!ym) return null;
    const a=(xp.x-xm.x)/(2*h), b=(yp.x-ym.x)/(2*h), c=(xp.y-xm.y)/(2*h), e=(yp.y-ym.y)/(2*h), det=a*e-b*c;
    if (!finite(det)||det<=1e-14) return null;
    const dx=(e*ex-b*ey)/det, dy=(-c*ex+a*ey)/det;
    let accepted=false;
    for (let step=1;step>=1/128;step/=2) {
      const next={x:p.x-step*dx,y:p.y-step*dy}, projection=distortNormalized(next,d);
      if (projection && Math.hypot(projection.x-target.x,projection.y-target.y)<error) {p=next;accepted=true;break;}
    }
    if (!accepted) return null;
  }
  return null;
}

export interface PreparedStereoGeometry {
  calibration: StereoCalibration;
  sizes: [number,number,number,number];
  warnings: string[];
}
export function prepareStereoGeometry(calibration: StereoCalibration, sizes: [number,number,number,number]): PreparedStereoGeometry {
  const validation=validateStereoCalibration(calibration);
  if (!validation.valid) throw new Error('Incompatible calibration: '+validation.errors.join(' ')+' Recalibrate or load a complete calibration.');
  if (!sizes.every(v=>finite(v)&&v>0)) throw new Error('Actual decoded camera dimensions are required.');
  [calibration.camera1,calibration.camera2].forEach((cam,i)=>{
    const w=sizes[i*2],h=sizes[i*2+1];
    if (!cam.imageGeometry && Math.abs(w/h-cam.imageWidth/cam.imageHeight)>1e-3) throw new Error(`Camera ${i+1}: aspect ratio changed without a known crop/orientation transform. Use the calibration capture mode or recalibrate.`);
    // Explicit identity means full-frame resize, not an unknown crop.
    const map=cam.imageGeometry?.rawToCalibrationNormalized;
    if (map && JSON.stringify(map)===JSON.stringify(IDENTITY) && !cam.imageGeometry?.fullFrameResizeVerified && Math.abs(w/h-cam.imageWidth/cam.imageHeight)>1e-3) throw new Error(`Camera ${i+1}: aspect ratio changed; identity imageGeometry cannot establish whether the driver cropped or stretched. Supply a verified transform or recalibrate.`);
  });
  return {calibration,sizes,warnings:validation.warnings};
}

function observationRay(p: Pixel, cam: IntrinsicCalibration): Pixel | null {
  const cal=affine(cam.imageGeometry?.rawToCalibrationNormalized ?? IDENTITY,p);
  const y=(cal.y*cam.imageHeight-cam.K[1][2])/cam.K[1][1];
  const x=(cal.x*cam.imageWidth-cam.K[0][2]-cam.K[0][1]*y)/cam.K[0][0];
  return undistortNormalized({x,y},cam.distortion);
}
export function projectRawPoint(point: GeometryPoint, cam: IntrinsicCalibration, width: number, height: number): Pixel | null {
  if (point.z<=0) return null;
  const d=distortNormalized({x:point.x/point.z,y:point.y/point.z},cam.distortion);if (!d) return null;
  const cal={x:(cam.K[0][0]*d.x+cam.K[0][1]*d.y+cam.K[0][2])/cam.imageWidth,y:(cam.K[1][1]*d.y+cam.K[1][2])/cam.imageHeight};
  const raw=inverseAffine(cam.imageGeometry?.rawToCalibrationNormalized ?? IDENTITY,cal);
  return {x:raw.x*width,y:raw.y*height};
}
export interface GeometryJointResult {
  point: GeometryPoint | null;
  reason: string | null;
  rayAngleSin: number | null;
  reprojectionErrorCameraAPx: number | null;
  reprojectionErrorCameraBPx: number | null;
  normalizedEpipolarResidual: number | null;
  rectifiedEpipolarResidualPx: number | null;
  rectifiedEpipolarAxis: 'x' | 'y' | null;
}
export function triangulateRawObservations(context: PreparedStereoGeometry, a: Pixel, b: Pixel): GeometryJointResult {
  const result:GeometryJointResult={point:null,reason:null,rayAngleSin:null,reprojectionErrorCameraAPx:null,reprojectionErrorCameraBPx:null,normalizedEpipolarResidual:null,rectifiedEpipolarResidualPx:null,rectifiedEpipolarAxis:null};
  const fail=(reason:string)=>({...result,point:null,reason});
  if (![a.x,a.y,b.x,b.y].every(finite)) return fail('non_finite_observation');
  const cal=context.calibration, r=cal.extrinsic.R,t=cal.extrinsic.T;
  const u=observationRay(a,cal.camera1),v=observationRay(b,cal.camera2);
  if (!u||!v) return fail('undistortion_failed');
  const rayA=[u.x,u.y,1],rayB=[v.x,v.y,1],bInA=mul(transpose(r),rayB);
  result.rayAngleSin=norm(cross(rayA,bInA))/(norm(rayA)*norm(bInA));
  const epipolarLine=cross(t,mul(r,rayA));
  const lineNorm=Math.hypot(epipolarLine[0],epipolarLine[1]);
  result.normalizedEpipolarResidual=lineNorm>1e-14 ? Math.abs(rayB.reduce((s,x,i)=>s+x*epipolarLine[i],0))/lineNorm : null;
  if (isRotation(cal.R1)&&isRotation(cal.R2)&&matrix(cal.P1,3,4)&&matrix(cal.P2,3,4)) {
    const ra=mul(cal.R1,rayA), rb=mul(cal.R2,rayB);
    const pa=mul(cal.P1.map(row=>row.slice(0,3)),ra),pb=mul(cal.P2.map(row=>row.slice(0,3)),rb);
    if (Math.abs(pa[2])>1e-12&&Math.abs(pb[2])>1e-12) {
      result.rectifiedEpipolarAxis=Math.abs(cal.P2[0][3])>=Math.abs(cal.P2[1][3]) ? 'y':'x';
      const index=result.rectifiedEpipolarAxis==='y'?1:0;
      result.rectifiedEpipolarResidualPx=Math.abs(pa[index]/pa[2]-pb[index]/pb[2]);
    }
  }
  if (result.rayAngleSin<1e-6) return fail('degenerate_near_parallel_rays');
  const p1=[[1,0,0,0],[0,1,0,0],[0,0,1,0]],p2=r.map((row,i)=>[...row,t[i]]);
  const rows=(p:Mat,x:number,y:number)=>[p[0].map((_,i)=>x*p[2][i]-p[0][i]),p[1].map((_,i)=>y*p[2][i]-p[1][i])];
  let column:number[];
  try {column=new SVD(new Matrix([...rows(p1,u.x,u.y),...rows(p2,v.x,v.y)]),{autoTranspose:true}).rightSingularVectors.getColumn(3);} catch {return fail('degenerate_svd');}
  if (!column.every(finite)||Math.abs(column[3])<1e-12) return fail('degenerate_homogeneous_point');
  const x=column.slice(0,3).map(n=>n/column[3]),xb=mul(r,x).map((n,i)=>n+t[i]);
  if (!x.every(finite)||!xb.every(finite)) return fail('non_finite_reconstruction');
  if (x[2]<=0||xb[2]<=0) return fail('behind_camera');
  result.point={x:x[0],y:x[1],z:x[2]};
  const projA=projectRawPoint(result.point,cal.camera1,context.sizes[0],context.sizes[1]);
  const projB=projectRawPoint({x:xb[0],y:xb[1],z:xb[2]},cal.camera2,context.sizes[2],context.sizes[3]);
  if (!projA||!projB) return fail('reprojection_failed');
  result.reprojectionErrorCameraAPx=Math.hypot(projA.x-a.x*context.sizes[0],projA.y-a.y*context.sizes[1]);
  result.reprojectionErrorCameraBPx=Math.hypot(projB.x-b.x*context.sizes[2],projB.y-b.y*context.sizes[3]);
  return result;
}
