import { prepareStereoGeometry, triangulateRawObservations, STEREO_GEOMETRY_METHOD, type GeometryJointResult } from '../utils/stereoGeometry';
import { StereoCalibration } from '../type/calibration';
import { PoseLandmarks } from './useMediaPipePose';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export type TriangulatedPose = {
  [K in keyof PoseLandmarks]: Point3D | null;
};

export const LANDMARK_KEYS: Array<keyof PoseLandmarks> = [
  'nose',
  'leftShoulder', 'rightShoulder',
  'leftElbow', 'rightElbow',
  'leftWrist', 'rightWrist',
  'leftHip', 'rightHip',
  'leftKnee', 'rightKnee',
  'leftAnkle', 'rightAnkle',
];

export const SKELETON_CONNECTIONS: Array<[keyof PoseLandmarks, keyof PoseLandmarks]> = [
  ['nose', 'leftShoulder'], ['nose', 'rightShoulder'],
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'],
];

export interface StereoGeometryDiagnostics {
  method: typeof STEREO_GEOMETRY_METHOD;
  status: 'ready' | 'invalid_calibration_or_capture';
  calibrationError: string | null;
  calibrationFitErrorPx: number | null;
  warnings: string[];
  validJointCount: number;
  invalidJointCount: number;
  degenerateJointCount: number;
  joints: Partial<Record<keyof PoseLandmarks, GeometryJointResult>>;
}

/** Shared by every stereo lab and playback path. Observations must be raw,
 * distorted image-normalized coordinates, never pre-rectified landmarks. */
export function triangulateAllLandmarks(
  calibration: StereoCalibration,
  cam1Landmarks: PoseLandmarks,
  cam2Landmarks: PoseLandmarks,
  cam1Width: number, cam1Height: number,
  cam2Width: number, cam2Height: number,
  options?: {onDiagnostics?: (diagnostics: StereoGeometryDiagnostics) => void},
): TriangulatedPose {
  const pose = Object.fromEntries(LANDMARK_KEYS.map(k => [k, null])) as TriangulatedPose;
  const diagnostics: StereoGeometryDiagnostics = {method: STEREO_GEOMETRY_METHOD, status:'ready',calibrationError:null,
    calibrationFitErrorPx:Number.isFinite(calibration?.stereoReprojectionError) ? calibration.stereoReprojectionError : null,
    warnings:[],validJointCount:0,invalidJointCount:0,degenerateJointCount:0,joints:{}};
  let context: ReturnType<typeof prepareStereoGeometry>;
  try {context=prepareStereoGeometry(calibration,[cam1Width,cam1Height,cam2Width,cam2Height]);diagnostics.warnings=context.warnings;}
  catch(err) {
    diagnostics.status='invalid_calibration_or_capture';diagnostics.calibrationError=String(err);
    diagnostics.invalidJointCount=LANDMARK_KEYS.length;options?.onDiagnostics?.(diagnostics);return pose;
  }
  for (const key of LANDMARK_KEYS) {
    const a=cam1Landmarks?.[key],b=cam2Landmarks?.[key];
    let result:GeometryJointResult;
    const invalidVisibility = [a?.visibility,b?.visibility].some(v => v !== undefined && !Number.isFinite(v));
    if (!a||!b||invalidVisibility||(a.visibility ?? 1)<0.5||(b.visibility ?? 1)<0.5) {
      result={point:null,reason:!a||!b?'missing_landmark':invalidVisibility?'invalid_visibility':'low_visibility',rayAngleSin:null,reprojectionErrorCameraAPx:null,reprojectionErrorCameraBPx:null,normalizedEpipolarResidual:null,rectifiedEpipolarResidualPx:null,rectifiedEpipolarAxis:null};
    } else result=triangulateRawObservations(context,a,b);
    pose[key]=result.point;diagnostics.joints[key]=result;
    if (result.point) diagnostics.validJointCount++;else diagnostics.invalidJointCount++;
    if (result.reason?.startsWith('degenerate')) diagnostics.degenerateJointCount++;
  }
  options?.onDiagnostics?.(diagnostics);
  return pose;
}

export type { StereoCalibration };

// ── Legacy hook for components that use useMemo-based triangulation ───────────
// StereoVideoPlayback uses this for playback (not live capture), so the
// double-triangulation concern doesn't apply there.
import { useMemo } from 'react';

export function useTriangulation(
  calibration: StereoCalibration | null,
  cam1Landmarks: PoseLandmarks | null,
  cam2Landmarks: PoseLandmarks | null,
  cam1Width: number, cam1Height: number,
  cam2Width: number, cam2Height: number,
): { pose: TriangulatedPose } {
  return useMemo(() => {
    const empty = Object.fromEntries(LANDMARK_KEYS.map(k => [k, null])) as TriangulatedPose;
    if (!calibration || !cam1Landmarks || !cam2Landmarks) return { pose: empty };
    if (!cam1Width || !cam1Height || !cam2Width || !cam2Height) return { pose: empty };
    return { pose: triangulateAllLandmarks(calibration, cam1Landmarks, cam2Landmarks, cam1Width, cam1Height, cam2Width, cam2Height) };
  }, [calibration, cam1Landmarks, cam2Landmarks, cam1Width, cam1Height, cam2Width, cam2Height]);
}
