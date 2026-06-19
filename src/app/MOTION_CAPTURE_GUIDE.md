# Motion Capture Lab - User Guide

## Overview

The Motion Capture Lab is a research tool built into the AR Fitness Form Trainer that allows you to record, analyze, and export MediaPipe pose landmark data for motion research and animation purposes.

## Features

### 1. **Real-Time Motion Recording**
- Records all MediaPipe pose landmarks at camera frame rate
- Timestamps each frame for accurate temporal analysis
- Displays live FPS and frame count during recording
- Visual feedback with stick figure overlay

### 2. **Playback & Review**
- Frame-by-frame playback of recorded motions
- Variable speed playback with timeline scrubbing
- Visual stick figure replay

### 3. **Data Analysis & Visualization**
- Joint-specific position tracking over time
- 3D trajectory visualization (XY and XZ planes)
- Movement statistics (displacement, speed, acceleration)
- Coordinate range analysis

### 4. **Export Capabilities**
- Export individual recordings as JSON
- Batch export all recordings
- Industry-standard data format for animation tools

## How to Use

### Starting a Recording

1. Click "Motion Capture Lab" from the home screen
2. Allow camera access when prompted
3. Position yourself in frame
4. (Optional) Add a recording name and notes
5. Click "Start Recording"
6. Perform your movement
7. Click "Stop Recording" when finished

### Viewing Recordings

1. Click "View" on any recording to see playback
2. Use play/pause controls
3. Scrub through the timeline for specific frames
4. Close playback to return to the list

### Analyzing Data

1. Click "Analyze" on any recording
2. Select a joint from the dropdown menu
3. View position graphs, trajectories, and statistics
4. Switch between different visualization tabs:
   - **Position Over Time**: X, Y, Z coordinates plotted separately
   - **3D Trajectory**: Movement paths in 2D plane projections
   - **Statistics**: Movement metrics and ranges
   - **Raw Data**: Complete JSON data structure

### Exporting Data

**Single Recording:**
1. Click "Export" on a recording
2. JSON file downloads automatically
3. File name format: `RecordingName_timestamp.json`

**All Recordings:**
1. Click "Export All" in the header
2. All recordings export as a single JSON array
3. File name format: `motion_capture_sessions_timestamp.json`

## Data Format

### JSON Structure

```json
{
  "id": "recording_1234567890",
  "name": "Motion_1/20/2026, 3:45:12 PM",
  "startTime": 1234567890000,
  "duration": 5432,
  "frameRate": 29.8,
  "metadata": {
    "notes": "Walking forward 3 steps",
    "deviceInfo": "Mozilla/5.0..."
  },
  "frames": [
    {
      "timestamp": 0,
      "frameNumber": 0,
      "landmarks": {
        "nose": { "x": 0.512, "y": 0.234, "z": -0.045 },
        "leftEye": { "x": 0.498, "y": 0.218, "z": -0.051 },
        "rightEye": { "x": 0.526, "y": 0.216, "z": -0.049 },
        ...
      }
    },
    ...
  ]
}
```

### Landmark Coordinates

All coordinates are normalized:

- **x**: Horizontal position (0.0 = left edge, 1.0 = right edge)
- **y**: Vertical position (0.0 = top edge, 1.0 = bottom edge)
- **z**: Depth/distance from camera (relative to hip midpoint, negative = closer to camera)

### Available Landmarks (17 total)

- `nose`
- `leftEye`, `rightEye`
- `leftEar`, `rightEar`
- `leftShoulder`, `rightShoulder`
- `leftElbow`, `rightElbow`
- `leftWrist`, `rightWrist`
- `leftHip`, `rightHip`
- `leftKnee`, `rightKnee`
- `leftAnkle`, `rightAnkle`

## Using Exported Data in Animation Software

### Unity (C#)

