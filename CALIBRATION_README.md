# Camera Calibration System

Complete stereo camera calibration implementation for computing intrinsic and extrinsic camera parameters.

## What It Does

The calibration system computes all parameters needed for DLT triangulation and 3D reconstruction:

### Intrinsic Parameters (per camera):
- **K (Camera Matrix)**: 3x3 matrix with focal lengths and optical center
- **dist (Distortion Coefficients)**: [k1, k2, p1, p2, k3] for lens distortion correction

### Extrinsic Parameters (between cameras):
- **R (Rotation Matrix)**: 3x3 rotation from camera 1 to camera 2
- **T (Translation Vector)**: 3D translation from camera 1 to camera 2
- **E (Essential Matrix)**: Encodes rotation and translation
- **F (Fundamental Matrix)**: Epipolar geometry

### Projection Matrices:
- **P1, P2**: Used directly for DLT triangulation to compute 3D points

## How To Use

### 1. Prepare Checkerboard Pattern

Print or display a checkerboard pattern:
- Download: https://raw.githubusercontent.com/opencv/opencv/master/doc/pattern.png
- Standard pattern: 9x6 squares (8x5 inner corners)
- Measure square size in millimeters (typically 20-30mm)

### 2. Configure Settings

In the Calibration tab, set:
- **Inner Rows**: Number of corner rows (not square rows)
- **Inner Columns**: Number of corner columns (not square columns)
- **Square Size**: Physical size of each square in millimeters

Example: A 9x6 checkerboard has 8x5 inner corners.

### 3. Capture Calibration Images

1. Start both cameras in the "Camera Setup" tab
2. Switch to "Calibration" tab
3. Position checkerboard so both cameras can see it clearly
4. Click "Capture Frame"
5. Move checkerboard to different:
   - Angles (tilted, rotated)
   - Distances (close, far)
   - Positions (left, right, center, up, down)
6. Capture 15-20 images with ✅ green checkmark (corners detected in both cameras)

**Tips:**
- Keep checkerboard flat and well-lit
- Avoid motion blur - hold steady when capturing
- Cover different areas of the camera frame
- Vary the angle significantly between captures

### 4. Run Calibration

1. Ensure you have at least 10 valid captures (green checkmarks)
2. Click "Calibrate Cameras"
3. Wait for processing (takes 10-30 seconds)
4. Review results:
   - **Reprojection Error**: Should be < 1.0 pixels (lower is better)
   - **Camera Matrices (K1, K2)**: Check focal lengths are reasonable
   - **Translation (T)**: Should match physical camera spacing

### 5. Save Calibration

Click "Save Calibration" to export JSON file containing all parameters.

## Quality Metrics

### Reprojection Error
- **< 0.5 pixels**: Excellent calibration
- **0.5 - 1.0 pixels**: Good calibration
- **1.0 - 2.0 pixels**: Acceptable for most uses
- **> 2.0 pixels**: Poor - recapture with better checkerboard visibility

### What Affects Quality
- **Number of captures**: More is better (15-20 recommended)
- **Variety of poses**: Cover different angles and distances
- **Checkerboard detection**: All corners must be detected clearly
- **Image quality**: Good lighting, sharp focus, no motion blur
- **Checkerboard flatness**: Warped boards reduce accuracy

## Using Calibration Results

The calibration parameters are used in the 3D Reconstruction tab:

1. **Undistort images**: Use K and distortion coefficients
2. **DLT Triangulation**: Use P1 and P2 projection matrices
3. **Epipolar constraints**: Use F matrix to validate point correspondences
4. **Rectification**: Use R and T to align camera coordinate systems

## Troubleshooting

### "No corners detected"
- Ensure checkerboard is clearly visible in both cameras
- Check lighting - avoid glare or shadows
- Verify checkerboard configuration matches actual pattern
- Make sure checkerboard is in focus

### "Need at least 10 valid captures"
- Capture more images until you have 10+ with green checkmarks
- Try different angles and positions
- Ensure both cameras can see the full checkerboard

### High reprojection error
- Recapture with more varied poses
- Check checkerboard is flat (not warped)
- Ensure camera hasn't moved between captures
- Verify square size measurement is accurate

### OpenCV.js loading issues
- Check internet connection (loads from CDN)
- Try refreshing the page
- Check browser console for errors

## Technical Details

### OpenCV.js Integration
- Loads OpenCV.js from official CDN
- Uses `findChessboardCorners` for corner detection
- Uses `cornerSubPix` for sub-pixel accuracy
- Future: Full stereo calibration with `stereoCalibrate`

### Current Implementation
- ✅ Checkerboard corner detection
- ✅ Image capture from both cameras
- ✅ Capture management (add/remove/clear)
- ✅ Save/load calibration files
- ⚠️ Mock calibration results (OpenCV calibration algorithm coming soon)

### Next Steps
1. Implement full OpenCV stereo calibration algorithm
2. Add image undistortion preview
3. Add reprojection visualization
4. Support multiple calibration profiles
5. Auto-detect checkerboard size
