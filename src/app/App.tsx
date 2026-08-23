import { MotionCaptureView } from './components/MotionCaptureView';
import { ThreeDMotionCaptureView } from './components/ThreeDMotionCaptureView';
import { FailureCorrectionLabView } from './components/FailureCorrectionLabView';
import { IMULabView } from './components/IMULabView';
import { Toaster } from './components/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';

export default function App() {
  return (
    <>
      <Toaster position="top-right" />
      <div className="bg-gray-950 min-h-screen">
        <Tabs defaultValue="2d" className="w-full">
          <div className="bg-gray-900 border-b border-gray-800 px-6 py-3">
            <TabsList className="bg-gray-800 flex-wrap h-auto gap-1">
              <TabsTrigger value="2d" className="data-[state=active]:bg-gray-700">
                2D Motion Capture
              </TabsTrigger>
              <TabsTrigger value="3d" className="data-[state=active]:bg-gray-700">
                3D Motion Capture (Stereo)
              </TabsTrigger>
              <TabsTrigger value="fc" className="data-[state=active]:bg-purple-900">
                3D + Failure Correction
              </TabsTrigger>
              <TabsTrigger value="imu" className="data-[state=active]:bg-blue-900">
                3D + Failure Correction + IMU
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="2d" className="m-0">
            <MotionCaptureView />
          </TabsContent>

          <TabsContent value="3d" className="m-0">
            <ThreeDMotionCaptureView />
          </TabsContent>

          <TabsContent value="fc" className="m-0">
            <FailureCorrectionLabView />
          </TabsContent>

          <TabsContent value="imu" className="m-0">
            <IMULabView />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}