/**
 * FailureCorrectionLabView
 *
 * Top-level container for the "3D + Failure Correction" tab.
 * Mirrors ThreeDMotionCaptureView exactly — same Camera Setup, Calibration,
 * Video Recording, and Playback tabs — but swaps TriangulationView for
 * FailureCorrectionView in the Reconstruction tab.
 *
 * The original ThreeDMotionCaptureView and all code it calls are untouched.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useDualCamera } from '../hooks/useDualCamera';
import { useCameraCalibration } from '../hooks/useCameraCalibration';
import { useStereoVideoRecorder } from '../hooks/useStereoVideoRecorder';
import { CalibrationView } from './CalibrationView';
import { FailureCorrectionView } from './FailureCorrectionView';
import { FailureCorrectionPlayback } from './FailureCorrectionPlayback';
import { Video, VideoOff, AlertCircle, RefreshCw, Circle, Square, Download } from 'lucide-react';

export function FailureCorrectionLabView() {
  const {
    camera1Stream,
    camera2Stream,
    availableCameras,
    selectedCamera1,
    selectedCamera2,
    setSelectedCamera1,
    setSelectedCamera2,
    isCamera1Active,
    isCamera2Active,
    startCamera1,
    startCamera2,
    stopCamera1,
    stopCamera2,
    camera1Ref,
    camera2Ref,
    enumerateCameras,
    error: cameraError,
  } = useDualCamera();

  const { calibrationResult } = useCameraCalibration();
  const bothCamerasActive = isCamera1Active && isCamera2Active;

  const {
    isRecording: isVideoRecording,
    recordings: videoRecordings,
    error: videoRecordError,
    startRecording: startVideoRecording,
    stopRecording: stopVideoRecording,
    downloadRecording: downloadVideoRecording,
    deleteRecording: deleteVideoRecording,
  } = useStereoVideoRecorder(camera1Stream, camera2Stream);

  const [videoRecordingMs, setVideoRecordingMs] = useState(0);
  const videoRecordStartRef = useRef<number>(0);

  useEffect(() => {
    if (!isVideoRecording) { setVideoRecordingMs(0); return; }
    videoRecordStartRef.current = Date.now();
    const interval = setInterval(() => {
      setVideoRecordingMs(Date.now() - videoRecordStartRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, [isVideoRecording]);

  const formatVideoDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const cs = Math.floor((ms % 1000) / 10);
    return `${m.toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}.${cs.toString().padStart(2,'0')}`;
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1">3D + Failure Correction</h1>
          <p className="text-gray-400 text-sm">
            Stereo pipeline with per-joint jitter detection and EMA correction.
            RAW output preserved alongside corrected output.
          </p>
        </div>

        {cameraError && (
          <Card className="bg-red-900/20 border-red-700 p-4 mb-6">
            <div className="flex items-start">
              <AlertCircle className="h-5 w-5 text-red-500 mr-2 mt-0.5" />
              <div className="text-red-200">{cameraError}</div>
            </div>
          </Card>
        )}

        {/* Off-screen videos that keep streams alive for MediaPipe across inner tab switches.
            position:fixed + far off-screen rather than display:none so browsers keep decoding
            frames (readyState advances) and rVFC continues firing. */}
        <div aria-hidden="true" style={{ position: 'fixed', left: -9999, top: -9999, width: 1, height: 1, overflow: 'hidden', pointerEvents: 'none' }}>
          <video ref={camera1Ref} autoPlay playsInline muted style={{ width: 1, height: 1 }} />
          <video ref={camera2Ref} autoPlay playsInline muted style={{ width: 1, height: 1 }} />
        </div>

        <Tabs defaultValue="cameras" className="w-full">
          <TabsList className="bg-gray-800 mb-6">
            <TabsTrigger value="cameras">Camera Setup</TabsTrigger>
            <TabsTrigger value="calibration">Calibration</TabsTrigger>
            <TabsTrigger value="reconstruction">Reconstruction + Correction</TabsTrigger>
            <TabsTrigger value="video-record">Video Recording</TabsTrigger>
            <TabsTrigger value="playback">Playback</TabsTrigger>
          </TabsList>

          {/* ── Camera Setup (identical to baseline 3D lab) ─────────── */}
          <TabsContent value="cameras" className="space-y-6">
            <Card className="bg-gray-900 border-gray-700 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Video className="h-5 w-5 text-blue-400" />
                  <div>
                    <h3 className="font-semibold text-white">
                      {availableCameras.length === 0 && 'No cameras detected'}
                      {availableCameras.length === 1 && '1 camera detected'}
                      {availableCameras.length >= 2 && `${availableCameras.length} cameras detected`}
                    </h3>
                    <p className="text-sm text-gray-400">
                      {availableCameras.length >= 2
                        ? 'Ready for stereo capture'
                        : 'Need 2 cameras for stereo vision'}
                    </p>
                  </div>
                </div>
                <Button onClick={enumerateCameras} variant="outline" size="sm" className="border-gray-600">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </div>

              {availableCameras.length < 2 && (
                <div className="mt-4 p-3 bg-gray-800 rounded text-sm text-gray-400">
                  <p className="font-semibold text-gray-300 mb-2">
                    {availableCameras.length === 0 ? 'No cameras detected:' : 'Only 1 camera detected:'}
                  </p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Make sure both USB cameras are plugged in</li>
                    <li>Close other apps using cameras (Zoom, Teams, etc.)</li>
                    <li>Try different USB ports and click Refresh</li>
                    <li>Restart your browser if cameras still don't appear</li>
                  </ul>
                </div>
              )}

              {availableCameras.length >= 2 && (
                <div className="mt-4 p-3 bg-blue-900/20 border border-blue-700 rounded text-sm">
                  <p className="font-semibold text-blue-300 mb-2">Detected Cameras:</p>
                  <ul className="space-y-1">
                    {availableCameras.map((camera, idx) => (
                      <li key={camera.deviceId} className="text-xs text-blue-200">
                        <span className="font-semibold">{idx + 1}. {camera.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Camera 1 */}
              <Card className="bg-gray-900 border-gray-700 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Camera 1</h3>
                  <Badge className={isCamera1Active ? 'bg-green-600' : 'bg-gray-600'}>
                    {isCamera1Active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">Select Camera</label>
                    <Select value={selectedCamera1} onValueChange={setSelectedCamera1}
                      disabled={isCamera1Active || availableCameras.length === 0}>
                      <SelectTrigger className="bg-gray-800 border-gray-700">
                        <SelectValue placeholder={availableCameras.length === 0 ? 'No cameras detected' : 'Select camera...'} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCameras.filter(c => c.deviceId !== selectedCamera2).map(camera => (
                          <SelectItem key={camera.deviceId} value={camera.deviceId}>
                            {camera.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {!isCamera1Active ? (
                    <Button onClick={() => selectedCamera1 && startCamera1(selectedCamera1)}
                      disabled={!selectedCamera1} className="w-full bg-blue-600 hover:bg-blue-700">
                      <Video className="h-4 w-4 mr-2" /> Start Camera
                    </Button>
                  ) : (
                    <Button onClick={stopCamera1} variant="destructive" className="w-full">
                      <VideoOff className="h-4 w-4 mr-2" /> Stop Camera
                    </Button>
                  )}
                </div>
              </Card>

              {/* Camera 2 */}
              <Card className="bg-gray-900 border-gray-700 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Camera 2</h3>
                  <Badge className={isCamera2Active ? 'bg-green-600' : 'bg-gray-600'}>
                    {isCamera2Active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">Select Camera</label>
                    <Select value={selectedCamera2} onValueChange={setSelectedCamera2}
                      disabled={isCamera2Active || availableCameras.length === 0}>
                      <SelectTrigger className="bg-gray-800 border-gray-700">
                        <SelectValue placeholder={availableCameras.length === 0 ? 'No cameras detected' : 'Select camera...'} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCameras.filter(c => c.deviceId !== selectedCamera1).map(camera => (
                          <SelectItem key={camera.deviceId} value={camera.deviceId}>
                            {camera.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {!isCamera2Active ? (
                    <Button onClick={() => selectedCamera2 && startCamera2(selectedCamera2)}
                      disabled={!selectedCamera2} className="w-full bg-blue-600 hover:bg-blue-700">
                      <Video className="h-4 w-4 mr-2" /> Start Camera
                    </Button>
                  ) : (
                    <Button onClick={stopCamera2} variant="destructive" className="w-full">
                      <VideoOff className="h-4 w-4 mr-2" /> Stop Camera
                    </Button>
                  )}
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-gray-900 border-gray-700 p-4">
                <h4 className="font-semibold mb-3">Camera 1 Feed</h4>
                <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                  <video ref={(el) => { if (el && el.srcObject !== camera1Stream) el.srcObject = camera1Stream; }}
                    autoPlay playsInline muted className="w-full h-full object-contain" />
                  {!isCamera1Active && (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
                      Camera 1 not active
                    </div>
                  )}
                </div>
              </Card>
              <Card className="bg-gray-900 border-gray-700 p-4">
                <h4 className="font-semibold mb-3">Camera 2 Feed</h4>
                <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                  <video ref={(el) => { if (el && el.srcObject !== camera2Stream) el.srcObject = camera2Stream; }}
                    autoPlay playsInline muted className="w-full h-full object-contain" />
                  {!isCamera2Active && (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
                      Camera 2 not active
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {bothCamerasActive && (
              <Card className="bg-green-900/20 border-green-700 p-4">
                <div className="flex items-center text-green-300 text-sm">
                  <Video className="h-4 w-4 mr-2" />
                  Both cameras active — head to the Calibration tab to calibrate your stereo rig.
                </div>
              </Card>
            )}
          </TabsContent>

          {/* ── Calibration ─────────────────────────────────────────── */}
          <TabsContent value="calibration">
            <CalibrationView
              camera1Stream={camera1Stream}
              camera2Stream={camera2Stream}
              camera1Ref={camera1Ref}
              camera2Ref={camera2Ref}
              isBothCamerasActive={bothCamerasActive}
            />
          </TabsContent>

          {/* ── Reconstruction + Correction ─────────────────────────── */}
          <TabsContent value="reconstruction">
            <FailureCorrectionView
              camera1Ref={camera1Ref}
              camera2Ref={camera2Ref}
              camera1Stream={camera1Stream}
              camera2Stream={camera2Stream}
              isBothCamerasActive={bothCamerasActive}
              preloadedCalibration={calibrationResult}
            />
          </TabsContent>

          {/* ── Video Recording ─────────────────────────────────────── */}
          <TabsContent value="video-record" className="space-y-6">
            <Card className="bg-gray-900 border-gray-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">Synchronized Dual-Camera Recording</h3>
                  <p className="text-sm text-gray-400 mt-1">
                    Records raw video from both cameras simultaneously for later playback analysis.
                  </p>
                </div>
                {isVideoRecording && (
                  <div className="flex items-center gap-2 text-red-400 font-mono text-sm">
                    <Circle className="h-3 w-3 fill-red-500 text-red-500 animate-pulse" />
                    {formatVideoDuration(videoRecordingMs)}
                  </div>
                )}
              </div>

              {videoRecordError && (
                <div className="flex items-center gap-2 text-red-400 text-sm mb-4 p-3 bg-red-900/20 rounded border border-red-800">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {videoRecordError}
                </div>
              )}

              {!bothCamerasActive && (
                <div className="p-3 bg-yellow-900/20 border border-yellow-700 rounded text-yellow-300 text-sm mb-4">
                  Both cameras must be active before recording.
                </div>
              )}

              <div className="flex gap-3">
                {!isVideoRecording ? (
                  <Button onClick={startVideoRecording} disabled={!bothCamerasActive}
                    className="bg-red-600 hover:bg-red-700 text-white">
                    <Circle className="h-4 w-4 mr-2 fill-white" /> Start Recording
                  </Button>
                ) : (
                  <Button onClick={stopVideoRecording} className="bg-gray-600 hover:bg-gray-700 text-white">
                    <Square className="h-4 w-4 mr-2 fill-white" /> Stop Recording
                  </Button>
                )}
              </div>
            </Card>

            {videoRecordings.length > 0 && (
              <Card className="bg-gray-900 border-gray-700 p-6">
                <h3 className="text-lg font-semibold mb-4">Recordings</h3>
                <div className="space-y-3">
                  {videoRecordings.map(rec => {
                    const dur = Math.round(rec.duration / 1000);
                    const size1 = (rec.cam1Blob.size / 1e6).toFixed(1);
                    const size2 = (rec.cam2Blob.size / 1e6).toFixed(1);
                    return (
                      <div key={rec.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                        <div>
                          <p className="font-medium text-sm text-white">{rec.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {dur}s · Cam1: {size1} MB · Cam2: {size2} MB
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline"
                            className="border-gray-600 text-gray-300 hover:text-white"
                            onClick={() => downloadVideoRecording(rec)}>
                            <Download className="h-4 w-4 mr-1" /> Download Both
                          </Button>
                          <Button size="sm" variant="destructive"
                            onClick={() => deleteVideoRecording(rec.id)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {videoRecordings.length === 0 && !isVideoRecording && (
              <div className="text-center text-gray-500 py-12 text-sm">
                No recordings yet. Start both cameras and press Record.
              </div>
            )}
          </TabsContent>

          {/* ── Playback ────────────────────────────────────────────── */}
          <TabsContent value="playback">
            <FailureCorrectionPlayback calibration={calibrationResult} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