```csharp
[System.Serializable]
public class Landmark {
    public float x, y, z;
}

[System.Serializable]
public class Frame {
    public int timestamp;
    public int frameNumber;
    public Dictionary<string, Landmark> landmarks;
}

// Load JSON
string jsonData = File.ReadAllText("recording.json");
Recording recording = JsonUtility.FromJson<Recording>(jsonData);

// Animate skeleton
foreach (Frame frame in recording.frames) {
    // Map landmarks to skeleton bones
    SetBonePosition("Head", frame.landmarks["nose"]);
    SetBonePosition("LeftHand", frame.landmarks["leftWrist"]);
    // ... etc
}
```

### Blender (Python)

```python
import json
import bpy

# Load JSON
with open('recording.json', 'r') as f:
    recording = json.load(f)

# Create animation
for frame_data in recording['frames']:
    frame_num = frame_data['frameNumber']
    landmarks = frame_data['landmarks']
    
    # Set keyframe for each bone
    bpy.context.scene.frame_set(frame_num)
    armature = bpy.data.objects['Armature']
    
    # Example: Move head bone
    head_bone = armature.pose.bones['Head']
    head_bone.location = (
        landmarks['nose']['x'],
        landmarks['nose']['y'],
        landmarks['nose']['z']
    )
    head_bone.keyframe_insert(data_path="location", frame=frame_num)
```

### Three.js (JavaScript)

```javascript
// Load JSON
fetch('recording.json')
  .then(response => response.json())
  .then(recording => {
    const frames = recording.frames;
    let currentFrame = 0;
    
    function animate() {
      if (currentFrame < frames.length) {
        const frame = frames[currentFrame];
        
        // Update skeleton bones
        skeleton.bones.head.position.set(
          frame.landmarks.nose.x,
          frame.landmarks.nose.y,
          frame.landmarks.nose.z
        );
        
        // ... update other bones
        
        currentFrame++;
      }
      requestAnimationFrame(animate);
    }
    
    animate();
  });
```

## Tips for Best Results

### Recording Quality
- **Lighting**: Ensure even, bright lighting without harsh shadows
- **Background**: Plain, contrasting backgrounds work best
- **Distance**: Stand 6-8 feet from camera for full body capture
- **Framing**: Keep entire body visible throughout the motion
- **Movements**: Perform smooth, deliberate movements for cleaner data

### Data Processing
- **Frame Rate**: Higher FPS = smoother motion but larger files
- **Duration**: Keep recordings focused (5-15 seconds ideal)
- **Filtering**: Consider applying smoothing filters in post-processing for animation
- **Normalization**: Remember coordinates are normalized - scale appropriately for your use case

### Research Applications
- Biomechanics analysis
- Gait analysis
- Exercise form studies
- Gesture recognition training data
- Animation reference
- Motion pattern classification

## Technical Details

### MediaPipe Model
- Uses MediaPipe Pose Landmarker (lite model)
- 33 total landmarks (this tool exposes 17 key points)
- GPU-accelerated detection
- Optimized for real-time performance

### Performance
- Target: 30 FPS on modern devices
- Actual FPS varies by device capabilities
- WebGL acceleration required for optimal performance

### Browser Compatibility
- Chrome/Edge: Full support (recommended)
- Firefox: Full support
- Safari: Limited MediaPipe support
- Mobile: iOS 14+, Android 8+

## Frequently Asked Questions

**Q: Why are coordinates between 0 and 1?**  
A: MediaPipe outputs normalized coordinates independent of video resolution. Multiply by your canvas/scene dimensions to get pixel/unit coordinates.

**Q: What does negative Z mean?**  
A: Negative Z indicates the point is closer to the camera than the reference plane (hip midpoint).

**Q: Can I record multiple people?**  
A: Currently limited to single-person tracking (primary detected pose).

**Q: How accurate is the depth (Z) data?**  
A: Z-values are estimated from monocular video, less accurate than X/Y. Use primarily for relative depth comparisons.

**Q: Can I import external motion data?**  
A: Currently export-only. Future versions may support import for playback.

## Support & Feedback

This tool is part of a research prototype. For questions or to share your research applications, please refer to the main project documentation.

---

**Version:** 1.0  
**Last Updated:** January 20, 2026  
**MediaPipe Version:** Pose Landmarker Lite (Float16)
