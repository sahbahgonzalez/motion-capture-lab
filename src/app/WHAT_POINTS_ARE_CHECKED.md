# What Points Are Actually Checked Against Thresholds?

## The Short Answer: **NO, we don't check all 33 points!**

We only check **SPECIFIC ANGLES** calculated from **SPECIFIC GROUPS of 3 points**.

---

## The Point Filtering Process

### Step 1: MediaPipe Detects 33 Landmarks

MediaPipe's full landmark set (we DON'T use most of these):

```
0: Nose                    17: Left pinky
1: Left eye (inner)        18: Right pinky
2: Right eye (inner)       19: Left index
3: Left eye               20: Right index
4: Right eye              21: Left thumb
5: Left eye (outer)        22: Right thumb
6: Right eye (outer)       23: Left hip  ✅ WE USE
7: Left ear               24: Right hip ✅ WE USE
8: Right ear              25: Left knee ✅ WE USE
9: Mouth (left)            26: Right knee ✅ WE USE
10: Mouth (right)          27: Left ankle ✅ WE USE
11: Left shoulder ✅ WE USE 28: Right ankle ✅ WE USE
12: Right shoulder ✅ WE USE 29: Left heel
13: Left elbow ✅ WE USE    30: Right heel
14: Right elbow ✅ WE USE   31: Left foot index
15: Left wrist ✅ WE USE    32: Right foot index
16: Right wrist ✅ WE USE
```

**We ignore 16 of the 33 landmarks** (all the detailed face/hand/foot points)

---

### Step 2: We Extract Only 17 Key Landmarks

```typescript
// File: /hooks/useMediaPipePose.ts - Lines 188-206

const poseLandmarks: PoseLandmarks = {
  nose: landmarks[0],              // ✅ Used for head pivot detection
  leftEye: landmarks[1],           // ✅ Used for head pivot detection
  rightEye: landmarks[2],          // ✅ Used for head pivot detection
  leftEar: landmarks[3],           // ✅ Used for head pivot detection
  rightEar: landmarks[4],          // ✅ Used for head pivot detection
  leftShoulder: landmarks[11],     // ✅ Used in ALL exercises
  rightShoulder: landmarks[12],    // ✅ Used in ALL exercises
  leftElbow: landmarks[13],        // ✅ Used in push-ups, planks
  rightElbow: landmarks[14],       // ✅ Used in push-ups, planks
  leftWrist: landmarks[15],        // ✅ Used in push-ups, calibration
  rightWrist: landmarks[16],       // ✅ Used in push-ups, calibration
  leftHip: landmarks[23],          // ✅ Used in ALL exercises
  rightHip: landmarks[24],         // ✅ Used in ALL exercises
  leftKnee: landmarks[25],         // ✅ Used in squats, sit-ups
  rightKnee: landmarks[26],        // ✅ Used in squats, sit-ups
  leftAnkle: landmarks[27],        // ✅ Used in ALL exercises
  rightAnkle: landmarks[28],       // ✅ Used in ALL exercises
};
```

**Only these 17 points are passed to our analysis code!**

---

### Step 3: We Calculate Specific Angles

**We DON'T check if points "fit into threshold"**  
**We check if ANGLES BETWEEN points fit into threshold**

---

## How Threshold Checking Actually Works

### Example 1: Squat - Only 2 Angles Are Checked

```typescript
// File: /utils/poseComparison.ts - Lines 569-614

case 'squat': {
  // ━━━ ANGLE CHECK #1: Knee Flexion ━━━
  // Uses: Hip + Knee + Ankle (3 points → 1 angle)
  
  const leftKneeAngle = calculateAngle(
    landmarks.leftHip,      // Point A
    landmarks.leftKnee,     // Point B (vertex)
    landmarks.leftAnkle     // Point C
  );
  // Result: 95°
  
  // ✅ THRESHOLD: Check if angle is in 90-135° range
  if (kneeAngle > 135) {
    issues.kneeAngleTooDeep = true;
  } else if (kneeAngle < 90) {
    issues.kneeAngleTooShallow = true;
  }
  
  // ━━━ ANGLE CHECK #2: Trunk Lean ━━━
  // Uses: Shoulder center + Hip center (2 points → 1 angle from vertical)
  
  const shoulderCenter = {
    x: (landmarks.leftShoulder.x + landmarks.rightShoulder.x) / 2,
    y: (landmarks.leftShoulder.y + landmarks.rightShoulder.y) / 2
  };
  const hipCenter = {
    x: (landmarks.leftHip.x + landmarks.rightHip.x) / 2,
    y: (landmarks.leftHip.y + landmarks.rightHip.y) / 2
  };
  
  const trunkLean = calculateVerticalAngle(shoulderCenter, hipCenter);
  // Result: 38°
  
  // ✅ THRESHOLD: Check if angle is in 30-45° range
  if (trunkLean > 45) {
    issues.trunkLeanExcessive = true;
  } else if (trunkLean < 30) {
    issues.trunkLeanInsufficient = true;
  }
  
  break;
}
```

