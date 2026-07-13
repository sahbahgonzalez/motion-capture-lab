import { useState } from 'react';
import { MotionRecording } from '../hooks/useMotionRecorder';
import { PoseLandmarks } from '../hooks/useMediaPipePose';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import {
  calculateJitterMetrics,
  calculateOcclusionMetrics,
  calculateQualitySummary,
  detectLimbSwaps,
  detectEnhancedDepthAmbiguity,
} from '../utils/motionQualityMetrics';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

interface MotionDataVisualizerProps {
  recording: MotionRecording;
  onClose: () => void;
}

export function MotionDataVisualizer({ recording, onClose }: MotionDataVisualizerProps) {
  const [selectedJoint, setSelectedJoint] = useState<keyof PoseLandmarks>('nose');

  // Prepare chart data — null out coordinates below the occlusion visibility threshold
  // so Recharts renders a gap instead of a spike to origin for missing/failed joints.
  const VISIBILITY_THRESHOLD = 0.5;
  const chartData = recording.frames.map((frame) => {
    const lm = frame.landmarks[selectedJoint];
    const visible = lm && (lm.visibility ?? 1) >= VISIBILITY_THRESHOLD;
    return {
      frameNumber: frame.frameNumber,
      time: (frame.timestamp / 1000).toFixed(2),
      x: visible ? lm.x : null,
      y: visible ? lm.y : null,
      z: visible ? lm.z : null,
    };
  });

  const joints = Object.keys(recording.frames[0]?.landmarks || {}) as Array<keyof PoseLandmarks>;

  // Detect if recording is in mm (3D lab) or normalised [0,1] (2D lab)
  // Read directly from frames (not chartData) to avoid nulls, skip low-visibility frames
  const maxAbsX = Math.max(0, ...recording.frames
    .filter(f => (f.landmarks[selectedJoint]?.visibility ?? 1) >= VISIBILITY_THRESHOLD)
    .map(f => Math.abs(f.landmarks[selectedJoint].x)));
  const isMillimetres = maxAbsX > 2;

  // Tick formatter: abbreviate large mm values to avoid axis overflow
  const fmtTick = (v: number) => {
    if (!isMillimetres) return v.toFixed(3);
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'm';
    return Math.round(v) + 'mm';
  };


  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 overflow-y-auto">
      <div className="min-h-screen p-4 flex items-center justify-center">
        <Card className="bg-gray-800 border-gray-700 p-6 max-w-6xl w-full">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1">{recording.name}</h2>
              <div className="flex gap-2">
                <Badge variant="secondary" className="bg-gray-700 text-gray-200">
                  {recording.frames.length} frames
                </Badge>
                <Badge variant="secondary" className="bg-gray-700 text-gray-200">
                  {recording.frameRate.toFixed(1)} FPS
                </Badge>
                <Badge variant="secondary" className="bg-gray-700 text-gray-200">
                  {(recording.duration / 1000).toFixed(2)}s
                </Badge>
              </div>
            </div>
            <Button
              variant="ghost"
              onClick={onClose}
              className="text-white hover:bg-gray-700"
            >
              Close
            </Button>
          </div>

          {/* Joint Selection */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-300 mb-2">Select Joint to Analyze</h3>
            <div className="flex flex-wrap gap-2">
              {joints.map((joint) => (
                <Button
                  key={joint}
                  variant={selectedJoint === joint ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedJoint(joint)}
                  className={
                    selectedJoint === joint
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'border-gray-600 text-gray-300 hover:bg-gray-700'
                  }
                >
                  {joint}
                </Button>
              ))}
            </div>
          </div>

          <Tabs defaultValue="quality" className="w-full">
            <TabsList className="bg-gray-700 mb-4 grid grid-cols-4 lg:grid-cols-8 gap-1">
              <TabsTrigger value="quality" className="data-[state=active]:bg-gray-600 text-xs">
                Quality
              </TabsTrigger>
              <TabsTrigger value="jitter" className="data-[state=active]:bg-gray-600 text-xs">
                Jitter
              </TabsTrigger>
              <TabsTrigger value="occlusion" className="data-[state=active]:bg-gray-600 text-xs">
                Occlusion
              </TabsTrigger>
              <TabsTrigger value="limbswap" className="data-[state=active]:bg-gray-600 text-xs">
                Limb Swap
              </TabsTrigger>
              <TabsTrigger value="depth" className="data-[state=active]:bg-gray-600 text-xs">
                Depth
              </TabsTrigger>
              <TabsTrigger value="position" className="data-[state=active]:bg-gray-600 text-xs">
                Position
              </TabsTrigger>
              <TabsTrigger value="trajectory" className="data-[state=active]:bg-gray-600 text-xs">
                Trajectory
              </TabsTrigger>
              <TabsTrigger value="raw" className="data-[state=active]:bg-gray-600 text-xs">
                Raw Data
              </TabsTrigger>
            </TabsList>

            <TabsContent value="quality" className="space-y-6">
              {(() => {
                const qualitySummary = calculateQualitySummary(recording);

                return (
                  <div className="space-y-6">
                    {/* Overall Score Card */}
                    <Card className="bg-gray-900 border-gray-700 p-6">
                      <div className="text-center mb-4">
                        <h3 className="text-sm font-semibold text-gray-400 mb-2">Overall Quality Score</h3>
                        <div className={`text-6xl font-bold ${
                          qualitySummary.overallScore >= 80 ? 'text-green-500' :
                          qualitySummary.overallScore >= 60 ? 'text-yellow-500' :
                          'text-red-500'
                        }`}>
                          {qualitySummary.overallScore.toFixed(0)}
                        </div>
                        <div className="text-sm text-gray-400 mt-1">out of 100</div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                        <div className="text-center p-3 bg-gray-800 rounded-lg">
                          <div className="text-2xl font-bold text-blue-400">
                            {qualitySummary.jitterScore.toFixed(0)}
                          </div>
                          <div className="text-xs text-gray-400 mt-1">Smoothness</div>
                        </div>
                        <div className="text-center p-3 bg-gray-800 rounded-lg">
                          <div className="text-2xl font-bold text-purple-400">
                            {qualitySummary.occlusionScore.toFixed(0)}
                          </div>
                          <div className="text-xs text-gray-400 mt-1">Visibility</div>
                        </div>
                      </div>
                    </Card>

                    {/* Issues */}
                    {qualitySummary.issues.length > 0 && (
                      <Card className="bg-gray-900 border-gray-700 p-4">
                        <h4 className="text-white font-semibold mb-3 flex items-center">
                          <AlertTriangle className="h-4 w-4 mr-2 text-yellow-500" />
                          Detected Issues
                        </h4>
                        <div className="space-y-2">
                          {qualitySummary.issues.map((issue, i) => (
                            <div key={i} className="flex items-start text-sm text-gray-300">
                              <XCircle className="h-4 w-4 mr-2 text-red-500 mt-0.5 flex-shrink-0" />
                              {issue}
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}

                    {qualitySummary.issues.length === 0 && (
                      <Card className="bg-gray-900 border-gray-700 p-4">
                        <div className="flex items-center text-green-500">
                          <CheckCircle2 className="h-5 w-5 mr-2" />
                          <span className="font-semibold">No major issues detected</span>
                        </div>
                      </Card>
                    )}

                    <div className="text-sm text-gray-400 p-4 bg-gray-900 rounded-lg">
                      <p className="mb-2"><strong className="text-gray-300">Quality Metrics:</strong></p>
                      <ul className="space-y-1 list-disc list-inside">
                        <li><strong>Smoothness:</strong> Measures joint stability and lack of jitter</li>
                        <li><strong>Visibility:</strong> Average landmark visibility across all frames</li>
                        <li><strong>Tracking:</strong> Anatomical consistency (no left/right swaps)</li>
                      </ul>
                    </div>
                  </div>
                );
              })()}
            </TabsContent>

            <TabsContent value="jitter" className="space-y-6">
              {(() => {
                const jitterMetrics = calculateJitterMetrics(recording, selectedJoint);

                return (
                  <div className="space-y-6">
                    <Card className="bg-gray-900 border-gray-700 p-4">
                      <h4 className="text-white font-semibold mb-3">Joint Jitter Analysis: {selectedJoint}</h4>
                      {jitterMetrics.shoulderWidthRef !== null && (
                        <div className="text-xs text-gray-500 mb-3">
                          Body-scale ref (shoulder width): {jitterMetrics.shoulderWidthRef.toFixed(4)} — metrics normalised, dimensionless
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-sm text-gray-400">Mean Velocity <span className="text-gray-600">(body-widths/s)</span></div>
                          <div className="text-2xl font-bold text-blue-400">
                            {jitterMetrics.relativeVelocity.toFixed(4)}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-400">Velocity Variance <span className="text-gray-600">(body-widths/s)²</span></div>
                          <div className="text-2xl font-bold text-white">
                            {jitterMetrics.velocityVariance.toFixed(4)}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-400">Position Std Dev (X)</div>
                          <div className="text-lg font-mono text-white">
                            {jitterMetrics.positionStdDev.x.toFixed(4)}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-400">Position Std Dev (Y)</div>
                          <div className="text-lg font-mono text-white">
                            {jitterMetrics.positionStdDev.y.toFixed(4)}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-400">High Freq. Noise</div>
                          <div className="text-lg font-mono text-white">
                            {(jitterMetrics.highFrequencyNoise * 100).toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    </Card>

                    {/* Position X Chart */}
                    <div>
                      <h4 className="text-white font-semibold mb-2">X Position Over Time {isMillimetres && <span className="text-xs text-gray-500 font-normal">(mm)</span>}</h4>
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis dataKey="frameNumber" stroke="#9CA3AF" label={{ value: 'Frame', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }} />
                          <YAxis stroke="#9CA3AF" domain={['auto', 'auto']} tickFormatter={fmtTick} width={isMillimetres ? 60 : 40} />
                          <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', color: '#fff' }} formatter={(v) => [fmtTick(Number(v)), 'X']} />
                          <Line type="monotone" isAnimationActive={false} dataKey="x" stroke="#3B82F6" strokeWidth={2} dot={false} name="X Position" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Position Y Chart */}
                    <div>
                      <h4 className="text-white font-semibold mb-2">Y Position Over Time {isMillimetres && <span className="text-xs text-gray-500 font-normal">(mm)</span>}</h4>
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis dataKey="frameNumber" stroke="#9CA3AF" label={{ value: 'Frame', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }} />
                          <YAxis stroke="#9CA3AF" domain={['auto', 'auto']} tickFormatter={fmtTick} width={isMillimetres ? 60 : 40} />
                          <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', color: '#fff' }} formatter={(v) => [fmtTick(Number(v)), 'Y']} />
                          <Line type="monotone" isAnimationActive={false} dataKey="y" stroke="#10B981" strokeWidth={2} dot={false} name="Y Position" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Position Z Chart */}
                    <div>
                      <h4 className="text-white font-semibold mb-2">Z Position Over Time {isMillimetres && <span className="text-xs text-gray-500 font-normal">(mm)</span>}</h4>
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis dataKey="frameNumber" stroke="#9CA3AF" label={{ value: 'Frame', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }} />
                          <YAxis stroke="#9CA3AF" domain={['auto', 'auto']} tickFormatter={fmtTick} width={isMillimetres ? 60 : 40} />
                          <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', color: '#fff' }} formatter={(v) => [fmtTick(Number(v)), 'Z']} />
                          <Line type="monotone" isAnimationActive={false} dataKey="z" stroke="#F59E0B" strokeWidth={2} dot={false} name="Z Position" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="text-sm text-gray-400 p-4 bg-gray-900 rounded-lg">
                      <p className="mb-2"><strong className="text-gray-300">About Jitter:</strong></p>
                      <p>Joint jitter refers to rapid, unintended micro-movements in tracked landmarks. High jitter can indicate poor lighting, occlusion, or tracking instability. A smoothness score above 80 is excellent, 60-80 is good, below 60 indicates significant jitter.</p>
                    </div>
                  </div>
                );
              })()}
            </TabsContent>

            <TabsContent value="occlusion" className="space-y-6">
              {(() => {
                const occlusionMetrics = calculateOcclusionMetrics(recording, selectedJoint);

                const visibilityChartData = occlusionMetrics.visibilityTimeline.map(v => ({
                  frame: v.frame,
                  visibility: v.visibility,
                  threshold: 0.5,
                }));

                return (
                  <div className="space-y-6">
                    <Card className="bg-gray-900 border-gray-700 p-4">
                      <h4 className="text-white font-semibold mb-3">Occlusion Analysis: {selectedJoint}</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <div className="text-sm text-gray-400">Avg Visibility</div>
                          <div className="text-2xl font-bold text-white">
                            {(occlusionMetrics.averageVisibility * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-400">Min Visibility</div>
                          <div className="text-2xl font-bold text-white">
                            {(occlusionMetrics.minVisibility * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-400">Occluded Frames</div>
                          <div className="text-2xl font-bold text-orange-500">
                            {occlusionMetrics.occludedFrameCount}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-400">Occlusion Rate</div>
                          <div className="text-2xl font-bold text-red-500">
                            {occlusionMetrics.occludedFramePercentage.toFixed(1)}%
                          </div>
                        </div>
                      </div>
                    </Card>

                    <div>
                      <h4 className="text-white font-semibold mb-2">Visibility Timeline</h4>
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={visibilityChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis
                            dataKey="frame"
                            stroke="#9CA3AF"
                            label={{ value: 'Frame', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }}
                          />
                          <YAxis stroke="#9CA3AF" domain={[0, 1]} />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', color: '#fff' }}
                          />
                          <Line type="monotone" isAnimationActive={false} dataKey="visibility" stroke="#3B82F6" strokeWidth={2} dot={false} name="Visibility" />
                          <Line type="monotone" isAnimationActive={false} dataKey="threshold" stroke="#EF4444" strokeWidth={1} strokeDasharray="5 5" dot={false} name="Threshold" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="text-sm text-gray-400 p-4 bg-gray-900 rounded-lg">
                      <p className="mb-2"><strong className="text-gray-300">About Occlusion:</strong></p>
                      <p>Occlusion occurs when a body part is hidden from the camera view. MediaPipe provides a visibility score (0-1) for each landmark. Values below 0.5 indicate the landmark is likely occluded or outside the frame. High occlusion rates can affect motion capture quality.</p>
                    </div>
                  </div>
                );
              })()}
            </TabsContent>

            <TabsContent value="limbswap" className="space-y-6">
              {(() => {
                const limbSwapMetrics = detectLimbSwaps(recording);

                return (
                  <div className="space-y-6">
                    <Card className="bg-gray-900 border-gray-700 p-4">
                      <h4 className="text-white font-semibold mb-3">Limb Swap Detection</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div>
                          <div className="text-sm text-gray-400">Swap Events</div>
                          <div className="text-2xl font-bold text-white">
                            {limbSwapMetrics.swapCount}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-400">Affected Frames</div>
                          <div className="text-2xl font-bold text-orange-500">
                            {limbSwapMetrics.affectedFramePercentage.toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-400">Tracking Quality</div>
                          <div className={`text-2xl font-bold ${
                            limbSwapMetrics.swapCount === 0 ? 'text-green-500' :
                            limbSwapMetrics.affectedFramePercentage < 10 ? 'text-yellow-500' :
                            'text-red-500'
                          }`}>
                            {limbSwapMetrics.swapCount === 0 ? 'Excellent' :
                             limbSwapMetrics.affectedFramePercentage < 10 ? 'Fair' : 'Poor'}
                          </div>
                        </div>
                      </div>
                    </Card>

                    {limbSwapMetrics.swapCount > 0 && (
                      <Card className="bg-gray-900 border-gray-700 p-4">
                        <h4 className="text-white font-semibold mb-3 flex items-center">
                          <AlertTriangle className="h-4 w-4 mr-2 text-yellow-500" />
                          Detected Swap Events
                        </h4>
                        <div className="bg-gray-800 rounded p-3 max-h-96 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="text-gray-400 border-b border-gray-700">
                              <tr>
                                <th className="text-left pb-2">Frame</th>
                                <th className="text-left pb-2">Time (s)</th>
                                <th className="text-left pb-2">Type</th>
                                <th className="text-left pb-2">Description</th>
                              </tr>
                            </thead>
                            <tbody className="text-gray-300">
                              {limbSwapMetrics.detectedSwaps.map((swap, i) => (
                                <tr key={i} className="border-b border-gray-800">
                                  <td className="py-2">{swap.frame}</td>
                                  <td>{(swap.timestamp / 1000).toFixed(2)}</td>
                                  <td>
                                    <Badge variant="secondary" className="bg-orange-500/20 text-orange-300 text-xs">
                                      {swap.type}
                                    </Badge>
                                  </td>
                                  <td className="text-gray-400">{swap.description}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    )}

                    {limbSwapMetrics.swapCount === 0 && (
                      <Card className="bg-gray-900 border-gray-700 p-4">
                        <div className="flex items-center text-green-500">
                          <CheckCircle2 className="h-5 w-5 mr-2" />
                          <span className="font-semibold">No limb swap errors detected</span>
                        </div>
                      </Card>
                    )}

                    <div className="text-sm text-gray-400 p-4 bg-gray-900 rounded-lg">
                      <p className="mb-2"><strong className="text-gray-300">About Limb Swaps:</strong></p>
                      <p>Limb swap errors occur when MediaPipe confuses left and right body parts. This can happen when limbs cross or when the person is viewed from certain angles. Frequent swaps indicate poor tracking quality and may require better lighting or camera positioning.</p>
                    </div>
                  </div>
                );
              })()}
            </TabsContent>

            <TabsContent value="depth" className="space-y-6">
              {(() => {
                const depthMetrics = detectEnhancedDepthAmbiguity(recording);

                return (
                  <div className="space-y-6">
                    <Card className="bg-gray-900 border-gray-700 p-4">
                      <h4 className="text-white font-semibold mb-3">Depth Ambiguity Analysis</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <div className="text-sm text-gray-400">Severity Score</div>
                          <div className={`text-2xl font-bold ${
                            depthMetrics.severityScore < 30 ? 'text-green-500' :
                            depthMetrics.severityScore < 60 ? 'text-yellow-500' :
                            'text-red-500'
                          }`}>
                            {depthMetrics.severityScore.toFixed(0)}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-400">Ambiguous Pairs</div>
                          <div className="text-2xl font-bold text-orange-500">
                            {depthMetrics.pairAnalyses.filter(p => p.ambiguityDetected).length}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-400">Limb Crossings</div>
                          <div className="text-2xl font-bold text-purple-500">
                            {depthMetrics.limbCrossingEvents.length}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-400">Overlaps</div>
                          <div className="text-2xl font-bold text-blue-500">
                            {depthMetrics.overlapDetections.length}
                          </div>
                        </div>
                      </div>
                    </Card>

                    {depthMetrics.pairAnalyses.some(p => p.ambiguityDetected) && (
                      <Card className="bg-gray-900 border-gray-700 p-4">
                        <h4 className="text-white font-semibold mb-3">Joint Pair Depth Analysis</h4>
                        <div className="space-y-3">
                          {depthMetrics.pairAnalyses.filter(p => p.ambiguityDetected).map((pair, i) => (
                            <div key={i} className="bg-gray-800 rounded p-3">
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-white font-semibold">{pair.jointPair}</span>
                                <Badge variant="secondary" className="bg-red-500/20 text-red-300 text-xs">
                                  Ambiguous
                                </Badge>
                              </div>
                              <div className="grid grid-cols-2 gap-3 text-xs">
                                <div>
                                  <span className="text-gray-400">Z-Order Flips:</span>
                                  <span className="text-white ml-2 font-mono">{pair.zOrderFlips}</span>
                                </div>
                                <div>
                                  <span className="text-gray-400">Inconsistency:</span>
                                  <span className="text-white ml-2 font-mono">{pair.inconsistencyPercentage.toFixed(1)}%</span>
                                </div>
                                <div>
                                  <span className="text-gray-400">Depth Jitter Score:</span>
                                  <span className={`ml-2 font-mono ${
                                    (pair.depthJitterScore ?? 0) > 70 ? 'text-green-400' :
                                    (pair.depthJitterScore ?? 0) > 40 ? 'text-yellow-400' : 'text-red-400'
                                  }`}>
                                    {pair.depthJitterScore?.toFixed(0) ?? 'N/A'}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-400">Depth Movement Ratio:</span>
                                  <span className="text-white ml-2 font-mono">{pair.depthMovementRatio?.toFixed(2) ?? 'N/A'}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}

                    {depthMetrics.limbCrossingEvents.length > 0 && (
                      <Card className="bg-gray-900 border-gray-700 p-4">
                        <h4 className="text-white font-semibold mb-3">Limb Crossing Events</h4>
                        <div className="bg-gray-800 rounded p-3 max-h-64 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="text-gray-400 border-b border-gray-700">
                              <tr>
                                <th className="text-left pb-2">Frame</th>
                                <th className="text-left pb-2">Time (s)</th>
                                <th className="text-left pb-2">Description</th>
                              </tr>
                            </thead>
                            <tbody className="text-gray-300">
                              {depthMetrics.limbCrossingEvents.map((event, i) => (
                                <tr key={i} className="border-b border-gray-800">
                                  <td className="py-2">{event.frame}</td>
                                  <td>{(event.timestamp / 1000).toFixed(2)}</td>
                                  <td className="text-gray-400">{event.description}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    )}

                    {depthMetrics.overlapDetections.length > 0 && (
                      <Card className="bg-gray-900 border-gray-700 p-4">
                        <h4 className="text-white font-semibold mb-3">Joint Overlap Detections</h4>
                        <div className="bg-gray-800 rounded p-3 max-h-64 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="text-gray-400 border-b border-gray-700">
                              <tr>
                                <th className="text-left pb-2">Frame</th>
                                <th className="text-left pb-2">Time (s)</th>
                                <th className="text-left pb-2">Joints</th>
                                <th className="text-right pb-2">2D Distance</th>
                              </tr>
                            </thead>
                            <tbody className="text-gray-300">
                              {depthMetrics.overlapDetections.map((detection, i) => (
                                <tr key={i} className="border-b border-gray-800">
                                  <td className="py-2">{detection.frame}</td>
                                  <td>{(detection.timestamp / 1000).toFixed(2)}</td>
                                  <td className="text-gray-400">{detection.joint1} - {detection.joint2}</td>
                                  <td className="text-right font-mono">{detection.xy2DDistance.toFixed(3)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    )}

                    {depthMetrics.severityScore < 30 && (
                      <Card className="bg-gray-900 border-gray-700 p-4">
                        <div className="flex items-center text-green-500">
                          <CheckCircle2 className="h-5 w-5 mr-2" />
                          <span className="font-semibold">Depth tracking is stable and consistent</span>
                        </div>
                      </Card>
                    )}

                    <div className="text-sm text-gray-400 p-4 bg-gray-900 rounded-lg">
                      <p className="mb-2"><strong className="text-gray-300">About Depth Ambiguity:</strong></p>
                      <p>Depth ambiguity occurs when MediaPipe's z-coordinate tracking becomes unstable. This is especially common when limbs cross or overlap in the 2D camera view. Z-order flips (when relative depth suddenly reverses) and rapid z-separation changes indicate depth tracking issues. A severity score below 30 is excellent, 30-60 is acceptable, and above 60 indicates significant depth tracking problems.</p>
                    </div>
                  </div>
                );
              })()}
            </TabsContent>

            <TabsContent value="position" className="space-y-6">
              {/* X Coordinate Chart */}
              <div>
                <h4 className="text-white font-semibold mb-2">X Coordinate (Horizontal)</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis
                      dataKey="frameNumber"
                      stroke="#9CA3AF"
                      label={{ value: 'Frame', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }}
                    />
                    <YAxis stroke="#9CA3AF" domain={[0, 1]} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', color: '#fff' }}
                    />
                    <Line type="monotone" isAnimationActive={false} dataKey="x" stroke="#3B82F6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Y Coordinate Chart */}
              <div>
                <h4 className="text-white font-semibold mb-2">Y Coordinate (Vertical)</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis
                      dataKey="frameNumber"
                      stroke="#9CA3AF"
                      label={{ value: 'Frame', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }}
                    />
                    <YAxis stroke="#9CA3AF" domain={[0, 1]} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', color: '#fff' }}
                    />
                    <Line type="monotone" isAnimationActive={false} dataKey="y" stroke="#10B981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Z Coordinate Chart */}
              <div>
                <h4 className="text-white font-semibold mb-2">Z Coordinate (Depth)</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis
                      dataKey="frameNumber"
                      stroke="#9CA3AF"
                      label={{ value: 'Frame', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }}
                    />
                    <YAxis stroke="#9CA3AF" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', color: '#fff' }}
                    />
                    <Line type="monotone" isAnimationActive={false} dataKey="z" stroke="#F59E0B" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </TabsContent>

            <TabsContent value="trajectory" className="space-y-6">
              <Card className="bg-gray-900 border-gray-700 p-4">
                <h4 className="text-white font-semibold mb-3">2D Movement Path: {selectedJoint}</h4>
                <ResponsiveContainer width="100%" height={400}>
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      domain={[0, 1]}
                      stroke="#9CA3AF"
                      label={{ value: 'X Position', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      domain={[0, 1]}
                      stroke="#9CA3AF"
                      label={{ value: 'Y Position', angle: -90, position: 'insideLeft', fill: '#9CA3AF' }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', color: '#fff' }}
                      formatter={(value: any) => typeof value === 'number' ? value.toFixed(3) : value}
                    />
                    <Scatter
                      data={chartData}
                      fill="#3B82F6"
                      line={{ stroke: '#3B82F6', strokeWidth: 1 }}
                      lineType="joint"
                      isAnimationActive={false}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </Card>

              <Card className="bg-gray-900 border-gray-700 p-4">
                <h4 className="text-white font-semibold mb-3">3D Movement (X-Y-Z)</h4>
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <h5 className="text-sm text-gray-400 mb-2">X-Z Plane (Horizontal-Depth)</h5>
                    <ResponsiveContainer width="100%" height={250}>
                      <ScatterChart>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis
                          type="number"
                          dataKey="x"
                          domain={[0, 1]}
                          stroke="#9CA3AF"
                          label={{ value: 'X', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }}
                        />
                        <YAxis
                          type="number"
                          dataKey="z"
                          stroke="#9CA3AF"
                          label={{ value: 'Z (Depth)', angle: -90, position: 'insideLeft', fill: '#9CA3AF' }}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', color: '#fff' }}
                          formatter={(value: any) => typeof value === 'number' ? value.toFixed(3) : value}
                        />
                        <Scatter
                          data={chartData}
                          fill="#F59E0B"
                          line={{ stroke: '#F59E0B', strokeWidth: 1 }}
                          lineType="joint"
                          isAnimationActive={false}
                        />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>

                  <div>
                    <h5 className="text-sm text-gray-400 mb-2">Y-Z Plane (Vertical-Depth)</h5>
                    <ResponsiveContainer width="100%" height={250}>
                      <ScatterChart>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis
                          type="number"
                          dataKey="y"
                          domain={[0, 1]}
                          stroke="#9CA3AF"
                          label={{ value: 'Y', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }}
                        />
                        <YAxis
                          type="number"
                          dataKey="z"
                          stroke="#9CA3AF"
                          label={{ value: 'Z (Depth)', angle: -90, position: 'insideLeft', fill: '#9CA3AF' }}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', color: '#fff' }}
                          formatter={(value: any) => typeof value === 'number' ? value.toFixed(3) : value}
                        />
                        <Scatter
                          data={chartData}
                          fill="#10B981"
                          line={{ stroke: '#10B981', strokeWidth: 1 }}
                          lineType="joint"
                          isAnimationActive={false}
                        />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </Card>

              <div className="text-sm text-gray-400 p-4 bg-gray-900 rounded-lg">
                <p className="mb-2"><strong className="text-gray-300">About Trajectory:</strong></p>
                <p>The trajectory view shows the path a joint takes through space over time. The 2D movement path shows horizontal (X) and vertical (Y) motion, while the 3D views include depth (Z) information. Connected dots show the sequential movement, helping identify patterns, repeated motions, or unusual tracking behavior.</p>
              </div>
            </TabsContent>

            <TabsContent value="raw">
              <Tabs defaultValue="summary" className="w-full">
                <TabsList className="bg-gray-700 mb-4">
                  <TabsTrigger value="summary" className="data-[state=active]:bg-gray-600">
                    Summary
                  </TabsTrigger>
                  <TabsTrigger value="confidence" className="data-[state=active]:bg-gray-600">
                    Confidence Scores
                  </TabsTrigger>
                  <TabsTrigger value="full" className="data-[state=active]:bg-gray-600">
                    Full JSON
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="summary">
                  <Card className="bg-gray-900 border-gray-700 p-4">
                    <h4 className="text-white font-semibold mb-3">Recording Metadata</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Recording ID:</span>
                        <span className="text-white font-mono text-xs">{recording.id}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Name:</span>
                        <span className="text-white">{recording.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Start Time:</span>
                        <span className="text-white">{new Date(recording.startTime).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Duration:</span>
                        <span className="text-white">{(recording.duration / 1000).toFixed(2)}s</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Frame Rate:</span>
                        <span className="text-white">{recording.frameRate.toFixed(2)} FPS</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Total Frames:</span>
                        <span className="text-white">{recording.frames.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Landmarks per Frame:</span>
                        <span className="text-white">17 body points</span>
                      </div>
                    </div>

                    {recording.metadata.notes && (
                      <div className="mt-4 pt-4 border-t border-gray-700">
                        <div className="text-gray-400 text-sm mb-1">Notes:</div>
                        <div className="text-white text-sm italic">"{recording.metadata.notes}"</div>
                      </div>
                    )}
                  </Card>
                </TabsContent>

                <TabsContent value="confidence">
                  <div className="space-y-4">
                    <Card className="bg-gray-900 border-gray-700 p-4">
                      <h4 className="text-white font-semibold mb-3">MediaPipe Confidence Scores</h4>
                      <p className="text-gray-400 text-sm mb-4">
                        Each landmark has a visibility confidence score from MediaPipe:
                      </p>
                      <div className="space-y-2 text-sm mb-4">
                        <div className="flex items-start gap-2">
                          <span className="text-blue-400 font-semibold min-w-24">visibility:</span>
                          <span className="text-gray-300">Likelihood the landmark is visible and not occluded in the image (0-1). Lower scores indicate the landmark may be hidden behind something or outside the camera view.</span>
                        </div>
                      </div>
                    </Card>

                    {/* Show confidence for current joint */}
                    <Card className="bg-gray-900 border-gray-700 p-4">
                      <h4 className="text-white font-semibold mb-3">
                        Current Joint: {selectedJoint}
                      </h4>
                      <div className="bg-gray-800 rounded p-3 max-h-96 overflow-y-auto">
                        <table className="w-full text-xs font-mono">
                          <thead className="text-gray-400 border-b border-gray-700">
                            <tr>
                              <th className="text-left pb-2">Frame</th>
                              <th className="text-right pb-2">Time (s)</th>
                              <th className="text-right pb-2">X</th>
                              <th className="text-right pb-2">Y</th>
                              <th className="text-right pb-2">Z</th>
                              <th className="text-right pb-2">Visibility</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-300">
                            {recording.frames.map((frame, i) => {
                              const landmark = frame.landmarks[selectedJoint];
                              const visibility = landmark.visibility ?? 1.0;

                              return (
                                <tr key={i} className="border-b border-gray-800">
                                  <td className="py-1">{frame.frameNumber}</td>
                                  <td className="text-right">{(frame.timestamp / 1000).toFixed(2)}</td>
                                  <td className="text-right text-blue-400">{landmark.x.toFixed(3)}</td>
                                  <td className="text-right text-green-400">{landmark.y.toFixed(3)}</td>
                                  <td className="text-right text-orange-400">{landmark.z.toFixed(3)}</td>
                                  <td className={`text-right ${visibility < 0.5 ? 'text-red-400' : visibility < 0.7 ? 'text-yellow-400' : 'text-green-400'}`}>
                                    {visibility.toFixed(3)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="mt-3 text-xs text-gray-400">
                        <span className="text-green-400">■</span> Good (&gt;0.7)
                        <span className="text-yellow-400 ml-3">■</span> Fair (0.5-0.7)
                        <span className="text-red-400 ml-3">■</span> Poor (&lt;0.5)
                      </div>
                    </Card>

                    {/* Average confidence across all joints */}
                    <Card className="bg-gray-900 border-gray-700 p-4">
                      <h4 className="text-white font-semibold mb-3">
                        Average Visibility Across All Joints
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {joints.map(joint => {
                          const avgVisibility = recording.frames.reduce((sum, frame) =>
                            sum + (frame.landmarks[joint].visibility ?? 1.0), 0) / recording.frames.length;

                          return (
                            <div key={joint} className="bg-gray-800 rounded p-3">
                              <div className="text-white text-sm font-semibold mb-1">{joint}</div>
                              <div className={`text-2xl font-mono ${avgVisibility < 0.5 ? 'text-red-400' : avgVisibility < 0.7 ? 'text-yellow-400' : 'text-green-400'}`}>
                                {avgVisibility.toFixed(3)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="full">
                  <div className="bg-gray-900 rounded-lg p-4 max-h-96 overflow-auto">
                    <pre className="text-xs text-gray-300 font-mono">
                      {JSON.stringify(recording, null, 2)}
                    </pre>
                  </div>
                </TabsContent>
              </Tabs>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}