# Motion Capture Lab

A web-based motion capture application powered by MediaPipe Pose Landmarker. Capture, analyze, and export human body movement data with real-time pose detection and comprehensive quality metrics.

## Features

### Real-Time Motion Capture
- **Live pose tracking** with MediaPipe's 33-landmark system
- **Mirror mode view** for natural movement feedback
- **Visual skeleton overlay** showing all tracked body points
- **High frame rate capture** (typically 30-60 FPS)

### Recording & Playback
- **Record motion sequences** with timestamped frame data
- **Playback controls** (play, pause, scrub, speed control)
- **Local storage** in browser memory
- **Cloud storage** with Supabase integration (optional)

### Data Analysis
- **Quality Score (0-100)** - Overall tracking quality assessment
- **Joint Jitter Analysis** - Smoothness and stability metrics
- **Occlusion Detection** - Visibility scores per landmark
- **Limb Swap Detection** - Tracking error identification
- **Depth Ambiguity** - Z-coordinate consistency analysis

### Data Export
- **JSON format** - Complete frame-by-frame data with all landmarks
- **CSV export** - Compatible with animation software
- **MediaPipe confidence scores** - Visibility data for each landmark

## Getting Started

### Local Development

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Start dev server:**
   ```bash
   pnpm dev
   ```

3. **Open in browser:**
   - Navigate to the provided localhost URL
   - Allow camera permissions when prompted

### Supabase Cloud Storage (Optional)

To enable cloud storage for your recordings:

1. **Create a Supabase project** at https://supabase.com

2. **Add environment variables** in `.env`:
   ```env
   VITE_SUPABASE_URL=your-project-url
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

3. **Run the database schema** from `supabase_schema.sql` in your Supabase SQL Editor

4. **Restart the app** to enable cloud features

See `SUPABASE_SETUP.md` for detailed instructions.

## How It Works

### MediaPipe Pose Landmarker
- Detects 17 body landmarks in real-time
- Provides x, y, z coordinates (normalized 0-1 for x/y, relative depth for z)
- Includes visibility confidence scores (0-1) per landmark

### Motion Quality Metrics

**Jitter Analysis:**
- Measures frame-to-frame velocity variance
- Detects high-frequency noise and rapid direction changes
- Smoothness score (0-100, higher is better)

**Occlusion Detection:**
- Tracks MediaPipe's visibility scores
- Identifies frames where landmarks are hidden
- Timeline visualization of occlusion events

**Limb Swap Detection:**
- Validates anatomical constraints (left/right positioning)
- Detects when tracking confuses body sides
- Flags problematic frames

**Depth Consistency:**
- Analyzes z-coordinate relationships
- Validates expected depth ordering (e.g., elbow in front of shoulder)
- Identifies depth tracking inconsistencies

## Use Cases

- **Motion research** - Capture data for human movement studies
- **Animation reference** - Export motion data for 3D animation
- **Tracking quality analysis** - Evaluate MediaPipe performance
- **Biomechanics** - Analyze movement patterns and joint positions
- **AR/VR development** - Test pose tracking for interactive applications

## Technology Stack

- **React + TypeScript** - UI framework
- **MediaPipe Pose Landmarker** - ML-based pose detection
- **Tailwind CSS** - Styling
- **Recharts** - Data visualization
- **Supabase** - Cloud storage (optional)
- **Motion/Framer Motion** - Animations

## Performance Optimizations (Stereo 3D Lab)

### Recording State Batching
The 3D stereo pipeline uses optimized recording that avoids excessive React state updates:

**useDualMediaPipePose.ts:**
- Recording buffer moved to `useRef` (`recordedDataRef`) instead of React state
- All landmark rows for one stereo frame batched into a single append operation
- State updates reduced from ~26 per stereo frame (one per landmark × 2 cameras) to ~2 (one per camera for UI)
- Result: Eliminates growing memory allocations and full buffer copies on every frame

**useMotionRecorder.ts:**
- Frames buffer in `useRef`; only lightweight UI state (`currentFrameCount`, `currentDuration`)
- Replaces per-frame full array copies with single counter updates
- Result: Significantly reduced React reconciliation overhead in the hot path

### Impact
These changes move the performance bottleneck from recording logic to **MediaPipe inference and stereo triangulation**, where it belongs. The 3D lab now processes frames at rates closer to the 2D lab.

### Backward Compatibility
- Both hooks maintain the same API signatures
- `recordedData` still exposed (returns `ref.current`)
- Existing components require no changes

## Data Format

Recordings are stored as JSON with this structure:

```json
{
  "id": "recording_1234567890",
  "name": "Motion_2024-01-15",
  "startTime": 1234567890000,
  "duration": 5000,
  "frameRate": 30.5,
  "frames": [
    {
      "timestamp": 0,
      "frameNumber": 0,
      "landmarks": {
        "nose": { "x": 0.5, "y": 0.3, "z": -0.1, "visibility": 0.98 },
        "leftShoulder": { "x": 0.4, "y": 0.5, "z": -0.2, "visibility": 0.95 },
        ...
      }
    }
  ],
  "metadata": {
    "notes": "Optional recording notes",
    "deviceInfo": "Browser user agent"
  }
}
```

## Troubleshooting

### Camera Access Issues
- Check browser permissions (click lock icon in address bar)
- Ensure no other apps are using the camera
- Try a different browser (Chrome recommended)
- See `CAMERA_TROUBLESHOOTING.md` for detailed help

### Low Frame Rates
- Close other browser tabs and applications
- Ensure good lighting (helps MediaPipe tracking)
- Try reducing video resolution

### Tracking Quality
- Good lighting improves visibility scores
- Full body in frame reduces occlusion
- Avoid rapid movements for lower jitter
- Face camera directly for better depth accuracy

## Documentation

- `MOTION_CAPTURE_GUIDE.md` - Detailed capture workflow
- `SUPABASE_SETUP.md` - Cloud storage configuration
- `LOCAL_SETUP_GUIDE.md` - Development setup
- `CAMERA_TROUBLESHOOTING.md` - Camera issues and solutions

## License

See LICENSE file for details.

## Acknowledgments

- **MediaPipe** by Google - Pose detection model
- **Supabase** - Cloud database infrastructure
- See `Attributions.md` for complete credits
