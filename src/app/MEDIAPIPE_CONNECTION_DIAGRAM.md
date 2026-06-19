# MediaPipe to Overlay Connection Flow

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         LiveExerciseView.tsx                        │
│                         (Main Component)                            │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                ┌───────────────────┴───────────────────┐
                │                                       │
                ▼                                       ▼
    ┌──────────────────────┐              ┌─────────────────────────┐
    │   CameraFeed.tsx     │              │  useMediaPipePose Hook  │
    │   (Video Element)    │──────────────│  (ML Processing)        │
    └──────────────────────┘              └─────────────────────────┘
                                                      │
                                                      │ Callback:
                                                      │ onPoseDetected()
                                                      │
                                                      ▼
                                          ┌─────────────────────┐
                                          │  PoseLandmarks      │
                                          │  (33 body points)   │
                                          │  {nose, shoulders,  │
                                          │   elbows, hips...}  │
                                          └─────────────────────┘
                                                      │
                        ┌─────────────────────────────┼─────────────────────────────┐
                        │                             │                             │
                        ▼                             ▼                             ▼
            ┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
            │ LivePoseOverlay.tsx  │    │  poseComparison.ts   │    │  State Management    │
            │ (Visual Skeleton)    │    │  (Form Analysis)     │    │  (detectedLandmarks) │
            └──────────────────────┘    └──────────────────────┘    └──────────────────────┘
                        │                             │
                        │ Draws skeleton              │ Returns:
                        │ at exact positions          │ - Form issues
                        │                             │ - Joint angles
                        │                             │ - Pose match scores
                        ▼                             ▼
            ┌──────────────────────┐    ┌──────────────────────┐
            │  SVG on screen       │    │  Audio Feedback      │
            │  (Colored joints)    │    │  Text Feedback       │
            └──────────────────────┘    └──────────────────────┘
```

## Detailed Data Flow

### 1. **MediaPipe Hook Initialization** (`useMediaPipePose.ts`)

```typescript
// Lines 48-62: Load MediaPipe model
const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: 'pose_landmarker_lite.task',
    delegate: 'GPU', // ← Real-time GPU processing
  },
  runningMode: 'VIDEO',
  numPoses: 1,
  minPoseDetectionConfidence: 0.5,
});
```

### 2. **Real-time Detection Loop** (60 FPS)

```typescript
// Lines 125-219: Runs continuously
const detectPose = async () => {
  // Get video frame
  const results = poseLandmarker.detectForVideo(video, startTimeMs);
  
  // Extract 33 landmarks from MediaPipe
  if (results.landmarks && results.landmarks.length > 0) {
    const landmarks = results.landmarks[0];
    
    // Map to our format (17 key points)
    const poseLandmarks: PoseLandmarks = {
      nose: landmarks[0],           // MediaPipe index 0
      leftShoulder: landmarks[11],  // MediaPipe index 11
      rightShoulder: landmarks[12], // MediaPipe index 12
      leftElbow: landmarks[13],     // MediaPipe index 13
      // ... etc for all 17 points
    };
    
    // ✅ CALLBACK TO PARENT COMPONENT
    options.onPoseDetected?.(poseLandmarks);
  }
  
  // Loop at 60 FPS
  requestAnimationFrame(detectPose);
};
```

### 3. **LiveExerciseView Receives Landmarks** (`LiveExerciseView.tsx`)

```typescript
// Lines 298-304: Hook setup
const { isReady, startDetection, stopDetection } = useMediaPipePose(
  { current: cameraFeedRef.current?.videoElement || null },
  canvasRef,
  {
    onPoseDetected: (landmarks) => {
      setDetectedLandmarks(landmarks);        // ← State update
      detectedLandmarksRef.current = landmarks; // ← Ref for analysis
    },
    enableDrawing: false,
  }
);
```

### 4. **Data Flows to Two Destinations**

#### A. **Visual Overlay** (`LivePoseOverlay.tsx`)

```typescript
// Lines 824-833: Pass landmarks to overlay
<LivePoseOverlay
  landmarks={detectedLandmarks}  // ← Received from MediaPipe
  videoWidth={cameraFeedRef.current.videoElement.videoWidth}
  videoHeight={cameraFeedRef.current.videoElement.videoHeight}
  videoElement={cameraFeedRef.current.videoElement}
  formIssues={formIssues}
  exerciseType={exerciseId}
