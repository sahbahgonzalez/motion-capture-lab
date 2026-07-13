import { useEffect, useRef, useState, forwardRef, useImperativeHandle, memo } from 'react';
import { AlertCircle, RefreshCw, Video, VideoOff } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from './ui/button';

interface CameraFeedProps {
  onCameraReady?: () => void;
  className?: string;
  enableTestMode?: boolean; // Allow manual test mode
  facingMode?: 'user' | 'environment'; // Front or rear camera
  onCameraSwitch?: (newMode: 'user' | 'environment') => void;
  deviceId?: string; // specific camera to use
}

export interface CameraFeedHandle {
  videoElement: HTMLVideoElement | null;
  switchCamera: () => void;
}

const CameraFeedComponent = forwardRef<CameraFeedHandle, CameraFeedProps>(
  ({ onCameraReady, className = '', enableTestMode = false, facingMode = 'user', onCameraSwitch, deviceId }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [useTestMode, setUseTestMode] = useState(enableTestMode);
  const [permissionState, setPermissionState] = useState<string>('unknown');
  const [currentFacingMode, setCurrentFacingMode] = useState<'user' | 'environment'>(facingMode);

  // Expose video element via a getter so callers always get the live DOM node,
  // not the value captured at mount time (which would be null).
  useImperativeHandle(ref, () => ({
    get videoElement() { return videoRef.current; },
    switchCamera: () => {
      const newMode = currentFacingMode === 'user' ? 'environment' : 'user';
      setCurrentFacingMode(newMode);
      onCameraSwitch?.(newMode);
    }
  }), [currentFacingMode, onCameraSwitch]);

  const checkPermissions = async () => {
    try {
      if (navigator.permissions) {
        const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
        setPermissionState(result.state);
        console.log('Camera permission state:', result.state);
        return result.state;
      }
    } catch (err) {
      console.log('Permission API not supported or error:', err);
    }
    return 'unknown';
  };

  const startCamera = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // First, check if mediaDevices is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('UNSUPPORTED');
      }

      // Check current permission state
      await checkPermissions();

      console.log('Requesting camera access...');

      // Request camera access with specific constraints
      const videoConstraints: MediaTrackConstraints = deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } };

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });

      console.log('Camera access granted!', stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setIsLoading(false);
          onCameraReady?.();
        };
      }

      return stream;
    } catch (err) {
      // Check permission state after error
      const permState = await checkPermissions();
      
      // Provide user-friendly error messages
      if (err instanceof Error) {
        if (err.message === 'UNSUPPORTED') {
          console.warn('⚠️ Camera API not supported - switching to test mode');
          setError('Camera API not supported. Please use a modern browser (Chrome, Edge, or Firefox).');
        } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          // Automatically switch to test mode for iframe restrictions
          console.log('📹 Camera blocked (iframe security) - auto-switching to test mode');
          setUseTestMode(true);
          setError(null);
          setIsLoading(false);
          onCameraReady?.();
          return null;
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          console.warn('⚠️ No camera found - switching to test mode');
          setError('No camera found on this device.');
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          console.warn('⚠️ Camera in use - switching to test mode');
          setError('Camera is already in use by another application. Please close other apps and try again.');
        } else {
          console.warn('⚠️ Camera error - switching to test mode:', err.message);
          setError(`Unable to access camera: ${err.message}`);
        }
      } else {
        setError('An unknown error occurred while accessing the camera.');
      }
      setIsLoading(false);
      return null;
    }
  };

  useEffect(() => {
    if (useTestMode) {
      setIsLoading(false);
      setError(null);
      onCameraReady?.();
      return;
    }

    let stream: MediaStream | null = null;

    const initCamera = async () => {
      stream = await startCamera();
      streamRef.current = stream;
    };

    initCamera();

    // Cleanup: Stop camera when component unmounts
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, [retryCount, useTestMode, currentFacingMode, deviceId]);

  const handleRetry = () => {
    console.log('Retry button clicked');
    setRetryCount(prev => prev + 1);
  };

  const handleUseTestMode = () => {
    console.log('Test mode button clicked');
    setUseTestMode(true);
    setError(null);
    setIsLoading(false);
    onCameraReady?.();
  };

  if (error) {
    return (
      <div className={`flex items-center justify-start bg-gray-900 ${className}`}>
        <motion.div
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          className="px-6 py-8 max-w-md w-full ml-8 z-50 relative"
        >
          <div className="bg-red-500/20 border-2 border-red-500 rounded-2xl p-6 mb-4">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h3 className="text-white mb-2">Camera Access Error</h3>
            <p className="text-red-200 text-sm mb-4">{error}</p>
            <p className="text-xs text-red-300/70 mb-4">Permission State: {permissionState}</p>
            
            <div className="flex gap-2 justify-center flex-wrap">
              <Button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleRetry();
                }}
                variant="outline"
                className="border-red-400 text-red-300 hover:bg-red-500/20 gap-2 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </Button>
              
              <Button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleUseTestMode();
                }}
                className="bg-purple-500 hover:bg-purple-600 text-white gap-2 cursor-pointer"
              >
                <Video className="w-4 h-4" />
                Use Test Mode
              </Button>
            </div>
          </div>
          
          <div className="bg-black/50 rounded-xl p-4 border border-white/10">
            <p className="text-gray-300 text-xs text-left">
              <span className="font-semibold">🔧 Troubleshooting:</span>
              <br /><br />
              <span className="font-semibold">Browser Permissions:</span>
              <br />• Click lock icon 🔒 → Camera → Allow
              <br />• Hard refresh: Ctrl+Shift+R (Win) / Cmd+Shift+R (Mac)
              <br />• Clear cache and cookies for this site
              <br /><br />
              <span className="font-semibold">System Permissions:</span>
              <br />• Windows: Settings → Privacy → Camera
              <br />• Mac: System Settings → Privacy → Camera
              <br />• Ensure browser is allowed at system level
              <br /><br />
              <span className="font-semibold">Other Issues:</span>
              <br />• Close Zoom, Teams, other video apps
              <br />• Try different browser (Chrome recommended)
              <br />• Figma iframe restrictions may apply
              <br /><br />
              <span className="font-semibold">✨ Or click \"Use Test Mode\" to continue!</span>
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  // Test mode - simulated camera with gradient background
  if (useTestMode) {
    return (
      <div className={`relative ${className}`}>
        <div className="absolute inset-0 bg-gradient-to-br from-gray-800 via-gray-700 to-gray-900 flex items-center justify-center">
          {/* Simulated camera grid overlay */}
          <div className="absolute inset-0 opacity-10">
            <div className="w-full h-full" style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 50px, rgba(255,255,255,0.1) 50px, rgba(255,255,255,0.1) 51px), repeating-linear-gradient(90deg, transparent, transparent 50px, rgba(255,255,255,0.1) 50px, rgba(255,255,255,0.1) 51px)'
            }} />
          </div>
          
          <div className="text-center z-10">
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <VideoOff className="w-24 h-24 text-gray-500 mx-auto mb-4" />
            </motion.div>
            <div className="bg-purple-500/20 border border-purple-400 rounded-lg px-6 py-3">
              <p className="text-purple-300 text-sm">📹 Test Mode Active</p>
              <p className="text-gray-400 text-xs mt-1">Simulated camera view</p>
            </div>
          </div>
          
          {/* Info banner */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/80 border border-purple-400/50 rounded-xl px-6 py-3 max-w-md"
          >
            <p className="text-purple-200 text-xs text-center">
              <span className="font-semibold">ℹ️ Camera blocked by iframe security</span>
              <br />
              Real camera will work when exported to localhost or deployed.
              <br />
              See LOCAL_SETUP_GUIDE.md for instructions.
            </p>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full"
          />
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ transform: 'scaleX(-1)' }}
        className={`w-full h-full object-cover ${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-500`}
      />
    </div>
  );
});

CameraFeedComponent.displayName = 'CameraFeed';

export const CameraFeed = memo(CameraFeedComponent);