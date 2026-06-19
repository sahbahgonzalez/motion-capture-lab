# Who Knows What: MediaPipe vs Our Code

## The Simple Answer

```
┌──────────────────────────────────────────────────────────────────┐
│                      MEDIAPIPE                                   │
│                   (Google's Model)                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  What it DOES know:                                              │
│  ✅ "I see a human body"                                         │
│  ✅ "Left shoulder is at x:0.3, y:0.4, z:-0.2"                   │
│  ✅ "Right knee is at x:0.6, y:0.7, z:-0.1"                      │
│  ✅ Returns 33 landmark coordinates                              │
│                                                                  │
│  What it DOESN'T know:                                           │
│  ❌ What a "squat" is                                            │
│  ❌ What a "push-up" is                                          │
│  ❌ What "good form" means                                       │
│  ❌ How to count reps                                            │
│  ❌ When to give feedback                                        │
│  ❌ What angles are "correct"                                    │
│                                                                  │
│  MEDIAPIPE = CAMERA WITH X-RAY VISION 📷                         │
│              (Just tells you where joints are)                   │
└──────────────────────────────────────────────────────────────────┘
                            ↓
                  Sends raw coordinates
                            ↓
┌──────────────────────────────────────────────────────────────────┐
│                      OUR CODE                                    │
│              (/utils/poseComparison.ts)                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  What it DOES know:                                              │
│  ✅ "Squat = knees bent 90-135°"                                 │
│  ✅ "Push-up down = elbows at 80-100°"                           │
│  ✅ "Good form = body straight 170-180°"                         │
│  ✅ "Rep = start pose → end pose → start pose"                   │
│  ✅ "Bad form for 3 seconds → give feedback"                     │
│  ✅ "Score ≥60% → user is in the pose"                           │
│                                                                  │
│  How it works:                                                   │
│  1️⃣ Takes coordinates from MediaPipe                             │
│  2️⃣ Calculates angles between joints                             │
│  3️⃣ Compares angles to our baselines                             │
│  4️⃣ Returns 0-100 score                                          │
│  5️⃣ Detects form issues                                          │
│  6️⃣ Counts reps when poses match                                 │
│  7️⃣ Triggers audio feedback                                      │
│                                                                  │
│  OUR CODE = THE BRAIN 🧠                                         │
│             (Knows all the exercise rules)                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Concrete Example: Squat Detection

### What MediaPipe Sees (Dumb Data):
```json
{
  "leftHip": { "x": 0.45, "y": 0.50, "z": -0.15 },
  "leftKnee": { "x": 0.43, "y": 0.65, "z": -0.12 },
  "leftAnkle": { "x": 0.42, "y": 0.85, "z": -0.10 },
  "rightHip": { "x": 0.55, "y": 0.50, "z": -0.15 },
  "rightKnee": { "x": 0.57, "y": 0.65, "z": -0.12 },
  "rightAnkle": { "x": 0.58, "y": 0.85, "z": -0.10 }
}
```

**MediaPipe's thought process:**  
💭 "I found some points. Here they are. That's all I know! 🤷"

---

### What Our Code Does (Smart Analysis):

```javascript
// STEP 1: Calculate knee angle
const leftKneeAngle = calculateAngle(
  { x: 0.45, y: 0.50 },  // Hip
  { x: 0.43, y: 0.65 },  // Knee  ← vertex
  { x: 0.42, y: 0.85 }   // Ankle
);
// Result: 95°

// STEP 2: Compare to our baseline
// WE DEFINED: Good squat = 90-135° knee flexion
if (leftKneeAngle >= 90 && leftKneeAngle <= 135) {
  score = 100;  // ✅ Perfect squat depth!
} else if (leftKneeAngle < 90) {
  issue = "kneeAngleTooShallow";  // ❌ Not deep enough
} else {
  issue = "kneeAngleTooDeep";  // ❌ Too deep, injury risk
}

// STEP 3: Check trunk lean
const trunkLean = calculateVerticalAngle(shoulderCenter, hipCenter);
// Result: 42°

// WE DEFINED: Good trunk lean = 30-45° from vertical
if (trunkLean >= 30 && trunkLean <= 45) {
  // ✅ Proper forward lean
} else if (trunkLean > 45) {
  issue = "trunkLeanExcessive";  // ❌ Leaning too far forward
}