/>
```

**LivePoseOverlay converts coordinates and draws skeleton:**

```typescript
// Lines 54-60: Convert normalized (0-1) to screen pixels
const toScreenCoords = (point: { x: number; y: number }) => {
  return {
    x: point.x * displayWidth + offsetX,
    y: point.y * displayHeight + offsetY,
  };
};

// Lines 63-75: Get all joint positions
const nose = toScreenCoords(landmarks.nose);
const leftShoulder = toScreenCoords(landmarks.leftShoulder);
const rightShoulder = toScreenCoords(landmarks.rightShoulder);
// ... all 17 points

// Lines 200+: Draw SVG skeleton with colored joints
<svg className="absolute inset-0 pointer-events-none">
  {/* Draw connections (bones) */}
  <line x1={leftShoulder.x} y1={leftShoulder.y} 
        x2={leftElbow.x} y2={leftElbow.y} 
        stroke={formIssues.elbowsTooWide ? 'red' : 'lime'} />
  
  {/* Draw joints (circles) */}
  <circle cx={leftShoulder.x} cy={leftShoulder.y} r={8} 
          fill={formIssues.shouldersNotLevel ? 'red' : 'lime'} />
</svg>
```

#### B. **Form Analysis** (`poseComparison.ts`)

```typescript
// Lines 348-460: Runs every 1 second
const analysisInterval = setInterval(() => {
  const currentLandmarks = detectedLandmarksRef.current;
  
  // Compare against baseline poses
  const score = comparePose(currentLandmarks, 'squat-down-side');
  // Returns: 0-100 match score
  
  // Detect form issues
  const issues = detectFormIssues(currentLandmarks, exerciseId);
  // Returns: { kneeAngleTooShallow: true, ... }
  
  // Extract joint angles
  const angles = extractAngles(currentLandmarks, exerciseId);
  // Returns: { kneeAngle: 87, elbowAngle: 92, ... }
  
}, 1000);
```

## Key Technical Details

### MediaPipe Landmark Format
```typescript
// Each landmark has:
{
  x: 0.5,      // Normalized X (0-1, left to right)
  y: 0.3,      // Normalized Y (0-1, top to bottom)
  z: -0.2,     // Depth (negative = closer to camera)
  visibility: 0.99 // Confidence score (0-1)
}
```

### Coordinate Conversion
```
MediaPipe Output (normalized):  { x: 0.5, y: 0.3 }
                    ↓
Video Dimensions:   1280px × 720px
                    ↓
Screen Coordinates: { x: 640px, y: 216px }
                    ↓
Displayed on SVG:   <circle cx="640" cy="216" />
```

### Performance Optimization

1. **60 FPS Detection** - MediaPipe runs continuously at camera frame rate
2. **1 Second Analysis** - Form checking happens every 1 second (not every frame)
3. **Refs for Latest Data** - `detectedLandmarksRef` prevents useEffect dependency issues
4. **GPU Acceleration** - MediaPipe uses WebGL for fast processing

### Form Feedback Pipeline

```
MediaPipe Landmarks
        ↓
Calculate Joint Angles (using 3D trigonometry)
        ↓
Compare to Scientific Baselines
        ↓
Detect Form Issues
        ↓
        ├─→ Visual: Color joints red/green
        ├─→ Audio: "Keep your core tight!"
        └─→ Stats: Track form score over time
```

## Files Involved

1. **`/hooks/useMediaPipePose.ts`** - MediaPipe integration & landmark extraction
2. **`/components/LiveExerciseView.tsx`** - Main orchestrator, receives landmarks
3. **`/components/LivePoseOverlay.tsx`** - Visual skeleton overlay renderer
4. **`/utils/poseComparison.ts`** - Biomechanical analysis & pose matching
5. **`/components/CameraFeed.tsx`** - Video element source

## Summary

**MediaPipe provides the "eyes"** → Detects 33 body points at 60 FPS  
**useMediaPipePose processes the data** → Maps to 17 key joints, calls callback  
**LiveExerciseView coordinates** → Manages state, triggers analysis  
**LivePoseOverlay visualizes** → Draws real-time skeleton on screen  
**poseComparison analyzes** → Calculates angles, detects form issues  

The overlay is **perfectly synchronized** because it receives the exact same landmark data that MediaPipe detects, transformed into screen coordinates and rendered as SVG.
