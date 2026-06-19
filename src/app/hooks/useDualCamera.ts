import { useState, useEffect, useRef, useCallback } from 'react';

export interface DualCameraFrame {
  timestamp: number;
  cameraId: number;
  frameId: number;
  videoWidth: number;
  videoHeight: number;
}

export interface CameraInfo {
  deviceId: string;
  label: string;
  groupId: string;
}

export function useDualCamera() {
  const [camera1Stream, setCamera1Stream] = useState<MediaStream | null>(null);
  const [camera2Stream, setCamera2Stream] = useState<MediaStream | null>(null);
  const [availableCameras, setAvailableCameras] = useState<CameraInfo[]>([]);
  const [selectedCamera1, setSelectedCamera1] = useState<string>('');
  const [selectedCamera2, setSelectedCamera2] = useState<string>('');
  const [isCamera1Active, setIsCamera1Active] = useState(false);
  const [isCamera2Active, setIsCamera2Active] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const camera1Ref = useRef<HTMLVideoElement | null>(null);
  const camera2Ref = useRef<HTMLVideoElement | null>(null);

  // Enumerate available cameras
  const enumerateCameras = useCallback(async () => {
    try {
      console.log('🔍 Starting camera enumeration...');

      // First, get all devices (may have blank labels without permission)
      let devices = await navigator.mediaDevices.enumerateDevices();
      let videoDevices = devices.filter((device) => device.kind === 'videoinput');

      console.log('📹 Initial scan found', videoDevices.length, 'video input(s)');
      console.log('Raw video devices:', videoDevices.map(d => ({
        label: d.label || '(no label)',
        deviceId: d.deviceId,
        groupId: d.groupId
      })));

      // If we see devices with blank labels, we need to request permission first
      const hasBlankLabels = videoDevices.some((device) => !device.label);

      if (hasBlankLabels && videoDevices.length > 0) {
        console.log('⚠️ Found devices with blank labels - requesting permission...');
        try {
          // Request access to ALL cameras by trying different constraints
          // This ensures permission for all connected cameras, not just one
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              // Don't specify deviceId - this requests permission for all cameras
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          });

          console.log('✅ Got camera permission, stopping temporary stream...');

          // Stop the stream immediately - we just needed permission
          stream.getTracks().forEach((track) => {
            console.log('Stopping track:', track.label);
            track.stop();
          });

          // Wait a moment for devices to be fully released
          await new Promise(resolve => setTimeout(resolve, 500));

          // Re-enumerate now that we have permission
          console.log('🔄 Re-enumerating after permission granted...');
          devices = await navigator.mediaDevices.enumerateDevices();
          videoDevices = devices.filter((device) => device.kind === 'videoinput');

          console.log('📹 After permission:', videoDevices.length, 'video input(s)');
          console.log('Updated devices:', videoDevices.map(d => ({
            label: d.label || '(no label)',
            deviceId: d.deviceId.slice(0, 20) + '...',
          })));
        } catch (permErr) {
          console.error('❌ Could not get camera permission:', permErr);
          setError('Camera permission denied. Please allow camera access and refresh.');
          return [];
        }
      }

      // Remove any duplicates based on deviceId (shouldn't happen but just in case)
      const uniqueDevices = videoDevices.filter((device, index, self) =>
        index === self.findIndex((d) => d.deviceId === device.deviceId)
      );

      if (uniqueDevices.length !== videoDevices.length) {
        console.warn('⚠️ Removed duplicate devices. Before:', videoDevices.length, 'After:', uniqueDevices.length);
      }

      // Create camera list with unique labels
      const cameraList = uniqueDevices.map((device, index) => {
        let label = device.label || `Camera ${index + 1}`;

        // If multiple cameras have the same label, add distinguishing suffix
        const duplicatesWithSameLabel = uniqueDevices.filter(d => d.label === device.label);
        if (duplicatesWithSameLabel.length > 1) {
          // Find which duplicate this is (1st, 2nd, etc)
          const duplicateIndex = duplicatesWithSameLabel.findIndex(d => d.deviceId === device.deviceId);
          label = `${device.label} #${duplicateIndex + 1}`;
        }

        return {
          deviceId: device.deviceId,
          label: label,
          groupId: device.groupId,
        };
      });

      console.log(`✅ Final camera list (${cameraList.length}):`, cameraList.map(c => c.label));
      setAvailableCameras(cameraList);

      // Auto-select first two cameras if available
      if (cameraList.length >= 2 && !selectedCamera1 && !selectedCamera2) {
        setSelectedCamera1(cameraList[0].deviceId);
        setSelectedCamera2(cameraList[1].deviceId);
        console.log('✅ Auto-selected Camera 1:', cameraList[0].label);
        console.log('✅ Auto-selected Camera 2:', cameraList[1].label);
      } else if (cameraList.length === 1 && !selectedCamera1) {
        setSelectedCamera1(cameraList[0].deviceId);
        console.log('✅ Auto-selected Camera 1:', cameraList[0].label);
        console.warn('⚠️ Only 1 camera detected. Need 2 for stereo capture.');
      } else if (cameraList.length === 0) {
        console.error('❌ No cameras detected. Troubleshooting steps:');
        console.error('  1. Check USB cameras are plugged in');
        console.error('  2. Close other apps using cameras (Zoom, Teams, etc.)');
        console.error('  3. Try different USB ports');
        console.error('  4. Check Windows Device Manager for camera devices');
        console.error('  5. Restart browser');
      }

      return cameraList;
    } catch (err) {
      const errorMsg = 'Failed to enumerate cameras: ' + (err as Error).message;
      setError(errorMsg);
      console.error('❌ Camera enumeration error:', err);
      return [];
    }
  }, [selectedCamera1, selectedCamera2]);

  // Request permission and enumerate cameras on mount
  useEffect(() => {
    let mounted = true;

    const requestCameraPermission = async () => {
      try {
        console.log('🎥 Initializing camera detection...');

        // Enumerate cameras (will handle permission internally)
        await enumerateCameras();

        // Set up listener for device changes (hot-plug detection)
        const handleDeviceChange = () => {
          if (mounted) {
            console.log('🔄 Camera devices changed, re-enumerating...');
            enumerateCameras();
          }
        };

        navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

        return () => {
          mounted = false;
          navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
        };
      } catch (err) {
        if (mounted) {
          setError('Camera initialization failed: ' + (err as Error).message);
          console.error('Camera initialization error:', err);
        }
      }
    };

    const cleanup = requestCameraPermission();

    return () => {
      mounted = false;
      cleanup.then(cleanupFn => cleanupFn?.());
    };
  }, [enumerateCameras]);

  // Start camera 1
  const startCamera1 = useCallback(async (deviceId: string) => {
    try {
      console.log('🎬 Starting Camera 1 with deviceId:', deviceId);

      // Stop existing stream if any
      if (camera1Stream) {
        console.log('⏹️ Stopping existing Camera 1 stream');
        camera1Stream.getTracks().forEach((track) => track.stop());
        // Wait for camera to be fully released
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      };

      console.log('📹 Requesting Camera 1 stream with constraints:', constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      const videoTrack = stream.getVideoTracks()[0];
      console.log('✅ Camera 1 started:', videoTrack.label);
      console.log('   Settings:', videoTrack.getSettings());

      // Set video element srcObject
      if (camera1Ref.current) {
        camera1Ref.current.srcObject = stream;
      }

      // Update state - IMPORTANT: do this last to prevent race conditions
      setCamera1Stream(stream);
      setIsCamera1Active(true);
      setError(null);

      console.log('✅ Camera 1 state updated: ACTIVE');
    } catch (err) {
      const errorMsg = 'Failed to start Camera 1: ' + (err as Error).message;
      console.error('❌', errorMsg, err);

      if ((err as Error).name === 'NotReadableError') {
        setError('Camera 1 is already in use by another application or browser tab. Close other apps and try again.');
      } else if ((err as Error).name === 'NotFoundError') {
        setError('Camera 1 not found. It may have been unplugged.');
      } else {
        setError(errorMsg);
      }

      setIsCamera1Active(false);
      setCamera1Stream(null);
    }
  }, [camera1Stream, camera1Ref]);

  // Start camera 2
  const startCamera2 = useCallback(async (deviceId: string) => {
    try {
      console.log('🎬 Starting Camera 2 with deviceId:', deviceId);

      // Stop existing stream if any
      if (camera2Stream) {
        console.log('⏹️ Stopping existing Camera 2 stream');
        camera2Stream.getTracks().forEach((track) => track.stop());
        // Wait for camera to be fully released
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      };

      console.log('📹 Requesting Camera 2 stream with constraints:', constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      const videoTrack = stream.getVideoTracks()[0];
      console.log('✅ Camera 2 started:', videoTrack.label);
      console.log('   Settings:', videoTrack.getSettings());

      // Set video element srcObject
      if (camera2Ref.current) {
        camera2Ref.current.srcObject = stream;
      }

      // Update state - IMPORTANT: do this last to prevent race conditions
      setCamera2Stream(stream);
      setIsCamera2Active(true);
      setError(null);

      console.log('✅ Camera 2 state updated: ACTIVE');
    } catch (err) {
      const errorMsg = 'Failed to start Camera 2: ' + (err as Error).message;
      console.error('❌', errorMsg, err);

      if ((err as Error).name === 'NotReadableError') {
        setError('Camera 2 is already in use by another application or browser tab. Close other apps and try again.');
      } else if ((err as Error).name === 'NotFoundError') {
        setError('Camera 2 not found. It may have been unplugged.');
      } else {
        setError(errorMsg);
      }

      setIsCamera2Active(false);
      setCamera2Stream(null);
    }
  }, [camera2Stream, camera2Ref]);

  // Stop camera 1
  const stopCamera1 = useCallback(() => {
    console.log('⏹️ Stopping Camera 1');
    if (camera1Stream) {
      camera1Stream.getTracks().forEach((track) => {
        console.log('  Stopping track:', track.label);
        track.stop();
      });
      setCamera1Stream(null);
      setIsCamera1Active(false);
      console.log('✅ Camera 1 stopped and state updated: INACTIVE');
    } else {
      console.log('  Camera 1 stream already null');
    }
  }, [camera1Stream]);

  // Stop camera 2
  const stopCamera2 = useCallback(() => {
    console.log('⏹️ Stopping Camera 2');
    if (camera2Stream) {
      camera2Stream.getTracks().forEach((track) => {
        console.log('  Stopping track:', track.label);
        track.stop();
      });
      setCamera2Stream(null);
      setIsCamera2Active(false);
      console.log('✅ Camera 2 stopped and state updated: INACTIVE');
    } else {
      console.log('  Camera 2 stream already null');
    }
  }, [camera2Stream]);

  // Debug logging for state changes
  useEffect(() => {
    console.log('📊 Camera states:', {
      camera1Active: isCamera1Active,
      camera2Active: isCamera2Active,
      camera1HasStream: !!camera1Stream,
      camera2HasStream: !!camera2Stream,
    });
  }, [isCamera1Active, isCamera2Active, camera1Stream, camera2Stream]);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      // Clean up streams on unmount
      console.log('🧹 Cleaning up camera streams on unmount');
      if (camera1Stream) {
        camera1Stream.getTracks().forEach((track) => track.stop());
      }
      if (camera2Stream) {
        camera2Stream.getTracks().forEach((track) => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run on mount/unmount

  return {
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
    error,
  };
}
