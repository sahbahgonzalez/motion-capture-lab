# Points vs Angles: What We Actually Check

## The Critical Distinction

```
┌─────────────────────────────────────────────────────────────┐
│          ❌ WHAT WE DON'T DO (Position Checking)           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  if (knee.x === 0.45 && knee.y === 0.65) {                 │
│    ✅ Squat is correct                                      │
│  }                                                          │
│                                                             │
│  Problem: This only works for ONE specific person          │
│           at ONE specific distance from camera             │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│          ✅ WHAT WE DO (Angle Checking)                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  const angle = calculateAngle(hip, knee, ankle);           │
│  if (angle >= 90 && angle <= 135) {                        │
│    ✅ Squat is correct                                      │
│  }                                                          │
│                                                             │
│  Works for: ANY height, ANY distance, ANY camera angle     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Visual Example: Two Different People, Same Good Squat

### Person A (Tall - 6'2")
```
Camera sees:
  Hip:   {x: 0.50, y: 0.30}  ← High on screen (tall person)
  Knee:  {x: 0.48, y: 0.52}
  Ankle: {x: 0.47, y: 0.75}

❌ Position check: y-values don't match expected threshold → FAIL
✅ Angle check: calculateAngle() = 98° → Within 90-135° → PASS
```

### Person B (Short - 5'2")
```
Camera sees:
  Hip:   {x: 0.50, y: 0.45}  ← Lower on screen (short person)
  Knee:  {x: 0.48, y: 0.62}
  Ankle: {x: 0.47, y: 0.80}

❌ Position check: y-values don't match expected threshold → FAIL
✅ Angle check: calculateAngle() = 95° → Within 90-135° → PASS
```

**Both have 95° knee flexion = Both are doing proper squats! ✅**

---

## How We Calculate One Angle from Three Points

### The Math (calculateAngle function)

```typescript
// File: /utils/poseComparison.ts - Lines 4-20

function calculateAngle(
  point1: { x: number; y: number },  // Hip
  point2: { x: number; y: number },  // Knee ← VERTEX (angle measured here)
  point3: { x: number; y: number }   // Ankle
): number {
  // Use arctangent to find angles of the two lines from point2
  const radians =
    Math.atan2(point3.y - point2.y, point3.x - point2.x) -  // Angle to ankle
    Math.atan2(point1.y - point2.y, point1.x - point2.x);   // Angle to hip
  
  // Convert to degrees
  let angle = Math.abs((radians * 180.0) / Math.PI);
  
  // Normalize to 0-180 range
  if (angle > 180.0) {
    angle = 360.0 - angle;
  }
  
  return angle;  // e.g., 95
}
```

### Visual Representation

```
     Hip (point1)
      •
      |\
      | \
      |  \
      |   \  Line 1
      |    \
      |     \
      |      • Knee (point2) ← VERTEX (angle measured here)
      |     /
      |    /
      |   /  Line 2
      |  /
      | /
      |/
      • Ankle (point3)
      
    Angle = 95° (measured at knee)
