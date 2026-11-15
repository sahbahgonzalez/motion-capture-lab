import type {
  CameraRecordingStatus,
  StereoRecordingDiagnostics,
} from '../hooks/useStereoVideoRecorder';

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function statusColor(status: CameraRecordingStatus): string {
  if (status === 'recording' || status === 'complete') return 'text-green-400';
  if (status === 'stopping') return 'text-yellow-400';
  if (status === 'error' || status === 'unavailable') return 'text-red-400';
  return 'text-gray-500';
}

function formatFps(value: number | undefined): string {
  return value === undefined ? 'Unavailable' : value.toFixed(2);
}

export function StereoRecordingDiagnosticsPanel({
  diagnostics,
}: {
  diagnostics: StereoRecordingDiagnostics;
}) {
  const row = (label: string, value: string, color = 'text-gray-300') => (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-xs font-mono ${color}`}>{value}</span>
    </div>
  );

  return (
    <div className="mt-5 border-t border-gray-800 pt-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Recording timing diagnostics
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded border border-gray-800 bg-gray-950/50 p-3 space-y-1.5">
          <div className="text-xs font-semibold text-gray-400">Camera A</div>
          {row('Recorder', diagnostics.cameraAStatus, statusColor(diagnostics.cameraAStatus))}
          {row('Observed frames', String(diagnostics.cameraAObservedFrameCount))}
          {row('Requested FPS', formatFps(diagnostics.cameraARequestedFps))}
          {row('Callback FPS', formatFps(diagnostics.cameraABrowserObservedCallbackFps))}
          {row('Skipped observations', String(diagnostics.cameraASkippedPresentationFrames))}
          {row('Encoded FPS', diagnostics.cameraAEncodedFpsAvailable ? 'Externally measured' : 'Unavailable')}
          {row('Timing', diagnostics.cameraAMetadataAvailability)}
        </div>
        <div className="rounded border border-gray-800 bg-gray-950/50 p-3 space-y-1.5">
          <div className="text-xs font-semibold text-gray-400">Camera B</div>
          {row('Recorder', diagnostics.cameraBStatus, statusColor(diagnostics.cameraBStatus))}
          {row('Observed frames', String(diagnostics.cameraBObservedFrameCount))}
          {row('Requested FPS', formatFps(diagnostics.cameraBRequestedFps))}
          {row('Callback FPS', formatFps(diagnostics.cameraBBrowserObservedCallbackFps))}
          {row('Skipped observations', String(diagnostics.cameraBSkippedPresentationFrames))}
          {row('Encoded FPS', diagnostics.cameraBEncodedFpsAvailable ? 'Externally measured' : 'Unavailable')}
          {row('Timing', diagnostics.cameraBMetadataAvailability)}
        </div>
        <div className="rounded border border-gray-800 bg-gray-950/50 p-3 space-y-1.5">
          <div className="text-xs font-semibold text-gray-400">Shared clock</div>
          {row('Duration', formatDuration(diagnostics.durationMs))}
          {row(
            'Synchronization',
            diagnostics.synchronizationStatus,
            diagnostics.synchronizationStatus === 'verified'
              ? 'text-green-400'
              : diagnostics.synchronizationStatus === 'unknown'
                ? 'text-gray-500'
                : 'text-yellow-400',
          )}
          {row('Basis', 'performance.now()')}
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-gray-600">
        Callback FPS measures browser timing observations, not encoded-video FPS. Encoded
        frame rate and timestamp gaps require external container analysis. Hardware camera
        exposure synchronization is not verified.
      </p>
    </div>
  );
}