**Total points used: 6 out of 17**  
**Total angles checked: 2**

Points used:
- ✅ Left shoulder
- ✅ Right shoulder  
- ✅ Left hip
- ✅ Right hip
- ✅ Left knee
- ✅ Left ankle

Points NOT used:
- ❌ Nose, eyes, ears (not relevant for squats)
- ❌ Elbows, wrists (arms free during squat)
- ❌ Right knee, right ankle (redundant - we use left side)

---

### Example 2: Push-up - Only 2 Angles Are Checked

```typescript
// File: /utils/poseComparison.ts - Lines 617-666

case 'pushup': {
  // ━━━ ANGLE CHECK #1: Elbow Flexion ━━━
  // Uses: Shoulder + Elbow + Wrist (3 points → 1 angle)
  
  const leftElbowAngle = calculateAngle(
    landmarks.leftShoulder,   // Point A
    landmarks.leftElbow,      // Point B (vertex)
    landmarks.leftWrist       // Point C
  );
  // Result: 92°
  
  // ✅ THRESHOLD: Check if angle is in 80-100° range (when in down position)
  if (avgElbowAngle < 120) {  // User is in down position
    if (avgElbowAngle < 80 || avgElbowAngle > 100) {
      issues.elbowAngleIncorrect = true;
    }
  }
  
  // ━━━ ANGLE CHECK #2: Body Alignment ━━━
  // Uses: Shoulder center + Hip center + Ankle center (3 points → 1 angle)
  
  const shoulderCenter = {
    x: (landmarks.leftShoulder.x + landmarks.rightShoulder.x) / 2,
    y: (landmarks.leftShoulder.y + landmarks.rightShoulder.y) / 2
  };
  const hipCenter = {
    x: (landmarks.leftHip.x + landmarks.rightHip.x) / 2,
    y: (landmarks.leftHip.y + landmarks.rightHip.y) / 2
  };
  const ankleCenter = {
    x: (landmarks.leftAnkle.x + landmarks.rightAnkle.x) / 2,
    y: (landmarks.leftAnkle.y + landmarks.rightAnkle.y) / 2
  };
  
  const bodyAlignment = calculateAngle(shoulderCenter, hipCenter, ankleCenter);
  // Result: 176°
  
  // ✅ THRESHOLD: Check if angle is in 170-180° range
  if (bodyAlignment < 170 || bodyAlignment > 180) {
    issues.bodyNotStraight = true;
  }
  
  break;
}
```

**Total points used: 10 out of 17**  
**Total angles checked: 2**

Points used:
- ✅ Left shoulder, right shoulder
- ✅ Left elbow, right elbow
- ✅ Left wrist, right wrist
- ✅ Left hip, right hip
- ✅ Left ankle, right ankle

