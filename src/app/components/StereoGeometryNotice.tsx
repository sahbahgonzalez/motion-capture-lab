import type { StereoCalibration } from '../type/calibration';
import { prepareStereoGeometry, STEREO_GEOMETRY_METHOD } from '../utils/stereoGeometry';

/** Optical validation only; never modifies poses or calibration. */
export function StereoGeometryNotice({calibration, dimensions}: {calibration: StereoCalibration | null; dimensions: [number,number,number,number]}) {
  if (!calibration) return null;
  let warnings: string[];
  try { warnings=prepareStereoGeometry(calibration,dimensions).warnings; }
  catch (err) {return <p role="alert" className="text-sm text-red-300">Stereo geometry unavailable: {String(err)}</p>;}
  return <details className="text-xs text-amber-200"><summary>Geometry: {STEREO_GEOMETRY_METHOD}{warnings.length ? ' (compatibility warnings)' : ''}</summary>
    <p>Original Camera A optical frame. Calibration fit error is not live reprojection error or independent accuracy. CSS mirroring is display-only.</p>
    {warnings.map(w=><p key={w}>{w}</p>)}
    <p>Camera order, optical crop/orientation, focus and zoom must match calibration. Recalibrate after optical changes. Recalibrate the right-arm IMUs after switching from the old reconstruction geometry.</p>
  </details>;
}