// STEP 4: Return composite score
return 92;  // Out of 100 - this is a great squat!
```

**Our code's thought process:**  
💭 "95° knee angle + 42° trunk lean = This is a proper squat! Score: 92/100 ✅"

---

## Where Each Piece of Intelligence Lives

### 1. **Exercise Pose Definitions** (Our Code)

```typescript
// File: /utils/poseComparison.ts

function checkSquatDown(landmarks) {
  // 🧠 WE TEACH: "This is what a squat looks like"
  const kneeAngle = calculateAngle(hip, knee, ankle);
  
  // 🧠 WE DEFINE: 70-110° is good
  if (kneeAngle >= 70 && kneeAngle <= 110) {
    return 100;  // Perfect!
  } else {
    return penalty;  // Not quite right
  }
}

function checkPushUpDown(landmarks) {
  // 🧠 WE TEACH: "This is what push-up bottom position looks like"
  const elbowAngle = calculateAngle(shoulder, elbow, wrist);
  
  // 🧠 WE DEFINE: 90° is ideal
  const score = Math.max(0, 100 - Math.abs(90 - elbowAngle) * 2);
  return score;
}
```

**MediaPipe has ZERO knowledge of these functions!**

---

### 2. **Form Issue Thresholds** (Our Code)

```typescript
// File: /utils/poseComparison.ts - Line 569+

export function detectFormIssues(landmarks, exerciseType) {
  switch (exerciseType) {
    case 'squat':
      // 🧠 WE DEFINE: What counts as "bad form"
      const kneeAngle = calculateAngle(hip, knee, ankle);
      
      if (kneeAngle > 135) {
        return { kneeAngleTooDeep: true };  // ⚠️
      }
      if (kneeAngle < 90) {
        return { kneeAngleTooShallow: true };  // ⚠️
      }
      if (trunkLean > 45) {
        return { trunkLeanExcessive: true };  // ⚠️
      }
      break;
      
    case 'pushup':
      // 🧠 WE DEFINE: Push-up form rules
      if (elbowAngle < 80 || elbowAngle > 100) {
        return { elbowAngleIncorrect: true };  // ⚠️
      }
      if (bodyAlignment < 170) {
        return { hipsSagging: true };  // ⚠️
      }
      break;
  }
}
```

**MediaPipe doesn't know what 135° means or why it matters!**

---

### 3. **Rep Counting Logic** (Our Code)

```typescript
// File: /components/LiveExerciseView.tsx - Line 440+

// 🧠 WE DEFINE: How to count a rep
const MIN_POSE_MATCH_THRESHOLD = 60;  // Score must be ≥60 to recognize pose

// Check all poses in the exercise
config.poses.forEach(pose => {
  const score = comparePose(currentLandmarks, pose);  // Returns 0-100
  if (score > bestMatchScore) {
    bestMatchPose = pose;
    bestMatchScore = score;
  }
});

// 🧠 WE DEFINE: The rep counting state machine
if (bestMatchScore >= 60) {  // Only count if form is good enough
  if (bestMatchPose === startPose) {
    setIsInStartPosition(true);  // ✅ Ready to count
  } else if (bestMatchPose === endPose && isInStartPosition) {
    setLastPoseMatch(endPose);  // ✅ Bottom of rep reached
  }
  
  // 🧠 WE DEFINE: Full cycle = one rep
  if (bestMatchPose === startPose && lastPoseMatch === endPose) {
    setRepsCompleted(prev => prev + 1);  // 🎉 REP COUNTED!
    speakFeedback('Rep complete');
  }
}
```

**MediaPipe has no concept of "reps" or "cycles"!**

---

### 4. **Feedback Triggers** (Our Code)

```typescript
// File: /components/LiveExerciseView.tsx - Line 627+

// 🧠 WE DEFINE: When to speak up
if (hasIncorrectJoint && isInRecognizablePose) {
  deviationCount++;  // Count seconds of bad form
}

