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
6. [IMU Reconstruction + Correction Tab](#imu-reconstruction--correction-tab)
   - [Sensor Assignments](#sensor-assignments)
   - [IMU Packet Format](#imu-packet-format)
   - [Coordinate Frame Conventions](#coordinate-frame-conventions)
   - [3-Pose ALS Calibration](#3-pose-als-calibration)
   - [The Four Reliability Gates](#the-four-reliability-gates)
   - [Reconstruction Algorithm: Absolute Forward Kinematics](#reconstruction-algorithm-absolute-forward-kinematics)
   - [Side-by-Side View](#side-by-side-view)
   - [Debug Panel Reference](#debug-panel-reference)
   - [Key Source Files](#key-source-files-imu-system)
7. [Pipeline 4 — Failure-Triggered IMU Fusion](#pipeline-4--failure-triggered-imu-fusion)
   - [Overview](#fusion-overview)
   - [State Machine](#fusion-state-machine)
   - [Recovery Hysteresis (Two-Phase RECOVERY)](#recovery-hysteresis-two-phase-recovery)
   - [Shoulder Anchor Management](#shoulder-anchor-management)
   - [Forearm Wrist Computation](#forearm-wrist-computation)
   - [Source Priority from UNAVAILABLE](#source-priority-from-unavailable)
   - [Fusion Configuration](#fusion-configuration)
   - [Diagnostics](#fusion-diagnostics)
   - [Bug Fixes Implemented](#pipeline-4-bug-fixes)
   - [Automated Test Suite](#automated-test-suite)
8. [Data Format](#data-format)
9. [Technology Stack](#technology-stack)
10. [Troubleshooting](#troubleshooting)

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

## Frame Rate Investigation and Pipeline Refactor (July 2026)

During performance testing we observed that the 2D lab was running at ~12 fps while the 3D lab appeared to be running at ~39 fps — the opposite of what physics demands (3D requires two sequential inference calls per frame, so it must always be slower). Investigating this uncovered five separate bugs.

---

### Issue 1 — 2D lab throttled by `async` + stale `currentTime` deduplication

**Symptom:** 2D lab recorded ~160 frames from a 10-second clip at ~12 fps. 3D lab recorded ~400 frames from the same clip at ~39 fps.

**Root cause:** `detectPose` in `useMediaPipePose.ts` was marked `async`, which wrapped every call in a microtask and prevented tight back-to-back scheduling. Additionally, a `video.currentTime` deduplication guard was comparing the current frame time against a saved `lastVideoTimeRef`. Because `video.currentTime` has limited temporal resolution, it frequently matched the previous value and the frame was skipped — cutting effective throughput roughly in half.

**Fix:** Removed the `async` keyword from `detectPose`. Removed `lastVideoTimeRef` and the `currentTime` equality check. Every `requestAnimationFrame` callback now calls `detectForVideo` directly with `performance.now()`.

**Result:** 2D lab went from ~12 fps to ~44 fps.

---

### Issue 2 — 3D lab frame counts inflated by re-render cascade

**Symptom:** After fixing the 2D lab, 3D still showed ~400 frames while 2D showed ~190 — still roughly double, even though 3D should be slower.

**Root cause (a):** `useStereoMotionRecorder` had `[recorder]` in its `useCallback` dependency array. `recorder` is a plain object constructed fresh on every render, so its reference changed every render — causing `recordStereoFrame` to be recreated every render, which caused a `useEffect` in `TriangulationView` that depended on it to re-run and record a duplicate frame on every React re-render rather than only when a new stereo cycle had completed.

**Root cause (b):** `useMotionRecorder` called `setState` (`setCurrentFrameCount` / `setCurrentDuration`) inside the hot frame loop, triggering a React re-render cascade on every single frame — amplifying the effect above.

**Fix 1 — stable dependencies:** Changed `[recorder]` → `[recorder.isRecording, recorder.recordFrame]`. These are stable primitive/function values that only change when recording actually starts or stops.

**Fix 2 — throttled display updates:** In `useMotionRecorder`, added a `lastDisplayUpdateRef` and wrapped the display `setState` calls so they fire at most once every 250 ms. The frame buffer is written every frame; only the counter/duration display is throttled.

**Fix 3 — recording moved into the frame callback:** All recording logic was moved into `onStereoFrameRef.current` (called synchronously inside the rVFC/rAF callback), completely removing the recording `useEffect`. Recording now happens exactly once per stereo processing cycle, not once per React re-render.

**Result:** 3D frame counts dropped from ~400 to ~205 frames for a ~10-second clip — accurate counts.

---

### Issue 3 — rAF firing faster than camera frame rate, causing duplicate processing

**Symptom:** Even with recording fixed, `detectForVideo` was being called twice per camera frame at display refresh rates above the camera frame rate.

**Root cause:** `requestAnimationFrame` fires at the display refresh rate (~60 Hz). At 30 fps camera with 60 Hz display, every other rAF callback sees the same undecoded video frame — MediaPipe was processing the same pixel data twice, wasting ~50% of GPU budget.

**Fix:** Replaced `requestAnimationFrame` with `requestVideoFrameCallback` (rVFC), which fires exactly once per newly decoded video frame. Added a `SUPPORTS_RVFC` constant and a `video.currentTime` deduplication fallback for browsers without rVFC:

```
rVFC available   →  fires once per new decoded frame (precise)
rVFC unavailable →  rAF loop + currentTime guard (conservative fallback)
```

Camera 1's rVFC drives the stereo cycle. Camera 2 is processed immediately after in the same callback, maintaining temporal alignment between the two views.

---

### Issue 4 — triangulation running twice per frame

**Symptom:** The live pipeline was triangulating each stereo frame twice: once inside `onStereoFrameRef` and again inside a `useMemo` that depended on updated `camera1Landmarks`/`camera2Landmarks` state.

**Root cause:** Both the `onStereoFrame` callback and a `useTriangulation` useMemo hook were wired into the live pipeline simultaneously. Any time the rVFC callback updated landmark state, the useMemo recomputed — doubling the triangulation work and creating a second, slightly-later result that was being recorded instead of the first.

**Fix:** Removed `useTriangulation` from the live pipeline entirely. `onStereoFrameRef.current` now calls `triangulateAllLandmarks` once and routes the single result to both the recorder and `setPose3D`. The `useTriangulation` hook is retained only for the playback path (`StereoVideoPlayback`) where double-computation is not a concern.

---

### Issue 5 — DLT solver was not actually performing SVD

**Symptom:** Triangulated 3D positions were imprecise, with the homogeneous coordinate W implicitly assumed to be 1.

**Root cause:** The original `svdSolve` function in `useTriangulation.ts` was named "SVD" but performed Gaussian elimination and hardcoded `W = 1` when converting the homogeneous solution to Cartesian coordinates. This is mathematically incorrect: the DLT system **AX = 0** is a homogeneous system whose solution is the null vector of A (the right singular vector corresponding to the smallest singular value of A). Gaussian elimination finds a particular solution, not the null vector, and forcing `W = 1` biases the result whenever the true W deviates from unity.

**Fix:** Replaced `svdSolve` with a proper SVD using `ml-matrix` (`SingularValueDecomposition` class). The new `triangulatePoint` function:

1. Builds the 4×4 DLT matrix A from both cameras' projection equations.
2. Decomposes A = U · diag(S) · Vᵀ using full SVD (`ml-matrix` sorts singular values descending).
3. Extracts column 3 of V via `svd.rightSingularVectors.getColumn(3)` — the null vector.
4. Divides by the homogeneous coordinate W to recover the 3D Cartesian point.

Added `"ml-matrix": "^6.14.0"` to `package.json` dependencies.

---

### Current processing flow (post-refactor)

```
Camera 1 rVFC fires  ←  exactly once per new decoded video frame
  │
  ├─ drawImage(cam1) → offscreen canvas → detectForVideo(cam1, timestamp) → lm1
  ├─ drawImage(cam2) → offscreen canvas → detectForVideo(cam2, timestamp) → lm2
  │
  ├─ onStereoFrameRef.current(lm1, lm2)   ← synchronous, before any setState
  │    ├─ triangulateAllLandmarks(calibration, lm1, lm2, ...)  → pose3D   [once]
  │    ├─ if recording → recordStereoFrameRef.current(pose3D, lm1)         [once]
  │    └─ setPose3D(pose3D)                                                 [UI]
  │
  └─ setCamera1Landmarks(lm1), setCamera2Landmarks(lm2)                    [2D overlay]

  schedule() → register next rVFC on Camera 1
```

Key properties:
- **One inference per camera per frame** — rVFC guarantees this; no duplicate GPU calls.
- **One triangulation per stereo cycle** — computed once, routed to both recording and display.
- **One recording call per stereo cycle** — inside the rVFC callback, never triggered by React re-renders.
- **Throttled display updates** — frame buffer written every frame; `setState` for counters/duration fires at most 4×/second.
- **Correct null-space SVD** — real SVD extracts the homogeneous solution without fixing W = 1.

---

### Observed frame rates after all fixes

| Lab | Observed rate | Reason |
|-----|--------------|--------|
| 2D  | ~36–44 fps   | Single MediaPipe inference per frame, GPU delegate |
| 3D  | ~19–23 fps   | Two sequential inferences per stereo cycle, same GPU |

The ~2× ratio is expected and reflects the hardware ceiling: one GPU inference takes ~11–12 ms; two sequential ones take ~22–24 ms, capping the stereo pipeline at roughly half the 2D rate. Any result showing 3D faster than 2D indicates a counting bug (duplicate frame recording), not genuine throughput.


## IMU Reconstruction + Correction Tab

The **3D Failure Correction + IMU** tab fuses two independent sensing modalities — a stereo camera rig running MediaPipe Pose and a pair of BNO085 inertial measurement units (IMUs) strapped to the right arm — to produce a continuous, drift-resistant 3D arm reconstruction. The stereo pipeline provides absolute position grounding; the IMUs provide orientation continuity when vision is occluded or unreliable.

The tab contains six inner sub-tabs:

| Sub-tab | Purpose |
|---|---|
| Reconstruction + Correction | Side-by-side: Corrected Stereo (left) vs IMU Reconstruction (right) |
| IMU Health | Live per-sensor status, packet rate, raw quaternion values, derived Euler angles |
| Calibration | 3-pose IMU arm calibration workflow and stored calibration data |
| Video Recording | Synchronized dual-camera recording |
| Playback | Playback with IMU correction overlay |
| Debug | Per-segment debug dump, error metrics, ALS solver diagnostics |

The stereo MediaPipe pipeline is **always running** regardless of which inner sub-tab is visible. This is achieved by keeping the `IMUReconstructionView` component mounted at all times (via Radix `TabsContent forceMount`), with inactive sub-tabs hidden using CSS off-screen positioning rather than `display: none`. If `display: none` were used, the browser's `requestVideoFrameCallback` would silently stop firing, killing MediaPipe detection while the user browses other sub-tabs.

---

## Sensor Assignments

```
imu_01  →  Upper Right Arm   (shoulder → elbow segment)
imu_02  →  Forearm Right Arm (elbow → wrist segment)
```

Both sensors stream over a WebSocket connection to `ws://localhost:8765`. The firmware outputs native BNO085 rotation-vector quaternions — absolute orientation in a gravity-referenced, magnetically-corrected global frame.

---

## IMU Packet Format

Each WebSocket message is a JSON object:

```json
{
  "sensor_id":         "imu_01",
  "timestamp_us":      1234567890,
  "sequence":          42,
  "accuracy":          3,
  "qw":                0.9998,
  "qx":                0.0120,
  "qy":               -0.0054,
  "qz":                0.0088,
  "receiver_time_ns":  1234567890000,
  "receiver_time_utc": "2026-08-21T14:00:00.000Z"
}
```

`qw`, `qx`, `qy`, `qz` form a unit quaternion in `[w, x, y, z]` order. On receipt, the browser validates each component (finite, non-zero magnitude) and immediately normalizes before storing. Malformed or zero-magnitude packets are silently dropped.

**Accuracy** is a 0–3 integer from the BNO085 sensor fusion engine:
- 0 = Unreliable (sensor just powered on or in magnetic disturbance)
- 1 = Low
- 2 = Medium
- 3 = High (full sensor fusion active)

IMU packets are written directly to a ref at the full hardware rate (typically 50–100 Hz). React state is synchronized at **10 Hz** only for the UI display. All reconstruction math reads from the ref so it never misses a high-frequency update.

---

## Coordinate Frame Conventions

Understanding the two world frames is essential for reading the calibration math correctly.

| Frame | X | Y | Z | Gravity direction |
|---|---|---|---|---|
| **BNO085 IMU world** | East | North | Up | `[0, 0, −1]` (ENU/Z-up) |
| **Stereo / OpenCV world** | Right | Down | Depth | `[0, +1, 0]` (Y-down) |

The BNO085 outputs a quaternion `q` that maps vectors from the **sensor body frame** into the **IMU world frame**:

```
v_imu_world = rotate(q, v_sensor)
```

The calibration matrix `A` (3×3 rotation, one per sensor) maps vectors from the **IMU world frame** into the **stereo world frame**:

```
v_stereo_world = A · v_imu_world
```

So the complete chain from sensor frame to stereo world is:

```
v_stereo = A · rotate(q, v_sensor)
```

---

## 3-Pose ALS Calibration

Calibration solves for two unknowns **per sensor**:

| Unknown | Symbol | Meaning |
|---|---|---|
| World-frame alignment | `A` | 3×3 rotation: IMU world → stereo world |
| Bone direction in sensor frame | `b` | Unit vector in sensor body frame pointing along the bone |

Once `A` and `b` are known, runtime reconstruction is purely feed-forward with no reference snapshot, no ΔQ, and no accumulated drift.

### The Observation Model

For each calibration frame `i`, the sensor quaternion `q_i` and the stereo-measured bone direction `d_i` are related by:

```
d_stereo_i  ≈  A · rotate(q_i, b_sensor)
            =  A · R(q_i) · b_sensor
```

where `R(q_i)` is the 3×3 rotation matrix corresponding to quaternion `q_i`. This is the **Wahba problem**: find rotation `A` and direction `b` that best explain all `N` observations.

### The Three Calibration Poses

Three distinct arm configurations are required because `A` has 3 rotational DOF and `b` has 2 angular DOF (5 DOF total). Three poses with different arm orientations provide enough constraints to resolve them jointly.

| Pose | Configuration | Primary constraint |
|---|---|---|
| **Pose 1 — T-pose lateral** | Arm straight out to the side; elbow straight | Establishes the lateral axis; provides baseline UA and FA directions for Poses 2 and 3 to validate against |
| **Pose 2 — Raised arm** | Arm raised ~45–60° in the frontal plane; elbow straight | Second UA orientation — constrains the elevation axis |
| **Pose 3 — Forearm up** | Upper arm lateral (matching Pose 1); elbow bent ~90°; forearm pointing upward | Second FA orientation — constrains the elbow flexion axis |

Each pose collects **45 frames** (approximately 1.5 seconds) with all acceptance gates active. All three pose datasets are pooled into a single observation set before solving.

### Frame Acceptance During Collection

A calibration frame is accepted only when all of the following hold simultaneously:

| Check | Threshold | Purpose |
|---|---|---|
| Joint validity | shoulder, elbow, wrist all finite and visible | Stereo triangulation succeeded |
| Segment length | 50 mm < UA < 1000 mm, 50 mm < FA < 1000 mm | Stereo depth reading is physically plausible |
| Stereo freshness | < 150 ms since last stereo frame | Data is live, not stale |
| IMU freshness | < 150 ms since last packet for each sensor | Both sensors are streaming |
| New stereo frame | Current frame timestamp ≠ last accepted | No duplicate frames |
| Arm stability | 10-frame window: angular spread < 15°, length std dev < 20 mm | Arm held still during collection |
| Pose geometry | Direction checks specific to each pose (see below) | User is actually holding the requested pose |

The **stability window** deduplicates separately from the acceptance deduplication: frames with out-of-range segment lengths do not enter the stability window, so all 10 required frames are genuinely valid.

### Pose Geometry Validation

During collection, the live arm directions are checked against the expected geometry for the current pose:

**Pose 1 (T-pose lateral):**
- Elbow angle < 35° (arm straight)
- `|uaDir.x| ≥ 0.25` (arm has significant lateral component)
- `|uaDir.y| < 0.75` and `|uaDir.z| < 0.75` (not pointing mostly up or forward)

**Pose 2 (raised arm):**
- Elbow angle < 35° (arm straight)
- `|uaDir.z| < 0.65` (arm not pointing toward/away from camera)
- Upper arm 20–80° elevated from Pose 1 direction (confirmed via `angleBetweenDeg`)

**Pose 3 (forearm up):**
- Elbow angle 35–140° (elbow visibly bent)
- Upper arm within 40° of Pose 1 direction (lateral, not elevated)
- Forearm ≥ 30° from Pose 1 forearm direction (bent upward)

### Alternating Least-Squares (ALS) Solver

After all three poses are collected, the observation arrays are pooled across all frames from all poses. The solver runs independently for the upper-arm (`imu_01`) and for the forearm (`imu_02`).

**ALS alternates between two closed-form steps:**

#### b-step (bone direction update)

With `A` fixed, the optimal `b` that minimizes the sum of squared angular errors is:

```
b = normalize( Σᵢ  R(qᵢ)ᵀ · Aᵀ · dᵢ )
```

This is the unit-length direction most aligned with all rotated-back stereo observations. The sum is a simple vector accumulation.

#### A-step (world alignment update)

With `b` fixed, `A` is the solution to the **Wahba problem** on the observation set `{sᵢ, dᵢ}` where `sᵢ = R(qᵢ) · b`:

```
Minimize  Σᵢ  ||A · sᵢ  −  dᵢ||²
```

This is solved via the **Kabsch/SVD method** (sometimes called the weighted Wahba solver):

```
H = Σᵢ wᵢ · sᵢ · dᵢᵀ        (3×3 cross-covariance matrix)
SVD(H) = U · Σ · Vᵀ
A = V · Uᵀ                    (with determinant correction if det < 0)
```

The determinant correction flips the sign of the third column of V when `det(V · Uᵀ) < 0`, ensuring `A` is a proper rotation (det = +1) rather than a reflection.

A **gravity regularizer** is added to each A-step: a synthetic observation `(s = [0, 0, −1], d = [0, +1, 0], weight = 20)` enforces the physical constraint that the IMU world Z-down direction must map to the stereo world Y-down direction. This constrains the tilt DOF of `A` independently of the pose data, improving conditioning when the arm does not fully explore both tilt axes.

Weight 20 against approximately 135 frame observations (weight 1 each) gives gravity roughly 13% of total influence — enough to stabilize tilt without distorting the data-driven solution.

#### Convergence criterion

After each A-step, the rotation angle between the old and new `A` is computed via the trace formula:

```
angle = acos( clamp( (trace(Aᵀ · A_new) − 1) / 2,  −1, 1 ) )
```

The solver **converges** when `angle < 0.05°`. The iteration limit is **100**. A **stagnation detector** tracks whether the per-iteration delta has changed by less than 1×10⁻⁴° for 10 consecutive iterations; if so, the loop exits early (local minimum, no further progress possible). The convergence flag distinguishes tight convergence from stagnation.

### Multi-Initialization (12 Yaw Starts)

The ALS objective is non-convex and can stall at local minima depending on initialization. The gravity constraint resolves 2 of the 3 rotational DOF of `A` (tilt), but the remaining 1 DOF (yaw — rotation around the gravity axis) is unconstrained by gravity alone. With insufficient pose diversity, the data may not fully resolve yaw either.

To mitigate this, `solveALSMultiInit` runs 12 independent ALS trials, each starting from a different yaw rotation (every 30° from 0° to 330°):

```
A_init(θ) = A_BASE × Yaw(θ)

where  A_BASE = [[1,0,0],[0,0,−1],[0,1,0]]   (maps IMU gravity → stereo gravity)
       Yaw(θ) = [[cos θ, −sin θ, 0],          (rotation around IMU world Z-axis)
                 [sin θ,  cos θ, 0],
                 [0,      0,     1]]
```

Each `A_init(θ)` satisfies the gravity constraint: `A_init(θ) · [0, 0, −1] = [0, 1, 0]`.

After all 12 trials, the best solution is selected by:

```
score = perFrameResidualMean + 0.05 × gravityAlignmentError
```

The candidate with the lowest score is used. This ensures the winning solution has both low reconstruction error and physical gravity alignment.

#### Ambiguity detection

If any other candidate's residual is within **1°** of the winner but their `A` matrices differ by more than **15°** in rotation angle, the calibration is flagged as **ambiguous**. An ambiguous calibration is demoted to `quality: 'warning'` and the UI displays an advisory. Ambiguity most often occurs when the three arm poses are not sufficiently spread across different directions — the solver cannot uniquely resolve yaw from the data alone.

### Per-Pose Averaging (Step 1)

Before running ALS, per-pose averages are computed to verify internal consistency:

**Segment lengths:**
```
uaLengthMm = median( dist3D(shoulder_i, elbow_i)  for all frames in this pose )
faLengthMm = median( dist3D(elbow_i,   wrist_i)   for all frames in this pose )
```

Median rejects outlier frames where MediaPipe briefly misfired.

**Average stereo direction (used for residual display):**
```
uaDirs = [normalize(elbow_i − shoulder_i) for each frame]
uaAvg  = normalize(sum(uaDirs))           (with outlier rejection)
```

`averageVec3Simple` includes a two-pass outlier rejection: directions more than 45° from the raw mean are discarded before the final average. If the surviving directions cancel (the average magnitude is near zero), calibration aborts with an error.

**Average IMU quaternion:**

Quaternion averaging requires sign-alignment to handle the double-cover (`q` and `−q` are the same rotation):

```
1.  q_ref = quats[0]
2.  For each q_i: align sign so dot(q_ref, q_i) ≥ 0
3.  q_avg = normalize(component-wise sum of aligned quaternions)
```

### Pose 1 Direction Propagation

At the end of Pose 1 collection, the averaged UA and FA directions are stored in `pose1AvgDirsRef`. These are used during Poses 2 and 3 collection to check that the upper arm has moved a meaningful angular distance from Pose 1 (constraint: 20–80° for Pose 2) and that the upper arm has not drifted (constraint: < 40° for Pose 3). If the Pose 1 average is inconsistent (directions cancelled), calibration resets to idle rather than advancing to Pose 2 with a null reference.

### Calibration Validation

After ALS converges, every stored frame from all three poses is replayed through the estimated model and the residual is measured:

```
predicted direction = normalize( A · rotate(q_i, b) )
residual_i          = angleBetween(predicted, stereo_measured_direction)
```

Reported metrics:

| Metric | Description |
|---|---|
| Per-pose mean residual | Mean residual for UA and FA in each of the 3 poses |
| Overall mean residual | Mean across all poses and both segments |
| **Max pose-mean residual** | Maximum of the six per-pose means — used for quality thresholding |
| **Max frame residual** | Maximum individual-frame residual across all frames and both segments |
| Gravity alignment error | `angleBetween(A · [0,0,−1], [0,1,0])` for each sensor |
| ALS convergence | Whether the tight 0.05° criterion was met |
| Iteration count | Number of ALS iterations actually run |
| Winning yaw init | Which of the 12 starting angles produced the best solution |
| Ambiguity flag | Whether multiple inits gave tied residuals but different predictions |

**Quality thresholds:**

| Quality | Condition |
|---|---|
| `good` | Max pose-mean ≤ 10°, gravity error ≤ 15°, not ambiguous |
| `warning` | Max pose-mean 10–25°, or ambiguity flag set |
| `failed` | Max pose-mean > 25°, or gravity error > 15°, or ALS did not converge |

A `failed` calibration is stored for display but **never used for reconstruction**. The runtime reconstruction path explicitly checks `quality !== 'failed'` before using any calibration parameters.

---

## The Four Reliability Gates

Every stereo frame, the arm pose must pass four independent checks before the `lastReliable` vision reference can update. All four must pass simultaneously.

### Gate 1 — Geometry Sanity
```
segOk = (uaLen > 50 mm  &&  uaLen < 1000 mm)
     && (faLen > 50 mm  &&  faLen < 1000 mm)
```
Rejects frames where stereo triangulation produces anatomically impossible segment lengths.

### Gate 2 — Failure Correction Status
```
rightArmClean = shoulder, elbow, wrist are all:
  reliable == true  AND  failureType == 'none'
```
Rejects frames where the EMA jitter corrector has flagged any right-arm joint as `light_jitter` or `heavy_jitter`.

### Gate 3 — Calibrated Bone Length Consistency
```
segCalibOk =  |uaLen − calib.uaLengthMm| / calib.uaLengthMm  ≤  0.20
           &&  |faLen − calib.faLengthMm| / calib.faLengthMm  ≤  0.20
```
Active only when a valid (non-failed) calibration exists. Rejects frames where measured bone length deviates more than 20% from the calibrated physical length. A segment suddenly 40% shorter than calibration typically means MediaPipe has grabbed the wrong joint.

### Gate 4 — Position Velocity
```
posVelocityOk = dist3D(elbow_current, ref.upperArm.elbow) < 120 mm
             && dist3D(wrist_current, ref.forearm.wrist)   < 120 mm
```
Rejects frames where a joint teleports more than 120 mm between frames (≈ 3.6 m/s at 30 fps). Catches smooth confabulation drift that passes the jitter and length checks.

---

## Reconstruction Algorithm: Absolute Forward Kinematics

Unlike the classic ΔQ approach (which integrates relative rotation changes from a frozen snapshot), this pipeline uses **absolute orientation reconstruction**. There is no reference snapshot, no ΔQ, and no accumulated drift. Each frame's reconstruction is completely independent of the previous frame.

The only required anchor is the **current stereo shoulder position**, which is read from the live stereo triangulation on every frame.

### The Core Equations

For the upper arm:
```
boneImuWorld_UA = rotate(q_imu01, uaBoneLocalDir)      // sensor frame → IMU world
worldDir_UA     = normalize( R_ua · boneImuWorld_UA )  // IMU world → stereo world
elbow_recon     = shoulder_stereo + uaLength × worldDir_UA
```

For the forearm:
```
boneImuWorld_FA = rotate(q_imu02, faBoneLocalDir)
worldDir_FA     = normalize( R_fa · boneImuWorld_FA )
wrist_recon     = elbow_recon + faLength × worldDir_FA
```

Where:
- `q_imu01`, `q_imu02` — current BNO085 quaternions (read at the moment the stereo frame arrives)
- `uaBoneLocalDir`, `faBoneLocalDir` — fixed unit vectors in each sensor's body frame, solved during calibration
- `R_ua`, `R_fa` — fixed 3×3 rotation matrices (the `A` matrices from ALS), solved during calibration
- `uaLength`, `faLength` — fixed segment lengths in mm, measured during calibration as median stereo distance
- `shoulder_stereo` — the stereo-triangulated right shoulder position (the only per-frame positional anchor)

### The `rotate(q, v)` Operation

`rotateVectorByQuaternion` uses the optimized cross-product sandwich (no matrix allocation):

```
t  = 2 × cross(q_vec, v)
v' = v + w·t + cross(q_vec, t)

where q_vec = [qx, qy, qz],  w = qw
```

Expanded component-wise:
```
tx = 2(qy·vz − qz·vy)
ty = 2(qz·vx − qx·vz)
tz = 2(qx·vy − qy·vx)

vx' = vx + w·tx + qy·tz − qz·ty
vy' = vy + w·ty + qz·tx − qx·tz
vz' = vz + w·tz + qx·ty − qy·tx
```

### Why Absolute Reconstruction Has No Drift

In ΔQ-based reconstruction, errors in each frame's `ΔQ` compound over time because the current direction vector is the result of chaining all previous deltas. If the sensor drifts 0.1° per second, after 60 seconds the accumulated error is ~6°.

In absolute reconstruction, the current direction vector is computed directly from the current quaternion and the fixed calibration parameters. Any momentary sensor noise affects only the current frame. There is no compounding. The trade-off is that accuracy is bounded by calibration quality rather than by drift rate — a poor calibration produces a systematically biased result that does not get worse over time.

### Why the Shoulder is the Only Required Anchor

`elbow = shoulder + length × direction` and `wrist = elbow + length × direction`. The shoulder position is needed to locate the chain in absolute 3D space. Elbow and wrist positions are derived purely from directions and lengths. No snapshot of elbow or wrist history is stored or required.

If stereo temporarily loses the shoulder (occluded), reconstruction is suppressed until it returns. The forearm direction continues to be computed correctly (it depends only on `imu_02` and calibration), but there is no anchor to pin the chain to absolute space.

### Note on IMU Sensor Placement

The physical location of the sensor chip along the arm segment does not affect the reconstruction. A rigid segment has the same orientation everywhere along its length. The quaternion encodes orientation only, not position. Whether the sensor is near the elbow or near the shoulder, it reports the same rotation quaternion for the same arm pose.

### Safety Rules

| Condition | Effect on Reconstruction |
|---|---|
| No valid calibration (`quality === 'failed'` or null) | Entire reconstruction suppressed |
| `imu_01` packet older than 500 ms | Entire reconstruction suppressed |
| `imu_02` packet older than 500 ms | Elbow reconstructed; wrist set to null |
| Shoulder stereo position not visible | Entire reconstruction suppressed |
| `imu_01` quaternion not finite/unit | Entire reconstruction suppressed |

---

## Side-by-Side View

The Reconstruction + Correction sub-tab shows two synchronized 3D projections with the same spatial bounds:

| Left Panel | Right Panel |
|---|---|
| Corrected Stereo Reconstruction | IMU Reconstruction |
| EMA-corrected stereo skeleton (green) | IMU-derived skeleton (orange) |
| Absolute position from stereo triangulation | Absolute direction from IMU + calibration |

Both panels project into the same normalized coordinate space (computed from the corrected stereo pose bounds). When calibration is accurate, the two skeletons overlap closely across all arm positions, including positions not seen during calibration.

---

## Debug Panel Reference

The Debug sub-tab shows per-segment internals, updated at 10 Hz:

| Field | Description |
|---|---|
| `qCurrent` | Current IMU quaternion `[w, x, y, z]` as read from the sensor ref |
| `boneLocalDir` | Fixed bone direction in the sensor body frame (from calibration) |
| `worldDir` | Final world-space direction vector after applying `R · rotate(q, b)` |
| `calibLength` | Calibrated segment length in mm |
| `reconPos` | Reconstructed joint position `{x, y, z}` in mm |
| `stereoPos` | Corrected stereo joint position `{x, y, z}` in mm |
| `posError` | Euclidean distance between recon and stereo positions (mm) |
| `angError` | Angular deviation between recon world direction and stereo-measured direction (°) |
| `elbowAngleDeg` | Angle between UA and FA world directions (forearm debug only) |

Position error and angular error are only meaningful when the stereo arm is simultaneously reliable and visible.

---

## Key Source Files (IMU System)

| File | Role |
|---|---|
| `src/app/components/IMULabView.tsx` | Main tab component — ALS calibration engine, absolute FK reconstruction, all sub-tab UI |
| `src/app/components/IMUReconstructionView.tsx` | Side-by-side 3D SVG viewer — corrected stereo (left) and IMU skeleton (right) |
| `src/app/hooks/useIMUWebSocket.ts` | WebSocket client — packet parsing, normalization, 10 Hz React sync, hot-path `getRawIMU()` |
| `src/app/utils/quaternionUtils.ts` | All quaternion math — `rotateVectorByQuaternion`, `averageQuaternions`, `multiplyQuaternions`, `invertQuaternion`, `quaternionToEuler` |
| `src/app/hooks/usePoseFailureCorrection.ts` | EMA jitter corrector — supplies `JointFailureStatus[]` consumed by reliability Gate 2 |
| `src/app/hooks/useTriangulation.ts` | Stereo triangulation — produces metric 3D joint positions in mm from two camera views |


## Pipeline 4 — Failure-Triggered IMU Fusion

Pipeline 4 (`useIMUFusionController`) is the segment-level fusion state machine that sits on top of Pipelines 1–3. It produces a single continuous arm reconstruction by blending corrected stereo positions with IMU-derived positions per arm segment, independently for the upper arm (UA: shoulder→elbow) and forearm (FA: elbow→wrist). This section provides a complete technical reference for the pipeline: the mathematical formulations used to determine IMU orientation, the exact trigger and recovery conditions, and a step-by-step code-level walkthrough of every frame-processing stage.

**Primary sources:**
- `src/app/hooks/useIMUFusionController.ts` — fusion state machine, per-frame computation
- `src/app/components/IMULabView.tsx` — ALS calibration engine, absolute FK reconstruction, integration point
- `src/app/utils/quaternionUtils.ts` — all quaternion mathematics

---

### Coordinate Systems

Understanding the coordinate conventions is prerequisite to understanding every formula.

**BNO085 IMU (ENU / Z-up):**
- X = East, Y = North, Z = Up
- Gravity direction in sensor frame: [0, 0, −1] (gravity pulls in the −Z direction)
- The sensor reports a rotation-vector quaternion q that maps the **sensor body frame → ENU world frame**. Concretely, if the sensor is lying flat on a table, q is the identity quaternion and the sensor body axes align with ENU world axes.

**Stereo / OpenCV world frame (Y-down / right-hand):**
- X = right (from the perspective of camera 1)
- Y = down
- Z = depth (into the scene, away from the cameras)
- Gravity direction in this frame: [0, +1, 0] (gravity pulls in the +Y direction)
- All joint positions output by the DLT triangulation hook are in this frame, in millimetres.

The ALS calibration produces a 3×3 rotation matrix `A` (per segment) that maps from IMU world frame → stereo world frame. Gravity provides the primary constraint: `A · [0,0,−1] ≈ [0,1,0]`.

---

### Part 1 — ALS Calibration

Before Pipeline 4 can run, each segment (UA and FA) must be calibrated. Calibration is performed interactively in the IMU Lab tab of `IMULabView.tsx` and produces per-segment outputs stored in `armCalibrationRef.current`.

#### 1.1 What is Being Solved

For each segment, the calibration finds two unknowns simultaneously:

- **A** — a 3×3 proper rotation matrix (SO(3)) that rotates a vector from the IMU world frame into the stereo world frame
- **b** — a unit vector in the sensor body frame pointing along the bone axis (the "bone local direction")

The model equation is:

```
d_stereo ≈ A · R(q) · b
```

Where:
- `d_stereo` — the measured bone direction in stereo world coordinates (unit vector from proximal joint to distal joint, computed from triangulated positions)
- `q` — the quaternion reported by the IMU sensor at the moment of the observation
- `R(q)` — the rotation matrix corresponding to q, which rotates a vector from the sensor body frame to the ENU world frame
- `b` — the bone direction in the sensor body frame (unknown)
- `A` — the IMU world → stereo world rotation (unknown)

The product `A · R(q) · b` rotates b from the sensor body frame, through ENU world space, into stereo world space. This should match the stereo-measured bone direction `d_stereo`.

Three calibration poses are collected (three distinct arm orientations that are geometrically diverse), yielding three (q_i, d_i) observation pairs per segment. The system is underdetermined with only three poses but the gravity regularizer (see §1.3) provides the additional constraint to make it well-conditioned.

#### 1.2 The Wahba Solver (`wahbaFromPairs`)

**Source:** `IMULabView.tsx` lines 316–346

The core rotation-fitting primitive is a weighted Wahba problem solved by SVD (Kabsch algorithm). Given a set of unit-vector pairs {(s_i, d_i)} with weights w_i, find the rotation R ∈ SO(3) that minimizes:

```
J(R) = Σ_i  w_i · |d_i − R · s_i|²
```

The optimal R is found as follows:

**Step 1 — Accumulate the cross-covariance matrix H:**

```
H = Σ_i  w_i · s_i · d_i^T       (3×3 matrix)

H_00 = Σ w_i · s_ix · d_ix
H_01 = Σ w_i · s_ix · d_iy
H_02 = Σ w_i · s_ix · d_iz
H_10 = Σ w_i · s_iy · d_ix
...etc
```

Note the outer-product ordering: s is the source vector (in sensor/IMU space), d is the destination vector (in stereo space). The rows index the source coordinate, the columns index the destination coordinate.

**Step 2 — Singular Value Decomposition:**

```
SVD(H) = U · Σ · V^T
```

The optimal rotation (in the absence of reflections) is:

```
R = V · U^T
```

**Step 3 — Determinant correction (ensuring proper rotation):**

The SVD solution can produce a reflection (det(R) = −1) if the data has noise or near-degeneracy. This is corrected by flipping the sign of the third column of V before the final multiplication:

```
if det(R) < 0:
    V[:, 2] = −V[:, 2]
    R = V · U^T
```

This ensures R ∈ SO(3) (det = +1, orthonormal) in all cases.

```typescript
// From wahbaFromPairs in IMULabView.tsx
const Rraw = V.mmul(U.transpose());
const det = ...;          // 3×3 determinant
if (det < 0) {
    Vf = V.clone();
    Vf.col(2) *= -1;      // flip last column
    R = Vf.mmul(U.transpose());
}
```

#### 1.3 Alternating Least-Squares (`solveALS`)

**Source:** `IMULabView.tsx` lines 362–440

The two unknowns A and b appear multiplicatively in the model equation, so a direct closed-form solution does not exist. The ALS algorithm decouples the problem by alternating between two linear sub-problems:

**b-step — update bone direction given current A:**

With A fixed, each observation gives a predicted direction for b in sensor space:

```
b_i^(sensor) = R(q_i)^{-1} · A^T · d_stereo_i
             = R(q_i^*) · A^T · d_stereo_i      (quaternion inverse = conjugate for unit quats)
```

The optimal b is the normalized average of all b_i^(sensor):

```
b^(raw) = Σ_i  R(q_i^*) · A^T · d_stereo_i
b = b^(raw) / |b^(raw)|
```

This is the solution to the L2-minimization of |b − b_i^(sensor)|² over the unit sphere.

**A-step — update world rotation given current b:**

With b fixed, each observation provides a source vector in IMU world space:

```
s_i = R(q_i) · b       (rotate bone direction from sensor frame into IMU world frame)
```

We then solve the Wahba problem with source vectors s_i and destination vectors d_stereo_i:

```
A = wahbaFromPairs({ (s_i, d_stereo_i, w=1) } ∪ gravity_regularizer)
```

**Gravity regularizer:**

The gravity observation provides an independent, physics-grounded constraint:

```
s_gravity = [0, 0, −1]     (gravity in IMU ENU world: −Z direction)
d_gravity = [0, 1,  0]     (gravity in stereo world: +Y direction, since Y is down)
w_gravity = 20
```

This single synthetic pair, weighted at 20× a normal observation, is added to every A-step solve. With ~3 calibration observations of weight 1 each, the gravity constraint contributes approximately 20/23 ≈ 87% of the total Wahba cost — strongly constraining the tilt axis while leaving the yaw axis to be determined by the arm pose data. Without this regularizer, solutions with correct residuals but physically impossible gravity mappings (e.g. gravity pointing sideways) can dominate.

**Convergence criterion:**

After each iteration, the rotation angle between A_old and A_new is measured via the trace of A_old^T · A_new:

```
angle = arccos( clamp((trace(A_old^T · A_new) − 1) / 2, [−1, 1]) ) × (180/π)
```

Convergence is declared when `angle < 0.05°`. Maximum 100 iterations. Stagnation is detected when `|Δangle| < 1e-4°` for 10 consecutive iterations (local minimum — further iterations are wasted).

**Final b refinement:**

When convergence is reached, one additional b-step is performed using the final converged A to maximize the quality of the bone direction estimate.

#### 1.4 Multi-Initialization (`solveALSMultiInit`)

**Source:** `IMULabView.tsx` lines 451–522

ALS can converge to local minima. Since the gravity axis (Z in IMU world) is constrained, the remaining degree of freedom is the **yaw** around gravity. The multi-initialization strategy tries 12 starting orientations spaced 30° apart in yaw:

```
A_BASE = [[1,0,0],[0,0,−1],[0,1,0]]    // maps IMU Z-up gravity to stereo Y-down gravity
θ_k = 2π × k / 12,    k = 0, 1, ..., 11

Yaw(θ_k) = [[cos θ_k,  −sin θ_k,  0],    // rotation around IMU Z-axis
             [sin θ_k,   cos θ_k,  0],
             [     0,         0,   1]]

A_init_k = A_BASE × Yaw(θ_k)
```

Each initialization is gravity-consistent by construction (`A_init_k · [0,0,−1] = [0,1,0]` exactly). The 12 candidates are ranked by a combined score:

```
score = perFrameResidualMeanDeg + 0.05 × gravityAlignmentErrorDeg
```

where `perFrameResidualMeanDeg` is the mean angular error across all calibration frames (`angleBetween(A·R(q)·b, d_stereo)`), and the 0.05 gravity penalty gently prefers solutions that maintain better gravity alignment.

**Ambiguity detection:** if a second candidate has a score within 1° of the winner but differs from it by more than 15° of rotation, the calibration is flagged as ambiguous — the arm poses do not uniquely determine the yaw. The user is warned to recollect with more diverse arm orientations.

#### 1.5 Calibration Outputs

After `solveALSMultiInit` converges for both segments, the following values are stored in `armCalibrationRef.current`:

| Field | Type | Description |
|---|---|---|
| `R_ua` | `Mat3` | IMU world → stereo world rotation for upper arm |
| `R_fa` | `Mat3` | IMU world → stereo world rotation for forearm |
| `uaBoneLocalDir` | `Vec3` | Upper arm bone axis in imu_01 sensor body frame |
| `faBoneLocalDir` | `Vec3` | Forearm bone axis in imu_02 sensor body frame |
| `uaLengthMm` | `number` | Calibrated upper arm length in mm (median over poses) |
| `faLengthMm` | `number` | Calibrated forearm length in mm (median over poses) |
| `quality` | `string` | `'good'` / `'ok'` / `'poor'` / `'failed'` |

---

### Part 2 — Runtime IMU Orientation Reconstruction

Each stereo frame, `onCorrectedPose` in `IMULabView.tsx` performs an absolute forward-kinematics reconstruction from the current IMU sensor quaternions. This is independent of any previous frame — there is no ΔQ, no reference snapshot, and no drift accumulation.

#### 2.1 Upper Arm Reconstruction (imu_01)

**Source:** `IMULabView.tsx` lines 1585–1613

Given the current quaternion `q_ua` from imu_01 sensor (right upper arm):

**Step 1 — Rotate bone direction from sensor body frame into IMU ENU world frame:**

```
boneInImuWorld = R(q_ua) · uaBoneLocalDir
```

This is computed using the optimized quaternion sandwich product:

```
boneInImuWorld = q_ua ⊗ [0, uaBoneLocalDir] ⊗ q_ua*
```

Where `⊗` denotes Hamilton quaternion multiplication and `q_ua*` is the conjugate. In `rotateVectorByQuaternion` this is implemented via the cross-product form for efficiency:

```
t = 2 · (q.xyz × v)
v' = v + q.w · t + (q.xyz × t)
```

**Step 2 — Rotate from IMU world frame into stereo world frame:**

```
worldDirUA = normalize(R_ua · boneInImuWorld)
```

Where `R_ua` is the calibrated IMU world → stereo world matrix. The normalization is defensive (R_ua is a rotation so the magnitude should already be 1, but floating-point drift is corrected).

**Step 3 — Project from shoulder anchor along bone direction:**

```
reconElbow = effectiveShoulder + uaLengthMm × worldDirUA
```

The shoulder anchor (`effectiveShoulder`) is the last confirmed stereo shoulder position managed by the fusion controller (see §4.1). This is read-only before calling `processFusionFrame`.

#### 2.2 Forearm Reconstruction (imu_02)

**Source:** `IMULabView.tsx` lines 1625–1663

The same three-step process applies for the forearm, using `q_fa` from imu_02 (forearm):

```
boneInImuWorld_FA = R(q_fa) · faBoneLocalDir
worldDirFA        = normalize(R_fa · boneInImuWorld_FA)
```

The normalized direction `worldDirFA` is stored as `imuFAWorldDir` — a `[x, y, z]` tuple — and passed to the fusion controller. The fusion controller computes the final wrist position internally using the fused elbow (see §4.5). For the pure IMU display panel, the wrist is also computed locally for visualization:

```
reconWrist = reconElbow + faLengthMm × worldDirFA     // IMU display panel only
```

The critical distinction: for Pipeline 4, only the **direction** is passed. The fusion controller re-computes the wrist position itself using its own `finalElbow` output. This prevents the wrist from floating relative to the fused elbow when UA and FA use different sources.

#### 2.3 Quaternion Convention

The BNO085 sensor reports quaternions as `[qw, qx, qy, qz]` via the WebSocket packet fields `{qw, qx, qy, qz}`. The `packetToQuat` function converts this directly to the internal `Quaternion = [w, x, y, z]` type used by `quaternionUtils.ts`.

The quaternion represents the rotation from the sensor body frame to the ENU world frame. When the sensor is upright with its Y-axis pointing North, q is the identity [1, 0, 0, 0]. The sandwich product `q ⊗ v ⊗ q*` then returns v unchanged — the sensor body frame coincides with the world frame.

---

### Part 3 — Stereo Reliability Evaluation (`evalStereoReliable`)

**Source:** `useIMUFusionController.ts` lines 236–259

Before the state machine can decide whether to trigger IMU correction, it must know whether the current stereo reading is trustworthy. The `evalStereoReliable` function applies a cascade of gates in order. The first failing gate short-circuits and returns the failure reason.

#### Gate 1 — Simulation Override

```
if (simProx) → { reliable: false, reason: 'Simulated proximal joint failure' }
if (simDist) → { reliable: false, reason: 'Simulated distal joint failure' }
```

Simulation overrides are applied first, before any real data checks, so that simulated failures are indistinguishable from real ones throughout the entire pipeline.

#### Gate 2 — Joint Presence

```
if (!proxJoint) → { reliable: false, reason: 'Proximal joint missing' }
if (!distJoint) → { reliable: false, reason: 'Distal joint missing' }
```

If either joint coordinate is null (MediaPipe did not return it), the segment is not usable.

#### Gate 3 — Jitter Status (`reliable` flag from `usePoseFailureCorrection`)

```
if (!proxStatus?.reliable) → { reliable: false, reason: 'Proximal joint unreliable (failureType)' }
if (!distStatus?.reliable) → { reliable: false, reason: 'Distal joint unreliable (failureType)' }
```

The `JointFailureStatus.reliable` field from `usePoseFailureCorrection` encodes the outcome of the EMA jitter corrector:

| `failureType` | `reliable` | Meaning |
|---|---|---|
| `'none'` | `true` | Normal frame; EMA applied at `normalSmoothingAlpha = 0.9` |
| `'light_jitter'` | `true` | Spike detected; corrected with `lightSmoothingAlpha = 0.6`; still usable |
| `'heavy_jitter'` | `false` | Large spike; corrected with `heavySmoothingAlpha = 0.3`; not trusted |
| `'occlusion'` | `false` | Joint returned null; EMA state reset |

Light jitter joints are corrected and still passed through; only heavy jitter and occlusion set `reliable = false` and trigger IMU fallback.

#### Gate 4 — Anatomical Segment Length

```
if (calibLength > 0):
    len = dist3d(proxJoint, distJoint)          // Euclidean distance in mm
    if |len − calibLength| / calibLength > tolerance:
        → { reliable: false, reason: 'Segment length Xmm vs calib Ymm (>25% deviation)' }
```

This gate is active only after a successful calibration (`calibLength > 0`). It detects when MediaPipe tracks the wrong joint (e.g. mistaking the elbow for the wrist, producing a wildly incorrect segment length). The default tolerance is 0.25 (25%). The segment length is the straight-line Euclidean distance:

```
len = sqrt((prox.x − dist.x)² + (prox.y − dist.y)² + (prox.z − dist.z)²)
```

If all four gates pass, the function returns `{ reliable: true, reason: null }`.

#### FA-specific evaluation (inline in `_processFusionFrame`)

The forearm segment has a modified evaluation that uses `finalElbow` (the output of the UA state machine) as its reference point rather than the raw stereo elbow:

```
if (!effectiveElbow)       → { reliable: false, reason: 'Elbow unavailable' }
if (!effStereoWrist)       → { reliable: false, reason: 'Wrist missing' / 'Simulated wrist failure' }
if (!wristStatus?.reliable)→ { reliable: false, reason: 'Wrist unreliable (failureType)' }
if (calibFaLengthMm > 0):
    faLen = dist3d(effectiveElbow, effStereoWrist)
    if |faLen − calibFaLengthMm| / calibFaLengthMm > tolerance:
        → { reliable: false, reason: 'FA length ...' }
```

Using `finalElbow` (not `stereoElbow`) for the FA length check ensures geometric consistency: if UA is in IMU_CORRECTION and stereo elbow is missing, the FA segment correctly sees `effectiveElbow = null` and immediately returns `reliable: false`.

---

### Part 4 — Frame-by-Frame Processing (`_processFusionFrame`)

**Source:** `useIMUFusionController.ts` lines 472–606

`_processFusionFrame` is the single function that executes all fusion logic. It is called once per stereo frame from `IMULabView.onCorrectedPose`. The following describes every step in execution order.

#### 4.1 Input Preparation and Simulation Overrides

The function receives a `FusionFrameInput` struct (see §6.2 for the full interface). The first action is to apply simulation overrides:

```typescript
const effStereoShoulder = simulated.shoulder ? null : stereoShoulder;
const effStereoElbow    = simulated.elbow    ? null : stereoElbow;
const effStereoWrist    = simulated.wrist    ? null : stereoWrist;
```

`simulated` is a `SimulatedFailures` struct `{ shoulder: boolean, elbow: boolean, wrist: boolean }`. Setting a field to true replaces the corresponding stereo position with null for the entire remainder of the frame — the simulated dropout is physically indistinguishable from a real MediaPipe failure at every downstream gate.

#### 4.2 Shoulder Anchor Update

The anchor update decision requires three conditions all to be true simultaneously:

```
shoulderStatusReliable = (!simulated.shoulder)
                       && (stereoShoulder !== null)
                       && (byJoint['rightShoulder']?.reliable !== false)
```

If all three hold, the anchor is updated:

```typescript
s.shoulder = {
    pos:        { x: stereoShoulder.x, y: stereoShoulder.y, z: stereoShoulder.z },
    capturedAt: nowMs,    // performance.now() timestamp
};
```

Note that the update uses the raw `stereoShoulder` (not `effStereoShoulder`). The simulation override has already been captured in the `shoulderStatusReliable` condition: if `simulated.shoulder = true`, the condition short-circuits to false and no update occurs.

#### 4.3 Effective Shoulder Computation

After the potential update, the anchor age is checked:

```
anchorAgeMs = nowMs − s.shoulder.capturedAt    (or Infinity if no anchor)
anchorValid = anchorAgeMs ≤ shoulderAnchorMaxAgeMs    (default: 500 ms)
effectiveShoulder = anchorValid ? s.shoulder.pos : null
```

The `shoulderAnchorState` diagnostic field is set based on two conditions:

```
if (!anchorValid) → 'expired'
else if (shoulderStatusReliable this frame) → 'live'
else → 'frozen'
```

#### 4.4 IMU Availability Gates

**Upper arm (UA) IMU availability:**

```
imuUAAvailable = (imuElbow !== null)
               && calibrationValid
               && (imu01AgeMs ≤ imuFreshnessMs)     // default: 150 ms
               && (effectiveShoulder !== null)
```

All four conditions must hold. An expired shoulder anchor makes IMU UA unavailable even if the sensor data is fresh, because the elbow position cannot be computed without an anchor:

```
reconElbow = effectiveShoulder + uaLength × worldDirUA     // requires effectiveShoulder
```

**Forearm base availability (direction only, before knowing finalElbow):**

```
imuFABaseAvailable = (imuFADir !== null)
                   && calibrationValid
                   && (imu02AgeMs ≤ imuFreshnessMs)     // default: 150 ms
```

**Forearm full availability (after UA state machine produces finalElbow):**

```
imuFAAvailable = imuFABaseAvailable && (finalElbow !== null)
```

This is evaluated after the UA state machine runs. If UA output is null (UA is UNAVAILABLE), FA cannot produce a wrist position even if the forearm sensor data is perfectly fresh — there is no elbow to attach the forearm to.

#### 4.5 UA State Machine and Output (`advanceSeg`)

`evalStereoReliable` is called for the upper arm segment using `effStereoShoulder` and `effStereoElbow`. The result is passed to `advanceSeg` for the UA segment. See §5 for the full state machine logic. The output is assigned:

```typescript
const finalElbow = advanceSeg(
    s.ua, effStereoElbow, imuElbow,
    uaEval.reliable, uaEval.reason,
    imuUAAvailable, cfg, nowMs,
);
```

#### 4.6 IMU Target Wrist Computation

After `finalElbow` is known, the IMU wrist target for the FA segment is computed:

```typescript
const imuTargetWrist: Pt3 | null =
    (imuFADir && finalElbow && calibFaLengthMm > 0)
    ? {
        x: finalElbow.x + calibFaLengthMm * imuFADir[0],
        y: finalElbow.y + calibFaLengthMm * imuFADir[1],
        z: finalElbow.z + calibFaLengthMm * imuFADir[2],
      }
    : null;
```

The formula is: **fused elbow position + calibrated forearm length × normalized forearm world direction.** The critical property is that `finalElbow` is the output of the UA state machine — it may be a stereo position, an IMU position, or a blended value. The wrist is always geometrically attached to whatever the elbow actually is, not to an independent IMU-only reconstruction.

#### 4.7 FA State Machine and Output

FA stereo reliability is evaluated inline (not via `evalStereoReliable`, because the FA proximal joint is the fused elbow, not a raw stereo joint). Then `advanceSeg` runs for the forearm:

```typescript
const finalWrist = advanceSeg(
    s.fa, effStereoWrist, imuTargetWrist,
    faEval.reliable, faEval.reason,
    imuFAAvailable, cfg, nowMs,
);
```

#### 4.8 Diagnostics Computation and Output

Blend alphas for the UI overlay are computed as:

```typescript
blendAlphaUA = (ua.state === 'IMU_CORRECTION')
    ? min(1, ua.transitionFrame / blendFrames)
    : (ua.state === 'RECOVERY' && ua.recoveryConfirmed)
    ? min(1, ua.transitionFrame / blendFrames)
    : 0
```

In `IMU_CORRECTION`, `blendAlpha = 0` means fully at the old stereo position (first frame), `blendAlpha = 1` means fully at the IMU position (from frame `blendFrames` onward). In RECOVERY blending phase, `blendAlpha = 1` means fully stereo (fully recovered). The diagnostic naming is consistent: alpha tracks how far along the current transition is.

The function returns a `FusionFrameResult`:

```typescript
{
    finalShoulder: effectiveShoulder,
    finalElbow,
    finalWrist,
    effectiveShoulder,
    diagnostics,
}
```

---

### Part 5 — State Machine (`advanceSeg`)

**Source:** `useIMUFusionController.ts` lines 270–429

`advanceSeg` advances one segment's state machine by one frame. It is a pure function of the current state plus the per-frame inputs; it mutates the `SegState` in-place and returns the output position.

The internal state per segment is:

```typescript
interface SegState {
    state:              SegmentState;      // 'STEREO' | 'IMU_CORRECTION' | 'RECOVERY' | 'UNAVAILABLE'
    failureReason:      string | null;     // human-readable reason for current failure
    correctionStartedAt: number | null;   // performance.now() when IMU_CORRECTION began
    recoveryFrame:      number;           // Phase 1 frame counter within RECOVERY
    recoveryConfirmed:  boolean;          // true once Phase 1 is complete
    transitionFrame:    number;           // blend frame counter (IMU_CORRECTION or RECOVERY/blending)
    blendFrom:          Pt3 | null;       // captured position at start of blend
    lastPos:            Pt3 | null;       // output from previous frame
}
```

#### 5.1 Trigger Conditions (STEREO → IMU_CORRECTION)

The fusion trigger fires when stereo reliability fails and IMU data is available:

```
FROM STEREO:
  if (!stereoReliable):
      if (imuAvailable):
          → IMU_CORRECTION
              failureReason = stereoReason         // from evalStereoReliable
              correctionStartedAt = nowMs
              recoveryFrame = 0
              recoveryConfirmed = false
              transitionFrame = 0
              blendFrom = lastPos ?? stereoPos     // start of outgoing blend
      else:
          → UNAVAILABLE
              failureReason = stereoReason ?? 'IMU also unavailable'
              correctionStartedAt = null
  else:
      failureReason = null    // clear any stale reason; stay in STEREO
```

The `blendFrom` assignment — `lastPos ?? stereoPos` — captures the elbow/wrist position at the exact frame when the trigger fires. `lastPos` is the output from the previous frame (which was a stereo reading), so the blend starts smoothly from where stereo left off. If `lastPos` is null (very first frame), it falls back to the current stereo position.

**Practical triggers (common causes of stereoReliable = false):**
1. MediaPipe returns null for the elbow or wrist (heavy occlusion, limb outside frame)
2. Jitter corrector flags heavy jitter (`failureType = 'heavy_jitter'`, `reliable = false`)
3. Anatomical segment length deviation > 25% (MediaPipe tracking the wrong joint)
4. Simulation override active on the joint

#### 5.2 IMU_CORRECTION Output and Blend-In

During IMU_CORRECTION, `transitionFrame` increments each frame (starting from 0 on entry, incrementing at the bottom of `advanceSeg` so frame 1 has `transitionFrame = 1` when the blend alpha is computed):

```
transitionFrame++ each frame in IMU_CORRECTION
alpha = min(1, transitionFrame / blendFrames)      // clamp to [0, 1]
output = lerp(blendFrom, imuPos, alpha)
```

The lerp function:

```
lerp(a, b, t) = a + t × (b − a)
              = { x: a.x + t×(b.x − a.x), y: ..., z: ... }
              with t = clamp(alpha, 0, 1)
```

Frame-by-frame example with default `blendFrames = 4`:

| Frame in IMU_CORRECTION | transitionFrame | alpha | Output |
|---|---|---|---|
| 1 (trigger frame) | 1 | 0.25 | 75% last stereo + 25% IMU |
| 2 | 2 | 0.50 | 50% last stereo + 50% IMU |
| 3 | 3 | 0.75 | 25% last stereo + 75% IMU |
| 4+ | ≥4 | 1.00 | 100% IMU (fully fused) |

The blend-in prevents a visible pop when the trigger fires. After `blendFrames` frames, the output is indistinguishable from pure IMU.

#### 5.3 Transition from IMU_CORRECTION

```
FROM IMU_CORRECTION:
  if (stereoReliable):
      → RECOVERY
          recoveryFrame = 0
          recoveryConfirmed = false
          transitionFrame = 0
          // blendFrom will be captured when Phase 1 completes
  else if (!imuAvailable):
      → UNAVAILABLE
          correctionStartedAt = null
  else:
      stay in IMU_CORRECTION (stereo still unreliable, IMU still fresh)
```

#### 5.4 Reversion Conditions — RECOVERY State

The reversion from IMU back to stereo happens through two explicit phases:

**Phase 1 — Confirming:**

```
FROM IMU_CORRECTION → RECOVERY (stereo returns):
  recoveryFrame = 0
  recoveryConfirmed = false

Each frame in RECOVERY where stereoReliable:
  recoveryFrame++
  if (recoveryFrame >= recoveryConfirmFrames):    // default: 5
      recoveryConfirmed = true
      transitionFrame = 0
      blendFrom = lastPos ?? imuPos               // capture current position for blend

Output during Phase 1:
  imuPos ?? lastPos     // pure IMU; no blending toward stereo yet
```

Phase 1 requires `recoveryConfirmFrames` (default: 5) consecutive reliable stereo frames before anything changes in the output. A single transient stereo frame at the edge of an occlusion has zero effect on the arm's displayed position.

**Phase 2 — Blending:**

```
Each frame in RECOVERY where recoveryConfirmed and stereoReliable:
  transitionFrame++
  if (transitionFrame >= blendFrames):    // default: 4
      → STEREO
          failureReason = null
          correctionStartedAt = null
          recoveryFrame = 0
          recoveryConfirmed = false
          transitionFrame = 0
          blendFrom = null

Output during Phase 2:
  lerp(blendFrom, stereoPos, alpha)     // alpha = min(1, transitionFrame / blendFrames)
```

Phase 2 blends from the captured IMU position (at the moment Phase 1 completed) toward the current live stereo position. After `blendFrames` frames the blend is complete and the segment returns to pure STEREO.

Frame-by-frame example of full recovery cycle (confirm=5, blend=4):

| Frame | Event | Phase | Output |
|---|---|---|---|
| 0 | Stereo fails | → IMU_CORRECTION | Blend-in toward IMU |
| 1–4 | IMU active | IMU_CORRECTION | 100% IMU (blended in) |
| 5 | Stereo returns | → RECOVERY/confirming | 100% IMU (unchanged) |
| 6 | | confirming (2/5) | 100% IMU |
| 7 | | confirming (3/5) | 100% IMU |
| 8 | | confirming (4/5) | 100% IMU |
| 9 | 5th good frame | → RECOVERY/blending (1/4) | 75% IMU + 25% stereo |
| 10 | | blending (2/4) | 50% IMU + 50% stereo |
| 11 | | blending (3/4) | 25% IMU + 75% stereo |
| 12 | | blending (4/4) | → STEREO; 100% stereo |

**RECOVERY interruption:**

```
FROM RECOVERY, if (!stereoReliable):
  recoveryConfirmed = false
  if (imuAvailable):
      → IMU_CORRECTION
          blendFrom = lastPos ?? imuPos    // smooth re-entry at current output position
  else:
      → UNAVAILABLE
```

If stereo fails during Phase 1, the segment reverts immediately to IMU_CORRECTION. The `recoveryFrame` counter is reset so the next recovery attempt requires the full confirmation window again. If stereo fails during Phase 2, the same reversion occurs (Phase 2 does not have special interruption protection — by Phase 2, stereo has been confirmed reliable for 5 consecutive frames, making interruption unlikely in practice).

#### 5.5 UNAVAILABLE State

```
FROM UNAVAILABLE:
  if (stereoReliable):
      → RECOVERY               // stereo-first priority
          recoveryFrame = 0
          recoveryConfirmed = false
          transitionFrame = 0
          blendFrom = null      // null means "snap to target" in computeBlended
  else if (imuAvailable):
      → IMU_CORRECTION
          correctionStartedAt = nowMs
          blendFrom = null      // snap to IMU immediately (no prior position)
  else:
      stay in UNAVAILABLE; output = null
```

The stereo-first priority is enforced by the if/else-if ordering. When both stereo and IMU become available simultaneously after a complete dropout, the path is always through RECOVERY (with the 5-frame confirmation requirement) rather than immediately snapping to IMU.

When `blendFrom = null` on entry to either RECOVERY or IMU_CORRECTION (the case from UNAVAILABLE), the `computeBlended` function snaps immediately to the target rather than blending from a ghost position:

```typescript
function computeBlended(seg, liveTarget, blendFrames) {
    if (!liveTarget) return seg.lastPos;       // hold last position if target is missing
    if (!seg.blendFrom) return liveTarget;     // snap: no known starting position
    const alpha = min(1, seg.transitionFrame / max(1, blendFrames));
    return lerp3(seg.blendFrom, liveTarget, alpha);
}
```

---

### Part 6 — Integration: How `IMULabView` Drives Pipeline 4

**Source:** `IMULabView.tsx` lines 1473–1699

The full per-frame integration sequence, executed inside `onCorrectedPose` on every stereo frame:

```
1. Receive (correctedPose, trackedCount, jointStatuses) from Pipeline 3
2. Extract shoulder, elbow, wrist from correctedPose
3. Compute arm geometry: uaLen = dist3D(shoulder, elbow), faLen = dist3D(elbow, wrist)
4. Validate geometry: segOk = (SEG_MIN_MM < uaLen < SEG_MAX_MM) && ...
5. Evaluate jitter gates: rightArmClean, rightArmCalibOk from jointStatuses
6. Evaluate calibrated length gate: segCalibOk = ±20% of calibrated lengths
7. Evaluate position velocity gate: 120mm/frame threshold on elbow and wrist
8. Update lastReliableRef if armReliable
9. Call getEffectiveShoulderRef.current(nowMs) → effectiveShoulder
10. Compute imu01ReconAgeMs, imu02ReconAgeMs from getRawIMU packet timestamps
11. If imu01ReconAvail (500ms freshness for display):
    a. q_ua = packetToQuat(imu01Packet)
    b. boneInImuWorld = rotateVectorByQuaternion(q_ua, calibData.uaBoneLocalDir)
    c. worldDirUA = normalize(R_ua · boneInImuWorld)
    d. reconElbow = effectiveShoulder + uaLengthMm × worldDirUA
12. If imu02ReconAvail (500ms freshness for display):
    a. q_fa = packetToQuat(imu02Packet)
    b. boneInImuWorld_FA = rotateVectorByQuaternion(q_fa, calibData.faBoneLocalDir)
    c. worldDirFA = normalize(R_fa · boneInImuWorld_FA)
    d. imuFAWorldDir = [worldDirFA.x, worldDirFA.y, worldDirFA.z]     ← direction only
    e. reconWrist = reconElbow + faLengthMm × worldDirFA               ← for display only
13. Write pure IMU pose to imuReconPoseRef (center panel display)
14. Call processFusionFrameRef.current(fusionInput) → fusionResult
15. Build fusedPose: replace rightShoulder/Elbow/Wrist in correctedPose with fusionResult
16. Write fusedPose, fusionResult.diagnostics to state
```

**Important freshness distinction:** steps 11 and 12 use a 500ms IMU freshness gate for the pure IMU display panel. Step 14 uses the fusion controller's `imuFreshnessMs = 150ms` gate internally. This means IMU data that is 200–500ms old will appear in the pure IMU display panel but will not trigger Pipeline 4 fusion — the fusion controller will treat it as stale and enter UNAVAILABLE instead.

#### 6.1 The One-Frame Lag

`getEffectiveShoulderRef.current(nowMs)` (step 9) is called **before** `processFusionFrame` (step 14). This means `effectiveShoulder` used for IMU reconstruction in step 11 is the anchor from the **previous** frame's update. When `processFusionFrame` runs, it may update the anchor with the new stereo shoulder — but that update is not visible until the next frame.

This one-frame lag is acceptable because:
- At 30 fps, one frame is ~33ms — negligible for a shoulder position that changes slowly
- The alternative (reading the anchor after `processFusionFrame`) would require restructuring the data flow significantly
- The fusion controller's own output uses the freshly-updated anchor internally (`finalElbow` uses the just-updated `effectiveShoulder` from within `_processFusionFrame`)

#### 6.2 `FusionFrameInput` Interface

```typescript
interface FusionFrameInput {
    stereoShoulder:   Pt3 | null;       // raw stereo shoulder (null = not tracked)
    stereoElbow:      Pt3 | null;       // raw stereo elbow
    stereoWrist:      Pt3 | null;       // raw stereo wrist
    imuElbow:         Pt3 | null;       // IMU-reconstructed elbow (reconElbow from step 11d)
    imuFADir:         [number,number,number] | null;  // normalized forearm direction (worldDirFA)
    jointStatuses:    JointFailureStatus[];    // per-joint reliable/failureType from Pipeline 3
    calibrationValid: boolean;          // true if calibration exists and quality !== 'failed'
    calibUaLengthMm:  number;           // upper arm calibrated length (0 = invalid)
    calibFaLengthMm:  number;           // forearm calibrated length (0 = invalid)
    imu01AgeMs:       number;           // ms since last packet from imu_01
    imu02AgeMs:       number;           // ms since last packet from imu_02
    simulated:        SimulatedFailures; // { shoulder, elbow, wrist } boolean flags
    nowMs:            number;           // performance.now() timestamp
}
```

#### 6.3 `FusionFrameResult` Interface

```typescript
interface FusionFrameResult {
    finalShoulder:    Pt3 | null;       // effective shoulder anchor (live or frozen)
    finalElbow:       Pt3 | null;       // fused elbow output (stereo, IMU, or blend)
    finalWrist:       Pt3 | null;       // fused wrist output
    effectiveShoulder: Pt3 | null;      // same as finalShoulder (convenience alias)
    diagnostics:      FusionDiagnostics;
}
```

---

### Part 7 — How to Use Pipeline 4

This section provides a practical guide for integrating and configuring Pipeline 4 in the application.

#### 7.1 Prerequisites

Before Pipeline 4 can produce IMU output, all of the following must be true:

1. **Two cameras calibrated** — stereo calibration JSON loaded; DLT triangulation producing metric 3D positions
2. **MediaPipe running** — pose detection active; joints being tracked
3. **Both IMU sensors connected** — `imu_01` (upper arm) and `imu_02` (forearm) sending packets to the WebSocket endpoint
4. **ALS calibration completed** — three poses collected and solved; `armCalibration.quality !== 'failed'`; both `uaLengthMm` and `faLengthMm` > 0

The IMU Lab tab in the application walks through all four prerequisites with real-time status indicators.

#### 7.2 Performing the ALS Calibration

1. **Pose 1** — extend the arm to a specific orientation (e.g. arm straight out in front). Hold still for the countdown. The app samples ~50 frames of IMU quaternions and the stereo joint directions.
2. **Pose 2** — move the arm to a clearly different orientation (e.g. arm raised above head). Diverse poses improve the conditioning of the Wahba solve.
3. **Pose 3** — a third distinct orientation (e.g. arm out to the side). The three poses should cover different positions in 3D space.
4. The solver (`solveALSMultiInit`) runs automatically after pose 3 and displays:
   - Mean residual (target: < 5°; excellent: < 2°)
   - Gravity alignment error (target: < 2°)
   - Calibration quality badge (Good / OK / Poor / Failed)
   - Ambiguity warning if two solutions produce similar residuals but different physical predictions

If the calibration shows Poor quality or an ambiguity warning, recollect with more geometrically diverse poses — avoid three poses that all lie in the same plane.

#### 7.3 Runtime Monitoring

The Pipeline 4 diagnostics panel (visible in the IMU Reconstruction tab) shows:

- **UA / FA state badges** — current state of each segment (STEREO / IMU / RECOVERY / UNAVAILABLE)
- **Recovery phase** — CONFIRMING (counting frames) or BLENDING (lerping back)
- **Shoulder anchor** — LIVE / FROZEN / EXPIRED with age in ms
- **IMU sensor ages** — time since last packet from each sensor
- **Failure reasons** — the exact gate that caused each segment to switch away from stereo

Watch for:
- `'expired'` shoulder anchor → IMU elbow will be unavailable; check if the subject's shoulder is visible
- `imu01AgeMs > 150` → upper arm IMU is stale; check WebSocket connection
- Repeated `'heavy_jitter'` failures → camera/lighting issue causing pose instability
- `'Segment length Xmm vs calib Ymm'` → significant segment length mismatch; may indicate calibration drift or extreme occlusion

#### 7.4 `createFusionController()` Factory API

For testing and non-React use cases:

```typescript
import { createFusionController } from './useIMUFusionController';

const ctrl = createFusionController({
    recoveryConfirmFrames: 5,     // optional overrides
    blendFrames: 4,
    imuFreshnessMs: 150,
    shoulderAnchorMaxAgeMs: 500,
    segLengthTolerance: 0.25,
});

// Per-frame call:
const result: FusionFrameResult = ctrl.processFusionFrame(input);

// Read shoulder anchor without advancing state:
const shoulder: Pt3 | null = ctrl.getEffectiveShoulder(performance.now());

// Reset all state (e.g. after subject change or calibration update):
ctrl.reset();
```

The factory is identical in behavior to the React hook (`useIMUFusionController`). The hook is a thin wrapper that stores the same internal `FusionState` in a `useRef` and delegates all computation to the shared `_processFusionFrame` function. State is never stored in React component state — it lives in refs to avoid re-renders on every frame.

---

### Fusion State Machine — Complete Transition Table

| From | Condition | To | Action |
|---|---|---|---|
| STEREO | `!stereoReliable && imuAvailable` | IMU_CORRECTION | `blendFrom = lastPos ?? stereoPos`; `transitionFrame = 0` |
| STEREO | `!stereoReliable && !imuAvailable` | UNAVAILABLE | `correctionStartedAt = null` |
| STEREO | `stereoReliable` | STEREO | Stay; `failureReason = null` |
| IMU_CORRECTION | `stereoReliable` | RECOVERY | `recoveryFrame = 0`; `recoveryConfirmed = false` |
| IMU_CORRECTION | `!imuAvailable` | UNAVAILABLE | `correctionStartedAt = null` |
| IMU_CORRECTION | `!stereoReliable && imuAvailable` | IMU_CORRECTION | Stay; `transitionFrame++`; blend toward IMU |
| RECOVERY/confirming | `!stereoReliable && imuAvailable` | IMU_CORRECTION | `recoveryConfirmed = false`; `blendFrom = lastPos ?? imuPos` |
| RECOVERY/confirming | `!stereoReliable && !imuAvailable` | UNAVAILABLE | |
| RECOVERY/confirming | `stereoReliable` (not enough frames) | RECOVERY/confirming | `recoveryFrame++` |
| RECOVERY/confirming | `recoveryFrame >= recoveryConfirmFrames` | RECOVERY/blending | `blendFrom = lastPos ?? imuPos`; `transitionFrame = 0` |
| RECOVERY/blending | `!stereoReliable && imuAvailable` | IMU_CORRECTION | `recoveryConfirmed = false`; `blendFrom = lastPos` |
| RECOVERY/blending | `!stereoReliable && !imuAvailable` | UNAVAILABLE | |
| RECOVERY/blending | `stereoReliable` (not complete) | RECOVERY/blending | `transitionFrame++`; blend toward stereo |
| RECOVERY/blending | `transitionFrame >= blendFrames` | STEREO | Clear all blend state |
| UNAVAILABLE | `stereoReliable` | RECOVERY | `blendFrom = null`; `recoveryFrame = 0` |
| UNAVAILABLE | `!stereoReliable && imuAvailable` | IMU_CORRECTION | `blendFrom = null`; snap to IMU |
| UNAVAILABLE | `!stereoReliable && !imuAvailable` | UNAVAILABLE | Stay; `output = null` |

---

### Fusion Configuration Reference

| Parameter | Type | Default | Description |
|---|---|---|---|
| `shoulderAnchorMaxAgeMs` | `number` | `500` | Milliseconds before a frozen shoulder anchor expires. At 50 Hz IMU rate, 500 ms ≈ 25 packets. After expiry, `effectiveShoulder = null` and `imuUAAvailable` is false. |
| `recoveryConfirmFrames` | `number` | `5` | Consecutive reliable stereo frames required before Phase 2 (blending) begins. One or two transient frames at occlusion boundary have no effect. At 30 fps, 5 frames ≈ 167 ms of confirmed stereo. |
| `blendFrames` | `number` | `4` | Number of frames for each linear blend transition. Applies to both the trigger blend-in (stereo → IMU) and the recovery blend-out (IMU → stereo). 4 frames ≈ 133 ms at 30 fps. |
| `imuFreshnessMs` | `number` | `150` | Maximum age (ms) of a BNO085 packet for it to be considered fresh for fusion. Stale IMU data causes visible drift during occlusion. Much stricter than the 500 ms display threshold. |
| `segLengthTolerance` | `number` | `0.25` | Maximum fractional deviation of the current stereo segment length from the calibrated length before stereo is considered unreliable. At 25%, an upper arm calibrated to 300 mm must measure between 225 mm and 375 mm. |

---

### Fusion Diagnostics Reference

| Field | Type | Description |
|---|---|---|
| `uaState` | `SegmentState` | Current state of the upper arm segment |
| `faState` | `SegmentState` | Current state of the forearm segment |
| `uaRecoveryPhase` | `'confirming' \| 'blending' \| null` | Sub-phase within RECOVERY; null when not in RECOVERY |
| `faRecoveryPhase` | `'confirming' \| 'blending' \| null` | Sub-phase for forearm RECOVERY |
| `shoulderAnchorState` | `'live' \| 'frozen' \| 'expired'` | Whether the shoulder anchor was updated this frame (live), is held from a previous frame (frozen), or has expired |
| `shoulderAnchorAgeMs` | `number` | Milliseconds since the shoulder anchor was last updated; 9999 if no anchor |
| `uaFailureReason` | `string \| null` | Human-readable string from the gate that caused the UA trigger; null in STEREO |
| `faFailureReason` | `string \| null` | Human-readable failure reason for the forearm segment |
| `uaCorrectionActiveMs` | `number` | Milliseconds elapsed in IMU_CORRECTION for the upper arm; 0 otherwise |
| `faCorrectionActiveMs` | `number` | Same for the forearm |
| `uaRecoveryFrame` | `number` | Phase 1 confirmation frame counter; 0 when not confirming |
| `faRecoveryFrame` | `number` | Same for forearm |
| `blendAlphaUA` | `0–1` | Blend fraction for upper arm: 0 = at start of transition, 1 = at target (IMU or stereo) |
| `blendAlphaFA` | `0–1` | Same for forearm |
| `imu01AgeMs` | `number` | Age of last imu_01 WebSocket packet in ms; 9999 if never received |
| `imu02AgeMs` | `number` | Age of last imu_02 WebSocket packet in ms |
| `imuCalibrationValid` | `boolean` | Whether a non-failed calibration with positive segment lengths is loaded |
| `fullyAvailable` | `boolean` | All three joints (shoulder, elbow, wrist) are non-null this frame |
| `simulated` | `SimulatedFailures` | Echo of the `{ shoulder, elbow, wrist }` simulation overrides applied this frame |

---

### Pipeline 4 Bug Fixes

Eight issues were identified and resolved. The first four are critical/high correctness bugs; the remainder cover visualization integrity, timestamp validation, geometric consistency, and test coverage.

#### Issue 1 — Forearm Positional Dependency (Critical)

**Before:** `imuWrist` was pre-computed from `reconElbow` in `IMULabView.tsx` using the independently reconstructed IMU elbow. When the UA segment stayed in STEREO but the FA segment switched to IMU_CORRECTION, the wrist was anchored to the IMU-only elbow rather than the fused elbow, causing visible geometric inconsistency.

**After:** `imuFADir` (a normalized direction vector) is passed instead. The fusion controller computes `imuTargetWrist = finalElbow + calibFaLengthMm × imuFADir` using the fused elbow.

---

#### Issue 2 — Unified Shoulder Anchor (Critical)

**Before:** `IMULabView.tsx` maintained `shoulderAnchorRef` independently. That anchor did not check `simulatedFailures`, so simulated shoulder occlusions did not affect the anchor — the reconstruction continued using the last real shoulder position while displaying the simulated failure state.

**After:** `shoulderAnchorRef` removed from `IMULabView`. The fusion controller is the single owner; `getEffectiveShoulder(nowMs)` is the canonical read path.

---

#### Issue 3 — Recovery Hysteresis (High)

**Before:** The RECOVERY state immediately began blending toward stereo on the first reliable stereo frame after occlusion. One transient reliable frame from MediaPipe at the edge of an occlusion was enough to trigger a visible blend, which then reversed as occlusion continued.

**After:** Two-phase RECOVERY with `recoveryConfirmFrames` confirmation gate (5 frames by default).

---

#### Issue 4 — UNAVAILABLE Source Priority (High)

**Before:** In the UNAVAILABLE case, the controller checked IMU availability before stereo, so when both became available simultaneously the arm would enter IMU_CORRECTION instead of RECOVERY.

**After:** Stereo checked first — the if/else-if ordering in the UNAVAILABLE case ensures the path is always through RECOVERY (with hysteresis) when stereo is available.

---

#### Issue 5 — Remove Misleading Stereo Fallbacks

**Before (IMULabView):** `validationArm` fell back to `stereoArm` when IMU was unavailable, making the validation overlay show stereo data labeled as IMU.

**After:** `validationArm` returns `{ shoulder: null, elbow: null, wrist: null }` when IMU is unavailable.

**Before (IMUReconstructionView):** The IMU skeleton panel mirrored stereo joint positions when `imuReconstructionPose` was null.

**After:** When IMU reconstruction is unavailable, the panel shows an explicit "IMU reconstruction unavailable" placeholder instead of a skeleton.

---

#### Issue 6 — Timestamp Synchronization

The existing freshness gates (150 ms for fusion, 500 ms for display) handle the practical synchronization requirement at 30 fps stereo and 50–100 Hz IMU. Hardware-level synchronization is not possible with the current architecture (WebSocket receipt time ≠ sensor acquisition time). This limitation is documented in the hook source.

---

#### Issue 7 — Geometric Consistency

Segment-length consistency is maintained as a consequence of Issues 1 and 3:
- The forearm wrist is always derived from the fused elbow (Issue 1 fix), ensuring no gap between elbow and wrist
- The confirmation gate prevents premature blending to an unchecked stereo position (Issue 3 fix)
- The existing segment-length gate (`segLengthTolerance = 0.25`) continues to reject stereo frames where MediaPipe grabs the wrong joint

---

#### Issue 8 — Automated Test Suite

See [Automated Test Suite](#automated-test-suite) below.

---

### Automated Test Suite

The fusion controller is tested by a framework-free TypeScript runner that imports the `createFusionController()` factory directly. No React dependency, no Vite plugin — runs in a plain Node.js environment via `tsx`.

#### Run the tests

```bash
pnpm test
# or explicitly:
pnpm exec tsx src/app/hooks/__tests__/runTests.ts
```

#### Why a custom runner (not vitest)

Vitest 5.x auto-merges with `vite.config.ts`. The `@tailwindcss/vite` plugin exposes a function in its `assetsInclude` option, which Vitest passes to `path.resolve()` internally — causing a crash (`The "path" argument must be of type string. Received function`). Extracting `createFusionController()` as a pure TypeScript factory (no React import) and running tests with `tsx` avoids the plugin entirely.

#### Test cases (18 total)

| # | Test | What it verifies |
|---|---|---|
| 1 | All joints reliable | UA=STEREO, FA=STEREO; output equals stereo positions |
| 2 | Wrist occluded | FA→IMU_CORRECTION; UA stays STEREO; elbow stays stereo |
| 3 | Elbow occluded | UA→IMU_CORRECTION; fused elbow non-null |
| 4 | Elbow+wrist occluded | Both segments IMU_CORRECTION; both joints non-null |
| 5 | Shoulder anchor expires | `shoulderAnchorState = 'expired'`; `effectiveShoulder = null` |
| 6 | imu_01 stale | UA→UNAVAILABLE; finalElbow = null |
| 7 | imu_02 stale | FA→UNAVAILABLE; finalWrist = null |
| 8 | Calibration invalid | Both UNAVAILABLE; no fabricated joint positions |
| 9 | One-frame stereo recovery | RECOVERY/confirming; output unchanged (no premature blend) |
| 10 | Sustained recovery | Full cycle: confirming → blending → STEREO with correct frame counts |
| 11 | Intermittent stereo during recovery | `recoveryFrame` resets; reverts to IMU_CORRECTION |
| 12 | Both return from UNAVAILABLE | UA→RECOVERY (stereo-first), not IMU_CORRECTION |
| 13 | Wrist correction with stereo elbow | Wrist anchored to fused stereo elbow (Issue 1 regression) |
| 14 | IMU unavailable | UNAVAILABLE; no fabricated output |
| 15 | Full recovery from UNAVAILABLE | Reaches STEREO; coordinates are finite |
| — | Simulated shoulder | Anchor not updated when `simulated.shoulder = true` |
| — | `getEffectiveShoulder` expiry | Returns null after `shoulderAnchorMaxAgeMs` |
| — | `reset()` | Clears all state and anchor; next frame starts fresh in STEREO |

---

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
