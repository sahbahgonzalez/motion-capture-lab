import { MotionCaptureView } from './components/MotionCaptureView';
import { ThreeDMotionCaptureView } from './components/ThreeDMotionCaptureView';
import { Toaster } from './components/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';

export default function App() {
  return (
    <>
      <Toaster position="top-right" />
      <div className="bg-gray-950 min-h-screen">
        <Tabs defaultValue="2d" className="w-full">
          <div className="bg-gray-900 border-b border-gray-800 px-6 py-3">
            <TabsList className="bg-gray-800">
              <TabsTrigger value="2d" className="data-[state=active]:bg-gray-700">
                2D Motion Capture
              </TabsTrigger>
              <TabsTrigger value="3d" className="data-[state=active]:bg-gray-700">
                3D Motion Capture (Stereo)
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="2d" className="m-0">
            <MotionCaptureView />
          </TabsContent>

          <TabsContent value="3d" className="m-0">
            <ThreeDMotionCaptureView />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}