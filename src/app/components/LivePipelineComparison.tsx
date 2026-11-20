import { useEffect, useState } from 'react';
import { LivePoseOverlay } from './LivePoseOverlay';
import { SkeletonView } from './PoseSkeletonView';
import { LANDMARK_KEYS, type TriangulatedPose } from '../hooks/useTriangulation';
import type { PoseLandmarks } from '../hooks/useMediaPipePose';
import type { useComparisonRecording } from '../hooks/useComparisonRecording';
import type { ComparisonFrame } from '../type/pipelineComparison';
import { COMPARISON_LIMITATIONS } from '../utils/pipelineComparison';

function boundsFor(frame: ComparisonFrame | null) {
  if (!frame) return null;
  const points = (['P2', 'P3', 'P4'] as const).flatMap(id => LANDMARK_KEYS.map(k => frame.pipelines[id].pose[k])).filter(p => p !== null);
  if (!points.length) return null;
  const xs = points.map(p => p.x), ys = points.map(p => -p.y);
  const minX = Math.min(...xs) - 150, minY = Math.min(...ys) - 150;
  return {minX, minY, rangeX: Math.max(300, Math.max(...xs) - minX + 150), rangeY: Math.max(300, Math.max(...ys) - minY + 150)};
}

export function LivePipelineComparison({ recorder, getConfiguration, camerasActive, processing, error, imuConnected, imuCalibrationStatus }: {
  recorder: ReturnType<typeof useComparisonRecording>;
  getConfiguration: () => unknown;
  camerasActive: boolean;
  processing: boolean;
  error: string | null;
  imuConnected: boolean;
  imuCalibrationStatus: string;
}) {
  const [warmup, setWarmup] = useState(3);
  const frame = recorder.latest;
  const [bounds, setBounds] = useState<ReturnType<typeof boundsFor>>(null);
  useEffect(() => { if (!bounds) { const next = boundsFor(frame); if (next) setBounds(next); } }, [bounds, frame]);
  const session = recorder.session, active = session?.status === 'recording';
  const diag = frame?.fusion;
  const duration = session ? (active && frame?.experimentTimeMs !== null ? frame?.experimentTimeMs ?? 0 : session.durationMs) : 0;
  const count = session?.frames.length ?? 0;
  const first = session?.frames[0], last = session?.frames.at(-1);
  const span = first && last ? last.timing.processingStartedPerformanceNowMs - first.timing.processingStartedPerformanceNowMs : 0;
  const rate = count > 1 && span > 0 ? (count - 1) * 1000 / span : null;
  return <section className="space-y-4 text-gray-200" aria-label="Live Pipeline Comparison">
    <div className="flex flex-wrap gap-3 text-sm">
      <span>Cameras: {camerasActive ? 'connected' : 'inactive'}</span><span>Processing: {processing ? 'running' : 'stopped'}</span>
      <span>IMU socket: {imuConnected ? 'connected' : 'disconnected'}</span><span>Arm calibration: {imuCalibrationStatus}</span>
      <span>Current processing rate: {recorder.processingRateHz === null ? 'unavailable' : recorder.processingRateHz.toFixed(1) + ' Hz'}</span>
      <span>Session rate: {rate === null ? 'unavailable' : rate.toFixed(1) + ' Hz'}</span>
    </div>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    <p className="text-sm text-amber-300">Stereo uses per-camera undistortion and normalized-ray triangulation in Camera A coordinates. Hardware synchronization and physical accuracy remain unverified. P1 uses image coordinates; P2-P4 use calibration millimeters.</p>
    {frame?.geometry && <div className="text-xs text-gray-300">
      <p>Geometry: {frame.geometry.method} | valid {frame.geometry.validJointCount}, invalid {frame.geometry.invalidJointCount}, degenerate {frame.geometry.degenerateJointCount} joints</p>
      <p>Calibration fit error: {frame.geometry.calibrationFitErrorPx?.toFixed(3) ?? 'unavailable'} px (separate from live residuals)</p>
      {frame.geometry.calibrationError && <p role="alert" className="text-red-300">{frame.geometry.calibrationError}</p>}
      <details><summary>Live reprojection / epipolar residuals by joint</summary>{Object.entries(frame.geometry.joints).map(([joint,d])=><p key={joint}>{joint}: {d?.reason ?? 'valid'}; reprojection A/B {d?.reprojectionErrorCameraAPx?.toFixed(3) ?? '-'}/{d?.reprojectionErrorCameraBPx?.toFixed(3) ?? '-'} capture px; rectified {d?.rectifiedEpipolarAxis ?? '-'} residual {d?.rectifiedEpipolarResidualPx?.toFixed(3) ?? '-'} px; normalized epipolar {d?.normalizedEpipolarResidual?.toExponential(2) ?? '-'}</p>)}</details>
    </div>}
    <div className="flex flex-wrap gap-3 items-center">
      <label>Warmup seconds <input aria-label="Comparison warmup seconds" type="number" min="0" step="0.5" disabled={active} value={warmup} onChange={e => setWarmup(Number(e.target.value))} className="w-20 bg-gray-800 p-1" /></label>
      <button className="rounded bg-green-800 px-3 py-2 disabled:opacity-40" disabled={!!session || !processing || !Number.isFinite(warmup) || warmup < 0} onClick={() => recorder.start(warmup * 1000, getConfiguration())}>Start Comparison</button>
      <button className="rounded bg-red-800 px-3 py-2 disabled:opacity-40" disabled={!active} onClick={recorder.stop}>Stop Comparison</button>
      <button className="rounded bg-blue-800 px-3 py-2 disabled:opacity-40" disabled={!session || active} onClick={recorder.exportSession}>Export Session</button>
      <button className="rounded bg-gray-700 px-3 py-2 disabled:opacity-40" disabled={!session || active} onClick={recorder.clear}>Clear Session</button>
      <button className="rounded bg-gray-700 px-3 py-2" onClick={() => setBounds(boundsFor(frame))}>Fit shared viewport</button>
    </div>
    <p className="text-sm">{active ? 'RECORDING' : session ? 'Stopped' : 'Preview'} | {count} cycles | {(duration / 1000).toFixed(2)} s | {active ? frame?.phase ?? 'waiting for cycle' : 'Warmup samples retained'} | Cycle {frame?.cycleId ?? '-'}</p>
    <p className="text-xs text-gray-400">Viewport is fixed after its first valid stereo pose. Use Fit shared viewport to reframe. Stop and export before leaving this application tab; sessions are held in memory.</p>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {(['P1', 'P2', 'P3', 'P4'] as const).map(id => <article key={id} className="rounded border border-gray-700 bg-gray-900 p-3 overflow-auto">
        <h3 className="font-semibold">{id} - {{P1: 'Camera A monocular', P2: 'Raw stereo', P3: 'Corrected stereo', P4: 'Final conditional IMU fusion'}[id]}</h3>
        <p className="text-xs text-gray-400">{frame?.pipelines[id].availableJoints ?? 0}/{LANDMARK_KEYS.length} joints | {frame?.pipelines[id].status ?? 'unavailable'} | {id === 'P1' ? 'image-normalized, inferred Z' : 'mm, front projection'}</p>
        {id === 'P1' ? <div className="relative" style={{width: 420, height: 270}}>
          <LivePoseOverlay landmarks={frame ? frame.pipelines.P1.pose as PoseLandmarks : null} videoWidth={420} videoHeight={270} />
        </div> : <SkeletonView pose3D={(frame?.pipelines[id].pose ?? Object.fromEntries(LANDMARK_KEYS.map(k => [k, null]))) as TriangulatedPose} view="front" width={420} height={270} sharedBounds={bounds} />}
      </article>)}
    </div>
    <div className="rounded border border-gray-700 p-3 space-y-1 text-sm">
      <p>Upper arm: {diag?.uaState ?? 'UNAVAILABLE'} {diag?.uaRecoveryPhase} | Forearm: {diag?.faState ?? 'UNAVAILABLE'} {diag?.faRecoveryPhase}</p>
      <p>IMU contribution (correction/recovery): {frame?.imuCorrectionActive ? 'ACTIVE' : 'inactive'} | Recovery blend: UA {diag?.blendAlphaUA ?? '-'}, FA {diag?.blendAlphaFA ?? '-'}</p>
      <p>IMU ages: UA {diag?.imu01AgeMs ?? '-'} ms, FA {diag?.imu02AgeMs ?? '-'} ms | Anchor: {diag?.shoulderAnchorState ?? 'unavailable'}</p>
      <p>Failure reasons: UA {diag?.uaFailureReason ?? 'none'}; FA {diag?.faFailureReason ?? 'none'}</p>
      <p>Segment lengths: diagnostics only; deviations never trigger fusion or delay recovery.</p>
      {diag?.segmentLengthDiagnostics && <p>
        Stereo UA / FA: {diag.segmentLengthDiagnostics.upperArm.observedStereoMm?.toFixed(1) ?? '-'} / {diag.segmentLengthDiagnostics.forearm.observedStereoMm?.toFixed(1) ?? '-'} mm;
        deviation from calibration: UA {diag.segmentLengthDiagnostics.upperArm.deviationFraction != null ? (diag.segmentLengthDiagnostics.upperArm.deviationFraction * 100).toFixed(1) + '%' : '-'},
        FA {diag.segmentLengthDiagnostics.forearm.deviationFraction != null ? (diag.segmentLengthDiagnostics.forearm.deviationFraction * 100).toFixed(1) + '%' : '-'}.
      </p>}
      <p>P3 correction: {frame?.correction.filter(s => s.failureType !== 'none' || !s.reliable).map(s => `${s.joint}: ${s.reliable ? s.failureType : 'unavailable'}`).join(', ') || 'normal / no classifications'}</p>
      <p>Cycle processing: {frame?.processingDurationMs.toFixed(1) ?? '-'} ms (includes inference and reconstruction; excludes rendering/export)</p>
      {!!frame?.errors.length && <p role="alert" className="text-red-300">{frame.errors.join('; ')}</p>}
    </div>
    <details><summary>Recording limitations</summary><ul className="list-disc pl-5 text-xs space-y-1">{COMPARISON_LIMITATIONS.map(text => <li key={text}>{text}</li>)}</ul></details>
  </section>;
}