Points NOT used:
- ❌ Nose, eyes, ears (face doesn't affect push-up form)
- ❌ Knees (legs should be straight, not actively checked)

---

### Example 3: Plank - Only 1 Angle Is Checked

```typescript
// File: /utils/poseComparison.ts - Lines 668-702

case 'plank': {
  // ━━━ ANGLE CHECK #1: Body Alignment ━━━
  // Uses: Shoulder center + Hip center + Ankle center (3 points → 1 angle)
  
  const shoulderCenter = {
    x: (landmarks.leftShoulder.x + landmarks.rightShoulder.x) / 2,
    y: (landmarks.leftShoulder.y + landmarks.rightShoulder.y) / 2
  };
  const hipCenter = {
    x: (landmarks.leftHip.x + landmarks.rightHip.x) / 2,
    y: (landmarks.leftHip.y + landmarks.rightHip.y) / 2
  };
  const ankleCenter = {
    x: (landmarks.leftAnkle.x + landmarks.rightAnkle.x) / 2,
    y: (landmarks.leftAnkle.y + landmarks.rightAnkle.y) / 2
  };
  
  const bodyAlignment = calculateAngle(shoulderCenter, hipCenter, ankleCenter);
  // Result: 178°
  
  // ✅ THRESHOLD: Check if angle is in 170-190° range
  if (bodyAlignment < 170) {
    issues.hipsSagging = true;
  } else if (bodyAlignment > 190) {
    issues.hipsRaised = true;
  }
  
  break;
}
```

**Total points used: 6 out of 17**  
**Total angles checked: 1**

---

## Visual Breakdown: What Gets Checked

### Squat Form Analysis

```
     👤 User's Body
     
      😊 ← Nose (NOT USED)
     
    💪   💪 ← Shoulders (USED - for trunk lean)
     
    🦴🏻   🦴 ← Hips (USED - for trunk lean + knee angle)
              ↓
              ↓ ANGLE #1: Hip-Knee-Ankle = 95°
              ↓ Threshold: 90-135°
              ↓ Result: ✅ PASS
              ↓
    🦵   🦵 ← Knees (USED - vertex of angle)
              ↓
              ↓
    🦶   🦶 ← Ankles (USED - endpoint of angle)
    
    ANGLE #2: Shoulder-to-Hip vs Vertical = 38°
    Threshold: 30-45°
    Result: ✅ PASS
```

**Only checking 2 angles, not all 17 points!**

---

### Push-up Form Analysis

```
     👤 User's Body (horizontal)
     
    😊 ← Nose (NOT USED)
    
    💪───🤜 ← Shoulder-Elbow-Wrist (USED)
              ANGLE #1: Elbow angle = 92°
              Threshold: 80-100°
              Result: ✅ PASS
    
    🦴 ← Hips (USED)
    
    🦶 ← Ankles (USED)
    
    ANGLE #2: Shoulder-Hip-Ankle alignment = 176°
    Threshold: 170-180°
    Result: ✅ PASS
```

**Only checking 2 angles, not all 10 points!**

---

## The Threshold Checking Algorithm

```typescript
// Step 1: Extract relevant points
const point1 = landmarks.leftHip;      // {x: 0.45, y: 0.50}
const point2 = landmarks.leftKnee;     // {x: 0.43, y: 0.65}
const point3 = landmarks.leftAnkle;    // {x: 0.42, y: 0.85}

// Step 2: Calculate angle using trigonometry
const angle = calculateAngle(point1, point2, point3);
// Uses: Math.atan2() to find angle at point2 (vertex)
// Result: 95°

// Step 3: Compare angle to threshold
if (angle >= 90 && angle <= 135) {
  return "PASS ✅";  // Form is good
} else if (angle < 90) {
  return "FAIL ❌ - Too shallow";
} else {
  return "FAIL ❌ - Too deep";
}
```

**We're checking if the ANGLE fits the threshold, not if the POINTS fit!**

---

## Summary Table: Points vs Angles

| Exercise | Points Used | Angles Checked | Thresholds Applied |
|----------|-------------|----------------|-------------------|
| **Squat** | 6 of 17 | 2 | Knee: 90-135°, Trunk: 30-45° |
| **Push-up** | 10 of 17 | 2 | Elbow: 80-100°, Body: 170-180° |
| **Plank** | 6 of 17 | 1 | Body: 170-190° |
| **Sit-up** | 8 of 17 | 2 | Hip: 70-90°, Lumbar: 30-45° |

---

## Common Misconception vs Reality

### ❌ Misconception:
> "The system checks if all 33 landmarks fit into position thresholds"

### ✅ Reality:
> "The system calculates 1-3 angles from specific groups of 3 points, then checks if THOSE ANGLES match scientific baselines"

---

## The Complete Flow

```
MediaPipe outputs 33 landmarks
              ↓
We filter to 17 key landmarks
              ↓
We pick 3-6 specific landmarks per exercise
              ↓
We calculate 1-3 angles between those landmarks
              ↓
We compare THOSE ANGLES to thresholds
              ↓
If angles match → Good form ✅
If angles don't match → Bad form ❌
```

---

## Concrete Example: Squat Deep Enough?

**NOT checking:** "Is the knee at position x:0.43, y:0.65?"  
**ACTUALLY checking:** "Is the knee angle 95° between 90-135°?"

```typescript
// ❌ We DON'T do this:
if (landmarks.leftKnee.y >= 0.65 && landmarks.leftKnee.y <= 0.70) {
  // Squat is good
}

// ✅ We DO this:
const kneeAngle = calculateAngle(hip, knee, ankle);
if (kneeAngle >= 90 && kneeAngle <= 135) {
  // Squat is good
}
```

**Why angles instead of positions?**
- People have different heights
- Cameras can be at different distances
- Angles are relative and work for everyone
- Scientific research measures joint angles, not XY coordinates

---

## Key Takeaways

1. **We only use 17 of MediaPipe's 33 landmarks**
2. **Each exercise only uses 6-10 of those 17 landmarks**
3. **We calculate 1-3 angles per exercise from groups of 3 points**
4. **We check if ANGLES (not positions) fit thresholds**
5. **Thresholds are scientific joint angles (in degrees)**
6. **Different exercises check different angle combinations**

The answer to your question: **No, we're not checking if 33 points fit thresholds. We're checking if 1-3 ANGLES calculated from 3-6 specific points fit thresholds!** 🎯