```

**We calculate the angle AT the middle point (vertex) between the other two points.**

---

## Real Squat Analysis Breakdown

### Input from MediaPipe (17 points)
```json
{
  "leftShoulder": {"x": 0.35, "y": 0.30, "z": -0.15},
  "rightShoulder": {"x": 0.65, "y": 0.30, "z": -0.15},
  "leftHip": {"x": 0.40, "y": 0.48, "z": -0.12},
  "rightHip": {"x": 0.60, "y": 0.48, "z": -0.12},
  "leftKnee": {"x": 0.38, "y": 0.65, "z": -0.10},
  "rightKnee": {"x": 0.62, "y": 0.65, "z": -0.10},
  "leftAnkle": {"x": 0.37, "y": 0.85, "z": -0.08},
  "rightAnkle": {"x": 0.63, "y": 0.85, "z": -0.08},
  ... (9 more points we don't use for squats)
}
```

### What We Actually Check

#### Check #1: Knee Angle
```typescript
// Select 3 points
const point1 = landmarks.leftHip;      // {x: 0.40, y: 0.48}
const point2 = landmarks.leftKnee;     // {x: 0.38, y: 0.65}
const point3 = landmarks.leftAnkle;    // {x: 0.37, y: 0.85}

// Calculate angle
const kneeAngle = calculateAngle(point1, point2, point3);
// Result: 98°

// Check against threshold
if (kneeAngle >= 90 && kneeAngle <= 135) {
  console.log('✅ Knee angle good: 98°');
} else if (kneeAngle < 90) {
  console.log('❌ Squat too shallow');
} else {
  console.log('❌ Squat too deep - injury risk');
}
```

#### Check #2: Trunk Lean
```typescript
// Calculate midpoints
const shoulderCenter = {
  x: (0.35 + 0.65) / 2,  // = 0.50
  y: (0.30 + 0.30) / 2   // = 0.30
};
const hipCenter = {
  x: (0.40 + 0.60) / 2,  // = 0.50
  y: (0.48 + 0.48) / 2   // = 0.48
};

// Calculate angle from vertical
const trunkLean = calculateVerticalAngle(shoulderCenter, hipCenter);
// Uses: Math.atan2(dy, dx) to find angle from vertical axis
// Result: 35°

// Check against threshold
if (trunkLean >= 30 && trunkLean <= 45) {
  console.log('✅ Trunk lean good: 35°');
} else if (trunkLean < 30) {
  console.log('❌ Too upright');
} else {
  console.log('❌ Leaning too far forward');
}
```

### Final Result
```
Input:  17 landmark positions
Used:   6 landmarks (shoulders, hips, knee, ankle)
Calculated: 2 angles (knee angle, trunk lean)
Checked: 2 thresholds
Output: ✅ Good squat form (both angles in range)
```

---

## Why This Approach Works Better

### Position-Based (Doesn't work)
```
❌ Check if knee is at y: 0.65
   Problem: 
   - Tall person's knee might be at y: 0.52 (higher on screen)
   - Short person's knee might be at y: 0.72 (lower on screen)
   - Same good squat, different positions!
```

### Angle-Based (Works universally)
```
✅ Check if knee angle is 90-135°
   Works for:
   - Tall people ✅
   - Short people ✅
   - Near camera ✅
   - Far from camera ✅
   - Different camera angles ✅
   
   Because: Joint angle is independent of body size and camera position!
```

---

## Complete Threshold Reference

### Squat
```
Points used: 6
  - Left shoulder
  - Right shoulder
  - Left hip
  - Right hip
  - Left knee
  - Left ankle

Angles calculated: 2

1. Knee flexion angle:
   calculateAngle(hip, knee, ankle)
   Threshold: 90-135°
   
2. Trunk lean from vertical:
   calculateVerticalAngle(shoulderCenter, hipCenter)
   Threshold: 30-45°
```

### Push-up
```
Points used: 10
  - Left/right shoulder
  - Left/right elbow
  - Left/right wrist
  - Left/right hip
  - Left/right ankle

Angles calculated: 2

1. Elbow flexion angle:
   calculateAngle(shoulder, elbow, wrist)
   Threshold: 80-100° (when in down position)
   
2. Body alignment:
   calculateAngle(shoulderCenter, hipCenter, ankleCenter)
   Threshold: 170-180°
```

### Plank
```
Points used: 6
  - Left/right shoulder
  - Left/right hip
  - Left/right ankle

Angles calculated: 1

1. Body alignment:
   calculateAngle(shoulderCenter, hipCenter, ankleCenter)
   Threshold: 170-190°
```

### Sit-up
```
Points used: 8
  - Left/right shoulder
  - Left/right hip
  - Left/right knee

Angles calculated: 2

1. Hip flexion:
   calculateAngle(shoulder, hip, knee)
   Threshold: 70-90°
   
2. Lumbar flexion:
   calculateVerticalAngle(shoulderCenter, hipCenter)
   Threshold: 30-45°
```

---

## The Scoring System

Each angle calculation contributes to an overall pose score:

```typescript
// Example: checkSquatDown() - Line 239

function checkSquatDown(landmarks: PoseLandmarks): number {
  // Check #1: Knee angle
  const leftKneeAngle = calculateAngle(hip, knee, ankle);
  const leftKneeScore = leftKneeAngle >= 70 && leftKneeAngle <= 110 
    ? 100 
    : Math.max(0, 100 - Math.abs(90 - leftKneeAngle) * 2);
  
  // Same for right knee
  const rightKneeScore = /* similar calculation */;
  
  // Check #2: Squat depth
  const depthScore = Math.max(0, Math.min(100, (hipY - kneeY) * 500));
  
  // Average all checks
  return (leftKneeScore + rightKneeScore + depthScore) / 3;
  // Returns: 0-100 score
}
```

**If score ≥ 60 → Pose recognized ✅**  
**If score < 60 → Not in proper pose ❌**

---

## Summary

### What we CHECK:
- ✅ **Angles** calculated from groups of 3 points
- ✅ 1-2 angles per exercise
- ✅ Whether those angles fall within scientific thresholds

### What we DON'T check:
- ❌ Absolute positions of all 33 points
- ❌ X/Y coordinates against fixed values
- ❌ Every single landmark

### The Formula:
```
3 specific points 
    → Calculate 1 angle 
        → Compare to threshold 
            → Pass/Fail
```

**Example:**  
Hip + Knee + Ankle → 95° → Compare to 90-135° → ✅ PASS

That's it! We're measuring joint angles, not point positions. 🎯
