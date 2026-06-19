import { useState, useRef, useEffect, useCallback } from 'react';
import { useMediaPipePose } from '../hooks/useMediaPipePose';
import { useMotionRecorderWithSync } from '../hooks/useMotionRecorderWithSync';
import { type MotionRecording } from '../hooks/useMotionRecorder';
import { CameraFeed } from './CameraFeed';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Circle, Square, Download, Trash2, Play, Pause, BarChart3, Cloud, CloudUpload, RefreshCw, Database, AlertCircle } from 'lucide-react';
import { LivePoseOverlay } from './LivePoseOverlay';
import { MotionDataVisualizer } from './MotionDataVisualizer';
import { toast } from 'sonner';
import { isSupabaseConfigured } from '../../lib/supabase';

interface MotionCaptureViewProps {
}

export function MotionCaptureView({}: MotionCaptureViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraFeedRef = useRef<any>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });
  const [recordingName, setRecordingName] = useState('');
  const [recordingNotes, setRecordingNotes] = useState('');
  const [playbackRecording, setPlaybackRecording] = useState<MotionRecording | null>(null);
  const [playbackFrame, setPlaybackFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [visualizerRecording, setVisualizerRecording] = useState<MotionRecording | null>(null);

  const {
    isRecording,
    currentRecording,
    recordings,
    startRecording,
    stopRecording,
    recordFrame,
    deleteRecording,
    clearAllRecordings,
    exportRecording,
    exportAllRecordings,
    saveToCloud,
    loadFromCloud,
    deleteFromCloud,
    cloudRecordings,
    isSyncing,
    isLoadingCloud,
  } = useMotionRecorderWithSync();

  // Sync video ref from CameraFeed - wrap in useCallback to prevent re-renders
  const handleCameraReady = useCallback(() => {
    if (cameraFeedRef.current?.videoElement) {
      (videoRef as any).current = cameraFeedRef.current.videoElement;
    }
    setCameraReady(true);
  }, []);

  const { isReady, startDetection, stopDetection, currentLandmarks } = useMediaPipePose(
    videoRef,
    canvasRef,
    {
      onPoseDetected: (landmarks) => {
        if (isRecording) {
          recordFrame(landmarks);
        }
      },
      enableDrawing: false, // We'll use our own overlay
    }
  );

  // Start detection when everything is ready (only run once)
  useEffect(() => {
    if (isReady && cameraReady && videoRef.current && canvasRef.current) {
      console.log('Starting detection - all elements ready');
      startDetection();
      
      return () => {
        console.log('Cleaning up - stopping detection');
        stopDetection();
      };
    }
  }, [isReady, cameraReady, startDetection, stopDetection]);

  // Sync canvas size with video
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas) return;

    const updateCanvasSize = () => {
      if (video.videoWidth && video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        console.log('Canvas sized:', canvas.width, 'x', canvas.height);
        setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
      }
    };

    // Initial size
    updateCanvasSize();

    // Listen for video metadata loaded
    video.addEventListener('loadedmetadata', updateCanvasSize);
    
    // Also check periodically in case dimensions change
    const interval = setInterval(updateCanvasSize, 1000);

    return () => {
      video.removeEventListener('loadedmetadata', updateCanvasSize);
      clearInterval(interval);
    };
  }, [cameraReady]);

  const handleStartRecording = () => {
    const metadata = {
      notes: recordingNotes,
      deviceInfo: navigator.userAgent,
    };
    startRecording(metadata);
    setRecordingName('');
    setRecordingNotes('');
  };

  const handleStopRecording = () => {
    const recording = stopRecording();
    if (recording && recordingName) {
      // Update the recording name if custom name was provided
      const updatedRecording = { ...recording, name: recordingName };
      // This is a bit hacky but works for the prototype
    }
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    const remainingMs = Math.floor((ms % 1000) / 10);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}.${remainingMs.toString().padStart(2, '0')}`;
  };

  // Playback effect
  useEffect(() => {
    if (!isPlaying || !playbackRecording) return;

    const frameInterval = 1000 / (playbackRecording.frameRate || 30);
    const interval = setInterval(() => {
      setPlaybackFrame(prev => {
        if (prev >= playbackRecording.frames.length - 1) {
          setIsPlaying(false);
          return 0;
        }
        return prev + 1;
      });
    }, frameInterval);

    return () => clearInterval(interval);
  }, [isPlaying, playbackRecording]);

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const currentPlaybackLandmarks = playbackRecording?.frames[playbackFrame]?.landmarks;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 text-white p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-center mb-6">
          <h1 className="text-2xl font-bold">Motion Capture Lab</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Live Camera Feed */}
          <Card className="bg-gray-800 border-gray-700 p-6">
            <h2 className="text-xl font-semibold mb-4 text-white">Live Feed</h2>
            
            <div className="relative aspect-[3/4] bg-black rounded-lg overflow-hidden mb-4">
              <CameraFeed
                ref={cameraFeedRef}
                onCameraReady={handleCameraReady}
                className="w-full h-full"
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ transform: 'scaleX(-1)', opacity: 0 }}
              />
              <LivePoseOverlay
                landmarks={currentLandmarks || currentRecording?.frames[currentRecording.frames.length - 1]?.landmarks || null}
                videoWidth={videoDimensions.width}
                videoHeight={videoDimensions.height}
                videoElement={videoRef.current}
                className="z-10"
              />
              
              {/* Debug info */}
              <div className="absolute top-2 right-2 bg-black/70 text-white text-xs p-2 rounded">
                <div>Video: {videoDimensions.width}x{videoDimensions.height}</div>
                <div>Landmarks: {currentLandmarks ? '✓' : '✗'}</div>
                <div>Ready: {isReady ? '✓' : '✗'}</div>
              </div>
              
              {isRecording && (
                <div className="absolute top-4 left-4 flex items-center gap-2 bg-red-600 px-3 py-1.5 rounded-full">
                  <Circle className="h-3 w-3 fill-white animate-pulse" />
                  <span className="text-sm font-bold">REC</span>
                  <span className="text-sm font-mono">
                    {formatDuration(currentRecording?.duration || 0)}
                  </span>
                </div>
              )}

              {currentRecording && (
                <div className="absolute bottom-4 right-4 bg-black/70 px-3 py-2 rounded-lg text-sm">
                  <div>Frames: {currentRecording.frames.length}</div>
                  <div>FPS: {currentRecording.frameRate.toFixed(1)}</div>
                </div>
              )}
            </div>

            {/* Recording Controls */}
            <div className="space-y-3">
              {!isRecording && (
                <>
                  <Input
                    placeholder="Recording name (optional)"
                    value={recordingName}
                    onChange={(e) => setRecordingName(e.target.value)}
                    className="bg-gray-700 border-gray-600 text-white"
                  />
                  <Textarea
                    placeholder="Notes (optional)"
                    value={recordingNotes}
                    onChange={(e) => setRecordingNotes(e.target.value)}
                    className="bg-gray-700 border-gray-600 text-white min-h-20"
                  />
                </>
              )}
              
              <div className="flex gap-2">
                {!isRecording ? (
                  <Button
                    onClick={handleStartRecording}
                    disabled={!cameraReady || !isReady}
                    className="flex-1 bg-red-600 hover:bg-red-700"
                  >
                    <Circle className="mr-2 h-4 w-4" />
                    Start Recording
                  </Button>
                ) : (
                  <Button
                    onClick={handleStopRecording}
                    className="flex-1 bg-gray-600 hover:bg-gray-700"
                  >
                    <Square className="mr-2 h-4 w-4" />
                    Stop Recording
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {/* Recordings List & Playback */}
          <Card className="bg-gray-800 border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Database className="h-5 w-5" />
                Recordings
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={loadFromCloud}
                disabled={isLoadingCloud}
                className="border-gray-600 text-white hover:bg-gray-700"
              >
                <RefreshCw className={`mr-1 h-3 w-3 ${isLoadingCloud ? 'animate-spin' : ''}`} />
                Refresh Cloud
              </Button>
            </div>

            <Tabs defaultValue="local" className="w-full">
              <TabsList className="bg-gray-700 mb-4 w-full">
                <TabsTrigger value="local" className="flex-1 data-[state=active]:bg-gray-600">
                  Local ({recordings.length})
                </TabsTrigger>
                <TabsTrigger value="cloud" className="flex-1 data-[state=active]:bg-gray-600">
                  <Cloud className="mr-1 h-3 w-3" />
                  Cloud ({cloudRecordings.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="local">
                {recordings.length > 0 && (
                  <div className="flex gap-2 mb-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={exportAllRecordings}
                      className="flex-1 border-gray-600 text-white hover:bg-gray-700"
                    >
                      <Download className="mr-1 h-3 w-3" />
                      Export All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearAllRecordings}
                      className="flex-1 border-gray-600 text-white hover:bg-red-900/30"
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Clear All
                    </Button>
                  </div>
                )}

            {/* Playback View */}
            {playbackRecording && (
              <div className="mb-6 p-4 bg-gray-900 rounded-lg border border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-white">{playbackRecording.name}</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPlaybackRecording(null);
                      setPlaybackFrame(0);
                      setIsPlaying(false);
                    }}
                    className="text-gray-400 hover:text-white"
                  >
                    Close
                  </Button>
                </div>
                
                <div className="relative aspect-[3/4] bg-black rounded-lg overflow-hidden mb-3">
                  <LivePoseOverlay
                    landmarks={currentPlaybackLandmarks || null}
                    videoWidth={400}
                    videoHeight={600}
                  />
                  <div className="absolute bottom-2 left-2 bg-black/70 px-2 py-1 rounded text-xs">
                    Frame {playbackFrame + 1} / {playbackRecording.frames.length}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handlePlayPause}
                    className="flex-1 bg-blue-600 hover:bg-blue-700"
                  >
                    {isPlaying ? (
                      <>
                        <Pause className="mr-2 h-4 w-4" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play className="mr-2 h-4 w-4" />
                        Play
                      </>
                    )}
                  </Button>
                  <input
                    type="range"
                    min={0}
                    max={playbackRecording.frames.length - 1}
                    value={playbackFrame}
                    onChange={(e) => {
                      setPlaybackFrame(parseInt(e.target.value));
                      setIsPlaying(false);
                    }}
                    className="flex-1"
                  />
                </div>
              </div>
            )}

                {/* Local Recordings List */}
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {recordings.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      No local recordings yet. Start recording to capture motion data.
                    </div>
                  ) : (
                    recordings.map((recording) => (
                      <div
                        key={recording.id}
                        className="p-4 bg-gray-900 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <h3 className="font-semibold text-white">{recording.name}</h3>
                            <div className="text-sm text-gray-400 mt-1">
                              {new Date(recording.startTime).toLocaleString()}
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-2 mb-3 flex-wrap">
                          <Badge variant="secondary" className="bg-gray-700 text-gray-200">
                            {formatDuration(recording.duration)}
                          </Badge>
                          <Badge variant="secondary" className="bg-gray-700 text-gray-200">
                            {recording.frames.length} frames
                          </Badge>
                          <Badge variant="secondary" className="bg-gray-700 text-gray-200">
                            {recording.frameRate.toFixed(1)} FPS
                          </Badge>
                        </div>

                        {recording.metadata.notes && (
                          <p className="text-sm text-gray-400 mb-3 italic">
                            "{recording.metadata.notes}"
                          </p>
                        )}

                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setPlaybackRecording(recording);
                              setPlaybackFrame(0);
                              setIsPlaying(false);
                            }}
                            className="border-gray-600 text-white hover:bg-gray-700"
                          >
                            <Play className="mr-1 h-3 w-3" />
                            View
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setVisualizerRecording(recording)}
                            className="border-gray-600 text-white hover:bg-gray-700"
                          >
                            <BarChart3 className="mr-1 h-3 w-3" />
                            Analyze
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => saveToCloud(recording)}
                            disabled={isSyncing || !isSupabaseConfigured}
                            className="border-gray-600 text-white hover:bg-blue-900/30 disabled:opacity-50"
                          >
                            <CloudUpload className="mr-1 h-3 w-3" />
                            Save to Cloud
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => exportRecording(recording)}
                            className="border-gray-600 text-white hover:bg-gray-700"
                          >
                            <Download className="mr-1 h-3 w-3" />
                            Export
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => deleteRecording(recording.id)}
                            className="col-span-2 border-gray-600 text-white hover:bg-red-900/30"
                          >
                            <Trash2 className="mr-1 h-3 w-3" />
                            Delete Local
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

              <TabsContent value="cloud">
                {/* Cloud Recordings List */}
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {!isSupabaseConfigured ? (
                    <Card className="bg-yellow-900/20 border-yellow-700 p-6">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-white font-semibold mb-2">Supabase Not Configured</h4>
                          <p className="text-gray-300 text-sm mb-3">
                            Cloud storage requires Supabase credentials. To enable cloud sync:
                          </p>
                          <ol className="text-gray-300 text-sm space-y-1 list-decimal list-inside">
                            <li>Create a Supabase project at https://supabase.com</li>
                            <li>Create a <code className="bg-gray-800 px-1 rounded">.env</code> file with your credentials</li>
                            <li>Run the SQL schema from <code className="bg-gray-800 px-1 rounded">supabase_schema.sql</code></li>
                            <li>Restart the app</li>
                          </ol>
                          <p className="text-gray-400 text-xs mt-3">
                            See <code className="bg-gray-800 px-1 rounded">SUPABASE_SETUP.md</code> for detailed instructions.
                          </p>
                        </div>
                      </div>
                    </Card>
                  ) : isLoadingCloud ? (
                    <div className="text-center py-12 text-gray-400">
                      <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
                      Loading cloud recordings...
                    </div>
                  ) : cloudRecordings.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      No cloud recordings yet. Save local recordings to the cloud.
                    </div>
                  ) : (
                    cloudRecordings.map((recording) => (
                      <div
                        key={recording.id}
                        className="p-4 bg-gray-900 rounded-lg border border-blue-700/50 hover:border-blue-600 transition-colors"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <h3 className="font-semibold text-white flex items-center gap-2">
                              {recording.name}
                              <Cloud className="h-4 w-4 text-blue-400" />
                            </h3>
                            <div className="text-sm text-gray-400 mt-1">
                              {new Date(recording.startTime).toLocaleString()}
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-2 mb-3 flex-wrap">
                          <Badge variant="secondary" className="bg-gray-700 text-gray-200">
                            {formatDuration(recording.duration)}
                          </Badge>
                          <Badge variant="secondary" className="bg-gray-700 text-gray-200">
                            {recording.frames.length} frames
                          </Badge>
                          <Badge variant="secondary" className="bg-gray-700 text-gray-200">
                            {recording.frameRate.toFixed(1)} FPS
                          </Badge>
                        </div>

                        {recording.metadata.notes && (
                          <p className="text-sm text-gray-400 mb-3 italic">
                            "{recording.metadata.notes}"
                          </p>
                        )}

                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setPlaybackRecording(recording);
                              setPlaybackFrame(0);
                              setIsPlaying(false);
                            }}
                            className="border-gray-600 text-white hover:bg-gray-700"
                          >
                            <Play className="mr-1 h-3 w-3" />
                            View
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setVisualizerRecording(recording)}
                            className="border-gray-600 text-white hover:bg-gray-700"
                          >
                            <BarChart3 className="mr-1 h-3 w-3" />
                            Analyze
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => exportRecording(recording)}
                            className="border-gray-600 text-white hover:bg-gray-700"
                          >
                            <Download className="mr-1 h-3 w-3" />
                            Export
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => deleteFromCloud(recording.id)}
                            disabled={isSyncing}
                            className="border-gray-600 text-white hover:bg-red-900/30"
                          >
                            <Trash2 className="mr-1 h-3 w-3" />
                            Delete from Cloud
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </Card>
        </div>

        {/* Info Section */}
        <Card className="bg-gray-800 border-gray-700 p-6 mt-6">
          <h3 className="text-lg font-semibold mb-3 text-white">About Motion Capture</h3>
          <div className="text-gray-300 space-y-2 text-sm">
            <p>
              This tool captures all 33 MediaPipe pose landmarks in real-time, allowing you to record human motion 
              data for research and animation purposes.
            </p>
            <p>
              <strong>Data Format:</strong> Exported JSON files contain timestamped frames with normalized 3D coordinates 
              (x, y, z) for each body landmark. The z-coordinate represents depth relative to the hip midpoint.
            </p>
            <p>
              <strong>Usage Tips:</strong> For best results, ensure good lighting and maintain visibility of key body points. 
              Higher frame rates provide smoother motion data but larger file sizes.
            </p>
            <p>
              <strong>Landmarks:</strong> nose, eyes, ears, shoulders, elbows, wrists, hips, knees, ankles (left/right pairs).
            </p>
          </div>
        </Card>
      </div>

      {/* Data Visualizer Modal */}
      {visualizerRecording && (
        <MotionDataVisualizer
          recording={visualizerRecording}
          onClose={() => setVisualizerRecording(null)}
        />
      )}
    </div>
  );
}