// 🧠 WE DEFINE: 3-second rule before feedback
if (deviationCount >= 3) {
  if (formIssues.kneesOverToes) {
    speakFeedback('Push your hips back - keep knees behind toes');
  } else if (formIssues.trunkLeanExcessive) {
    speakFeedback('Chest up - reduce forward trunk lean');
  }
  
  deviationCount = 0;  // Reset timer
}
```

**MediaPipe doesn't give audio feedback or even know what feedback is!**

---

## Visual Comparison Table

| Feature | MediaPipe Knows? | Our Code Knows? | Where Defined |
|---------|-----------------|----------------|---------------|
| Body joint locations | ✅ YES | ✅ YES (gets from MediaPipe) | MediaPipe model |
| What a "squat" is | ❌ NO | ✅ YES | `checkSquatDown()` |
| What a "push-up" is | ❌ NO | ✅ YES | `checkPushUpDown()` |
| Ideal knee angle (90-135°) | ❌ NO | ✅ YES | Line 572-583 |
| Ideal elbow angle (80-100°) | ❌ NO | ✅ YES | Line 620-633 |
| When form is "bad" | ❌ NO | ✅ YES | `detectFormIssues()` |
| How to count reps | ❌ NO | ✅ YES | LiveExerciseView Lines 440-500 |
| When to give feedback | ❌ NO | ✅ YES | LiveExerciseView Lines 627+ |
| 60% threshold for pose match | ❌ NO | ✅ YES | Line 439 `MIN_POSE_MATCH_THRESHOLD` |
| 3-second delay before feedback | ❌ NO | ✅ YES | Line 627 `deviationCount >= 3` |

---

## The Overlay Question

**Q: Did we tell our overlay what thresholds to detect?**  
**A: YES!** The overlay gets its intelligence from our code:

```typescript
// File: /components/LivePoseOverlay.tsx

export function LivePoseOverlay({ 
  landmarks,      // ← From MediaPipe (dumb coordinates)
  formIssues,     // ← From OUR code (smart analysis)
  exerciseType    // ← We defined this
}) {
  // Color joints based on OUR form analysis
  const jointColor = formIssues.shouldersNotLevel 
    ? '#ff4444'  // 🔴 Red - WE DETECTED the issue
    : '#00ff00'; // 🟢 Green - WE VERIFIED it's good
    
  return (
    <circle 
      cx={landmarks.leftShoulder.x} 
      cy={landmarks.leftShoulder.y}
      fill={jointColor}  // ← OUR intelligence, not MediaPipe's
    />
  );
}
```

---

## The Pipeline Visualized

```
DUMB DATA (MediaPipe)
        ↓
{ leftKnee: {x: 0.43, y: 0.65} }
        ↓
        ↓
OUR MATH (poseComparison.ts)
        ↓
calculateAngle(hip, knee, ankle) = 95°
        ↓
        ↓
OUR BASELINES (poseComparison.ts)
        ↓
"Is 95° in the 90-135° range?" → YES ✅
        ↓
        ↓
OUR SCORING (poseComparison.ts)
        ↓
comparePose() returns 92/100
        ↓
        ↓
OUR THRESHOLDS (LiveExerciseView.tsx)
        ↓
"Is 92 ≥ 60?" → YES ✅ → Pose recognized
        ↓
        ↓
OUR STATE MACHINE (LiveExerciseView.tsx)
        ↓
"Was in start pose, now in end pose, back to start?"
→ YES ✅ → Count the rep!
        ↓
        ↓
OUR FEEDBACK (LiveExerciseView.tsx)
        ↓
speakFeedback('Rep 1 complete')
        ↓
        ↓
OUR VISUALIZATION (LivePoseOverlay.tsx)
        ↓
<circle fill="lime" /> ← Green because we decided form is good
```

**Every step after MediaPipe is our custom code!**

---

## Summary

### What MediaPipe Does:
- Runs on every video frame (60 FPS)
- Detects body presence
- Returns 33 joint coordinates
- **That's literally it**

### What Our Code Does:
- Defines exercise poses (12+ different poses)
- Sets scientific angle baselines
- Calculates angles from coordinates
- Scores pose matches (0-100)
- Detects 15+ form issues
- Counts reps via state machine
- Triggers feedback at right time
- Colors the overlay joints
- Tracks form quality over time
- **Everything exercise-related**

---

## The Definitive Answer

**Q: How did we set up baselines so MediaPipe knows what a squat is?**

**A: We didn't tell MediaPipe anything! MediaPipe is just a pose detector.**

**We created all the exercise intelligence ourselves in:**
1. `/utils/poseComparison.ts` - Pose definitions & thresholds
2. `/components/LiveExerciseView.tsx` - Rep counting & feedback logic
3. `/components/LivePoseOverlay.tsx` - Visual feedback

**MediaPipe = Eyes 👀**  
**Our Code = Brain 🧠**

The overlay shows colored joints based on **our analysis**, not MediaPipe's!
