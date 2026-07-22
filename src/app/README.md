# Motion Capture Lab

A web-based 2D and 3D motion capture application powered by MediaPipe Pose Landmarker and stereo computer vision. Capture real-world millimeter-accurate 3D joint positions in real time using two ordinary webcams — no specialized hardware required.

---

## Table of Contents

1. [Features](#features)
2. [Getting Started](#getting-started)
3. [3D Stereo Pipeline — Full Technical Breakdown](#3d-stereo-pipeline)
   - [Camera Calibration](#camera-calibration)
   - [Stereo Calibration](#stereo-calibration)
   - [Stereo Rectification](#stereo-rectification)
   - [Pose Detection with MediaPipe](#pose-detection-with-mediapipe)
   - [DLT Triangulation](#dlt-triangulation)
4. [2D Motion Capture](#2d-motion-capture)
5. [Motion Quality Analysis](#motion-quality-analysis)
   - [The Normalisation Problem](#the-normalisation-problem)
   - [Body-Scale Normalisation](#body-scale-normalisation)
   - [Full Math Reference](#full-math-reference)
   - [Metrics Reference](#metrics-reference)
6. [Data Format](#data-format)
7. [Technology Stack](#technology-stack)
8. [Troubleshooting](#troubleshooting)

---

## Features

### 2D Motion Capture (single camera)
- Real-time pose tracking with MediaPipe's 33-landmark model
- Mirror mode view for natural movement feedback
- Visual skeleton overlay
- Record, play back, and export motion sequences (JSON / CSV)
- Quality metrics: jitter, occlusion, limb swap detection, depth consistency

### 3D Motion Capture (stereo)
- Real-world X/Y/Z coordinates in millimeters from two ordinary webcams
- Full stereo calibration pipeline: checkerboard → OpenCV → projection matrices
- DLT triangulation implemented from scratch in TypeScript — no server required
- Live wrist tracking with sub-centimeter accuracy when well calibrated

---

## Getting Started

### Requirements
- Node.js 18+ and pnpm
- Python 3.8+ with `opencv-python` and `numpy` (for the one-time calibration step)
- Two USB webcams (for 3D mode)
- A printed checkerboard (default: 5×8 squares, inner corners 4×7, 25mm square size)

### Installation

1. **Clone the repo:**
   ```bash
   git clone https://github.com/your-username/motion-capture-lab.git
   cd motion-capture-lab
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Download OpenCV.js** (required for in-browser calibration — not bundled due to file size):
   ```bash
   curl -o public/opencv.js https://docs.opencv.org/4.10.0/opencv.js
   ```
   Or download manually from https://docs.opencv.org/4.10.0/opencv.js and place at `public/opencv.js`.

4. **Start the dev server:**
   ```bash
   pnpm dev
   ```

5. **Open in browser** and allow camera permissions when prompted.

### Python calibration dependencies
```bash
pip install opencv-python numpy
```

---

## 3D Stereo Pipeline

This is the core technical contribution of the project. The pipeline takes two ordinary webcam feeds and produces real-world 3D joint positions in millimeters, updated every frame in real time in the browser. Here is every step in detail.

---

### Camera Calibration

**Goal:** determine each camera's intrinsic parameters — focal length, optical center, and lens distortion — so we can map between pixel coordinates and physical rays in 3D space.

#### The Pinhole Camera Model

A pinhole camera projects a 3D world point **X** = (X, Y, Z) onto a 2D image point **x** = (u, v) via:

```
λ [u]   [fx  0  cx] [r11 r12 r13 | t1] [X]
  [v] = [0  fy  cy] [r21 r22 r23 | t2] [Y]
  [1]   [0   0   1] [r31 r32 r33 | t3] [Z]
                                        [1]
```

Or compactly: `λx = K [R | t] X`

Where:
- **K** is the 3×3 intrinsic matrix
  - `fx`, `fy` — focal lengths in pixels
  - `cx`, `cy` — principal point (optical center) in pixels
- **[R | t]** is the 3×4 extrinsic matrix (camera pose in world space)
- **λ** is a scale factor (the depth)

#### Lens Distortion

Real lenses distort the image. We model this with radial and tangential distortion coefficients **[k1, k2, p1, p2, k3]**:

```
x' = x(1 + k1*r² + k2*r⁴ + k3*r⁶) + 2*p1*x*y + p2*(r² + 2x²)
y' = y(1 + k1*r² + k2*r⁴ + k3*r⁶) + p1*(r² + 2y²) + 2*p2*x*y
```

where `r² = x² + y²` and (x, y) are normalized image coordinates.

#### Checkerboard Calibration

We use a printed checkerboard as a calibration target because:
- Its inner corner positions are known exactly in 3D (Z=0 plane, spacing = square size in mm)
- OpenCV's `findChessboardCorners` + `cornerSubPix` detects them to sub-pixel accuracy

For each captured image we get N correspondences: `{(Xi, Yi, 0) ↔ (ui, vi)}`.

`cv2.calibrateCamera` solves for K and distortion by minimizing the **reprojection error** over all images and all corners:

```
E = Σᵢ Σⱼ || xᵢⱼ - proj(K, dist, Rᵢ, tᵢ, Xⱼ) ||²
```

This is a nonlinear least-squares problem solved with Levenberg-Marquardt. A good calibration achieves < 0.5 px reprojection error.

**In our pipeline:**
- `calibrate_stereo.py` runs `cv2.calibrateCamera` independently for Camera 1 and Camera 2
- Typical results: 0.21–0.43 px reprojection error per camera
- The in-browser path uses OpenCV.js (`findChessboardCorners`, `calibrateCamera`) for the same computation

---

### Stereo Calibration

**Goal:** find the rigid body transformation (rotation **R** and translation **T**) that describes where Camera 2 is relative to Camera 1.

#### The Stereo Model

Given Camera 1 at the origin and Camera 2 at rotation **R**, translation **T**:

```
X₂ = R·X₁ + T
```

A world point seen by Camera 1 at position X₁ is seen by Camera 2 at X₂.

#### The Fundamental Matrix

The epipolar constraint states that for any point **x₁** in Camera 1 and its corresponding point **x₂** in Camera 2:

```
x₂ᵀ F x₁ = 0
```

**F** (the 3×3 fundamental matrix) encodes the complete stereo geometry. Given F, for any point in Camera 1, the corresponding point in Camera 2 must lie on a specific line (the epipolar line).

#### The Essential Matrix

The essential matrix **E** is the calibrated version of F:

```
E = K₂ᵀ F K₁
```

It satisfies `x₂'ᵀ E x₁' = 0` in normalized (undistorted) coordinates, and can be decomposed into R and T:

```
E = [T]× R
```

where `[T]×` is the skew-symmetric cross-product matrix of T.

#### `cv2.stereoCalibrate`

We use `CALIB_USE_INTRINSIC_GUESS` which starts from the individually calibrated K1, K2, dist1, dist2 and jointly optimizes all parameters together — including re-refining the intrinsics — to minimize the stereo reprojection error:

```
E = Σᵢ Σⱼ ( ||x₁ᵢⱼ - proj(K₁,dist₁,Rᵢ,tᵢ,Xⱼ)||² + ||x₂ᵢⱼ - proj(K₂,dist₂,R·Rᵢ,R·tᵢ+T,Xⱼ)||² )
```

**Key insight from our debugging:** the two cameras had different resolutions. The original script used Camera 1's image dimensions for Camera 2's `calibrateCamera` call, which corrupted Camera 2's K matrix. Fixing this dropped the stereo error from ~34 px to **0.77 px**.

A stereo error under 1.0 px means the fundamental matrix describes the camera relationship accurately enough for reliable triangulation.

---

### Stereo Rectification

**Goal:** compute projection matrices **P1** and **P2** that transform both cameras into a canonical rectified coordinate system, where corresponding points lie on the same horizontal scanline.

#### `cv2.stereoRectify`

Given K1, dist1, K2, dist2, R, T, this function computes:

- **R1, R2** — rotation matrices that rectify each camera
- **P1, P2** — 3×4 projection matrices in the rectified coordinate system
- **Q** — 4×4 disparity-to-depth mapping matrix

The projection matrices have the form:

```
P1 = [f  0  cx1  0  ]      P2 = [f  0  cx2  -f·Tx]
     [0  f  cy   0  ]           [0  f  cy    0   ]
     [0  0  1    0  ]           [0  0  1     0   ]
```

where `Tx` is the horizontal baseline (the X component of T) and `f` is the common rectified focal length.

**P1 and P2 are the only outputs the web app uses for real-time triangulation.** They encode the complete stereo geometry in a form that enables direct linear triangulation.

---

### Pose Detection with MediaPipe

**Goal:** detect 2D pixel coordinates of body joints in each camera frame in real time.

MediaPipe Pose Landmarker runs a two-stage neural network pipeline:

1. **BlazePose Detector** — a lightweight detector that finds the person bounding box
2. **Pose Landmark Model** — a regression network that predicts 33 body landmarks within the bounding box

Each landmark is returned as normalized `(x, y, z, visibility)` where:
- `x, y` are normalized `[0, 1]` coordinates relative to the image dimensions
- `visibility` is a confidence score `[0, 1]`

**In our pipeline (`useDualMediaPipePose`):**
- Two separate MediaPipe instances run concurrently on Camera 1 and Camera 2
- Landmarks are extracted every frame via `requestAnimationFrame`
- Only landmarks with `visibility > 0.5` are passed to triangulation
- Normalized coordinates are converted to pixel coordinates: `u = x * imageWidth`, `v = y * imageHeight`

---

### DLT Triangulation

**Goal:** given a 2D point `(u₁, v₁)` in Camera 1 and the corresponding point `(u₂, v₂)` in Camera 2, find the 3D world point **X** = (X, Y, Z, W) in homogeneous coordinates.

This is the heart of the real-time 3D reconstruction, implemented entirely in TypeScript in `useTriangulation.ts`.

#### The DLT (Direct Linear Transform) Method

Each camera observation gives us two linear equations. For a point **x** = (u, v, 1) and projection matrix **P** (3×4), the projection constraint `λx = PX` expands to:

```
u(P[2]·X) - P[0]·X = 0
v(P[2]·X) - P[1]·X = 0
```

where `P[0]`, `P[1]`, `P[2]` are the rows of P. This gives 2 equations per camera, and with 2 cameras we get a 4×4 homogeneous linear system **AX = 0**:

```
A = [ u₁·P1[2] - P1[0] ]   ← from Camera 1, u coordinate
    [ v₁·P1[2] - P1[1] ]   ← from Camera 1, v coordinate
    [ u₂·P2[2] - P2[0] ]   ← from Camera 2, u coordinate
    [ v₂·P2[2] - P2[1] ]   ← from Camera 2, v coordinate
```

Each row is a 4-vector (the coefficients for X, Y, Z, W).

#### Solving AX = 0

The solution is the null-space vector of A — the vector X such that AX is as close to zero as possible. Formally this is the right singular vector of A corresponding to the smallest singular value (full SVD).

Our TypeScript implementation uses **Gaussian elimination with partial pivoting** instead of full SVD for performance:

```typescript
// Forward elimination with partial pivoting
for (let col = 0; col < 3; col++) {
  // Find row with largest pivot to maximize numerical stability
  let maxRow = col;
  for (let row = col + 1; row < 4; row++) {
    if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
  }
  [M[col], M[maxRow]] = [M[maxRow], M[col]];
  // Eliminate below pivot
  for (let row = col + 1; row < 4; row++) {
    const factor = M[row][col] / M[col][col];
    for (let k = col; k < 4; k++) M[row][k] -= factor * M[col][k];
  }
}
// Back-substitution assuming W = 1 (last variable)
```

After solving, the homogeneous result `X = (X, Y, Z, W)` is converted to Euclidean coordinates:

```
x_world = X/W,  y_world = Y/W,  z_world = Z/W
```

The result is in the same units as the calibration square size — **millimeters**.

#### Why DLT Works

The key insight is that the projection matrices P1 and P2 from `stereoRectify` already encode all the camera intrinsics and the stereo extrinsics. By building matrix A from these projection matrices and the observed pixel coordinates, we're asking: *"what 3D point, when projected through P1, lands at pixel (u₁,v₁), AND when projected through P2, lands at pixel (u₂,v₂)?"* The null-space of A is the unique answer.

This is mathematically equivalent to what `cv2.triangulatePoints` does, but runs entirely client-side in the browser with no server round-trip.

#### Coordinate Frame

The output coordinates are in Camera 1's rectified coordinate frame:
- **X** — horizontal (positive = right from the camera's perspective)
- **Y** — vertical (positive = down, OpenCV convention)
- **Z** — depth (positive = away from cameras)
- Units: **millimeters**

A person standing 1.5 m from the cameras will have `z ≈ 1500`. A right shoulder at `x = -300` is 300 mm to the left of the camera's optical axis. These large raw values are normal — the origin is the camera, not the centre of the person.

---

## 2D Motion Capture

The 2D tab uses a single camera with MediaPipe and provides:

- **Jitter analysis** — frame-to-frame velocity variance per joint
- **Occlusion detection** — frames where `visibility < 0.5`
- **Limb swap detection** — anatomical constraint violations (e.g. left wrist crossing right shoulder)
- **Depth consistency** — validates expected Z ordering between joints
- **Quality score (0–100)** — weighted aggregate of all metrics

---

## Calibration Workflow (Step by Step)

### Hardware setup
- Mount both cameras at the **same height**, **same depth**, pointing **parallel** (not angled toward each other)
- Recommended baseline: 150–400mm (roughly 10–20% of your working distance)
- Both cameras must be at the same resolution — check in Camera Setup tab

### Capture calibration frames
1. Go to **Calibration tab** in the app
2. Set inner corner counts (default: 5 rows, 8 cols) and square size in mm
3. Hold the checkerboard in front of both cameras simultaneously
4. Capture 15–20 frames covering:
   - Various distances (close, medium, far)
   - Various angles (tilt left/right, tilt up/down, ~30–45°)
   - All areas of the frame (corners, edges, center)
5. Click **Export Captures JSON**

### Run Python calibration
```bash
python calibrate_stereo.py \
  --json captures.json \
  --rows 5 --cols 8 --square 25
```

Arguments:
| Flag | Description |
|------|-------------|
| `--json` | Path to captures JSON exported from the app |
| `--rows` | Inner corner count vertically (squares − 1) |
| `--cols` | Inner corner count horizontally (squares − 1) |
| `--square` | Physical square size in mm |
| `--preview` | Save annotated images to verify corner detection |
| `--diagnose` | Check for camera mirroring issues |
| `--flip-cam1` / `--flip-cam2` | Flip one camera horizontally if mirrored |

### Interpret the output
```
Camera 1 error : 0.21 px   ← excellent (< 0.5 is good)
Camera 2 error : 0.24 px   ← excellent
Stereo error   : 0.77 px   ← good (< 1.0 is acceptable)
Baseline       : 373.8 mm  ← should match your physical camera separation
T vector       : [-370, 12, 8] mm  ← X=baseline, Y/Z should be near zero
```

If stereo error is high (> 5 px), common causes:
- Cameras at different resolutions (most common — both must match)
- One camera outputting a mirrored image (run `--diagnose`)
- Large Z component in T vector (cameras not at same depth)
- Cameras not parallel (converging toward each other)

### Load into the app
1. Go to **3D Reconstruction tab**
2. Click **Load stereo_calibration.json**
3. Start both cameras
4. Move your left wrist — X/Y/Z values in mm update in real time

---

## Motion Quality Analysis

Both the 2D and 3D labs record motion data and compute the same set of quality metrics. The challenge is that the two labs produce coordinates in fundamentally different units — making direct comparison invalid without normalisation.

### The Normalisation Problem

| Lab | Coordinate range | Unit |
|-----|-----------------|------|
| 2D MediaPipe | `[0, 1]` | Fraction of image dimension |
| 3D Stereo | `[-2000, 2000]` typical | Millimetres |

Velocity is `displacement / time`. A displacement of `0.01` in 2D and `10 mm` in 3D may represent exactly the same physical motion, but their velocities differ by ~1000×. Because velocity **variance** is squared, this produces a ~1,000,000× difference in the jitter score — making cross-lab comparison completely meaningless without normalisation.

Dividing by a fixed constant (e.g. the max observed coordinate value) is not valid — it has no physical meaning and changes between recordings and subjects.

### Body-Scale Normalisation

Every motion metric is divided by the **shoulder width measured in that same frame and same coordinate system**. Shoulder width is:

- Present in both labs (landmarks `leftShoulder` and `rightShoulder`)
- Automatically measured in whatever units the recording uses
- A real anatomical dimension — approximately constant for a given person
- Correctly depth-adaptive: in 2D it shrinks as the person steps back; in 3D it stays constant because the triangulation recovers true metric scale

The result is all metrics expressed in **shoulder-widths per second** — a dimensionless unit that means the same thing in both labs regardless of coordinate system.

#### Why per-frame, not a single mean?

We compute shoulder width **every frame** rather than once as a recording mean:

```
W(i) = √[ (lsx(i) − rsx(i))² + (lsy(i) − rsy(i))² + (lsz(i) − rsz(i))² ]
```

This matters because:
- In the **2D lab**, as the person moves toward or away from the camera, their shoulder width in `[0,1]` space changes proportionally — per-frame width tracks this correctly
- In the **3D lab**, triangulation noise grows with depth, causing small frame-to-frame fluctuations in the measured shoulder width — per-frame normalisation absorbs this rather than letting it accumulate

If either shoulder has `visibility < 0.5` in a frame, the width from the nearest valid frame is carried forward.

For the velocity computation between frames `i−1` and `i`, the body scale used is the mean of both adjacent frames:

```
B(i) = ( W(i−1) + W(i) ) / 2
```

---

### Full Math Reference

All formulas use index `i` for frame number, `N` for total frames, `Δt(i)` for the time between frames `i−1` and `i` in seconds. `j` denotes the joint being analysed.

#### Normalised Displacement

```
δx(i) = ( x_j(i) − x_j(i−1) ) / B(i)
δy(i) = ( y_j(i) − y_j(i−1) ) / B(i)
δz(i) = ( z_j(i) − z_j(i−1) ) / B(i)

displacement(i) = √[ δx(i)² + δy(i)² + δz(i)² ]      (shoulder-widths)
```

#### Normalised Speed

```
speed(i) = displacement(i) / Δt(i)      (shoulder-widths per second)
```

#### Mean Velocity — `relativeVelocity`

```
v̄ = (1 / (N−1)) × Σᵢ speed(i)
```

The average speed of the joint in shoulder-widths per second. Directly comparable between the 2D and 3D labs.

#### Velocity Variance — `velocityVariance`

```
σ²_v = (1 / (N−1)) × Σᵢ ( speed(i) − v̄ )²
```

Units: `(shoulder-widths/s)²` — dimensionless. Measures how **erratic** motion is:
- **Low variance** = the joint moves at a steady pace (smooth, even if fast)
- **High variance** = the joint lurches and stops unpredictably (jittery)

#### High-Frequency Noise — `highFrequencyNoise`

Frame-to-frame acceleration:

```
accel(i) = | speed(i) − speed(i−1) |
```

Fraction of frames where acceleration exceeds twice the mean speed:

```
HFN = count( accel(i) > 2 × v̄ ) / (N−2)
```

Range `[0, 1]`. Values near 0 = smooth. Values near 1 = very jittery.

#### Smoothness Score — `smoothnessScore`

```
jitterScore     = σ²_v + HFN × 10
smoothnessScore = clamp( 100 − jitterScore × 1000,  0, 100 )
```

| Score | Interpretation |
|-------|---------------|
| ≥ 80  | Excellent |
| 60–80 | Good |
| < 60  | Significant jitter |

#### Position Standard Deviation

Reported in **native units** (mm or `[0,1]`) — for display only, not cross-lab comparison:

```
μ_x = (1/N) × Σᵢ x_j(i)
σ_x = √[ (1/N) × Σᵢ ( x_j(i) − μ_x )² ]
```

Same formula applied independently for `y` and `z`.

#### Occlusion

A joint is occluded in frame `i` if `visibility(i) < 0.5`. Occluded frames are rendered as gaps in charts and counted separately:

```
occludedFramePercentage = count( visibility(i) < 0.5 ) / N × 100
averageVisibility       = (1/N) × Σᵢ visibility(i)
```

#### Overall Quality Score

Weighted average of four sub-scores, each 0–100:

```
overallScore = smoothnessScore × 0.3
             + occlusionScore  × 0.3
             + limbSwapScore   × 0.2
             + depthScore      × 0.2
```

---

### Metrics Reference

| Metric | Unit | Description |
|--------|------|-------------|
| `relativeVelocity` | shoulder-widths/s | Mean frame-to-frame speed, body-normalised |
| `velocityVariance` | (shoulder-widths/s)² | Variance of speed — high = erratic motion |
| `smoothnessScore` | 0–100 | Higher is smoother |
| `highFrequencyNoise` | 0–1 | Fraction of frames with acceleration spikes |
| `positionStdDev.x/y/z` | mm or [0,1] | Spread of raw joint position (native units) |
| `shoulderWidthRef` | mm or [0,1] | Mean shoulder width used as body scale reference |
| `averageVisibility` | 0–1 | Mean MediaPipe confidence across all frames |
| `occludedFramePercentage` | % | Frames below the 0.5 visibility threshold |
| `stereoReprojectionError` | RMS pixels | Calibration quality — lower is better |

---

# Stereo 3D Lab Recording Performance Optimization

## Changes Applied

### useDualMediaPipePose.ts
- **Moved recording buffer to `useRef`**: `recordedDataRef` now stores the full growing buffer
- **Removed React state for full data**: Replaced `[recordedData, setRecordedData]` with lightweight `[recordedRowCount, setRecordedRowCount]`
- **Batched landmark appends**: Both `processFrame1` and `processFrame2` now:
  - Build all landmark rows for a frame into a `frameRows` array
  - Append them all at once to `recordedDataRef.current` using `push(...frameRows)`
  - Update `recordedRowCount` state only once per frame
- **Updated export to read from ref**: `exportRecordedData` now reads from `recordedDataRef.current`
- **Fixed missing landmarks**: Added eye and ear landmarks (leftEye, rightEye, leftEar, rightEar) to `convertToLandmarks` function

**Result**: Reduced from ~26 state updates per stereo frame (one per landmark across both cameras) to ~2 state updates per stereo frame (one per camera for UI count).

### useMotionRecorder.ts
- **Moved frames buffer to `useRef`**: `framesBuffer` is the source of truth
- **Lightweight React state**: Replaced full `currentRecording` state with:
  - `currentRecordingMetadata`: Only id, name, startTime
  - `currentFrameCount`: Frame count for UI display
  - `currentDuration`: Duration for UI display
- **Reduced state updates in recordFrame**: Now only updates `currentFrameCount` and `currentDuration` instead of rebuilding the entire frames array
- **Lazy-computed currentRecording**: Computed from refs only when needed for exports

**Result**: Reduced state update overhead in the hot path significantly.

## Performance Impact

These changes eliminate the array-copy penalty that was causing:
- Growing memory allocations
- Full buffer copies on every landmark
- Excessive React reconciliation cycles

The bottleneck moved from recording logic to MediaPipe inference and stereo triangulation, which is where it should be.

## Backward Compatibility

- Both hooks return the same API signatures
- `recordedData` is still exposed (returns `ref.current`)
- Components using these hooks do not need changes


## Technology Stack

| Layer | Technology |
|-------|-----------|
| UI framework | React 18 + TypeScript |
| Build tool | Vite |
| Styling | Tailwind CSS + shadcn/ui |
| Pose detection | MediaPipe Pose Landmarker (`@mediapipe/tasks-vision`) |
| Stereo calibration (browser) | OpenCV.js (WebAssembly) |
| Stereo calibration (offline) | Python + opencv-python |
| Triangulation | Custom DLT solver in TypeScript |
| Charts | Recharts |
| Animations | Motion (Framer Motion) |
| Cloud storage | Supabase (optional) |

---

## Data Format

### Motion recording (JSON)
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
        "leftWrist": { "x": 0.4, "y": 0.7, "z": -0.3, "visibility": 0.95 }
      }
    }
  ]
}
```

### Stereo calibration (JSON)
```json
{
  "camera1": { "K": [[fx,0,cx],[0,fy,cy],[0,0,1]], "distortion": [k1,k2,p1,p2,k3], "reprojectionError": 0.21 },
  "camera2": { "K": [[fx,0,cx],[0,fy,cy],[0,0,1]], "distortion": [k1,k2,p1,p2,k3], "reprojectionError": 0.24 },
  "extrinsic": { "R": [[...]], "T": [-370, 12, 8], "E": [[...]], "F": [[...]] },
  "P1": [[...3x4 matrix...]],
  "P2": [[...3x4 matrix...]],
  "stereoReprojectionError": 0.77,
  "checkerboardConfig": { "rows": 5, "cols": 8, "squareSize": 25 }
}
```

---

## Troubleshooting

### Camera not detected
- Close other apps using the camera (Zoom, Teams, OBS)
- Try different USB ports
- Click **Refresh** in Camera Setup tab
- Restart browser if cameras still don't appear

### High stereo reprojection error
- Check both cameras are the **same resolution** (most common cause)
- Run `--diagnose` to check for mirroring
- Verify cameras are parallel and at the same depth
- Capture more frames with aggressive board tilting

### Wrong 3D coordinates (values too large)
- Reload the correct `stereo_calibration.json` — an old file with high error will give bad results
- Check the Z component of the T vector is near zero (cameras at same depth)
- Ensure `--square` matches your actual printed square size in mm

### OpenCV.js not loading
- The app tries `docs.opencv.org/4.10.0/opencv.js` first, then falls back to `/public/opencv.js`
- The local `public/opencv.js` must be the **full build** including calib3d — the minimal build will fail with "calib3d not available"
- Download the full build: `curl -o public/opencv.js https://docs.opencv.org/4.10.0/opencv.js`

---

## Acknowledgments

- **MediaPipe** by Google — real-time pose landmark detection
- **OpenCV** — camera calibration and stereo vision algorithms
- **Supabase** — cloud database infrastructure
- See `ATTRIBUTIONS.md` for complete credits
