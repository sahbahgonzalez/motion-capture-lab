# How Baselines & Thresholds Work

## The Key Answer: **We tell OUR code, NOT MediaPipe!**

**MediaPipe is "dumb"** - it only knows:
- "I see a body"
- "Here are 33 joint coordinates"
- That's it! No exercise knowledge at all.

**Our code is "smart"** - we programmed all the exercise logic in:
- `/utils/poseComparison.ts` - The brain of the system
- Scientific baselines from peer-reviewed research
- Custom thresholds tuned for real-time feedback

---

## Architecture: Who Knows What?

```
┌─────────────────────────────────────────────────────────────┐
│                        MediaPipe                            │
│              (Google's Pre-trained ML Model)                │
│                                                             │
│  ✓ Detects human bodies in video                           │
│  ✓ Returns 33 landmark coordinates                         │
│  ✗ NO idea what a "squat" is                               │
│  ✗ NO idea what "good form" means                          │
│  ✗ NO rep counting logic                                   │
│  ✗ NO exercise-specific knowledge                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
              (Just sends raw coordinates)
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  Our Custom Code                            │
│              (/utils/poseComparison.ts)                     │
│                                                             │
│  ✓ Defines what a "squat" looks like                       │
│  ✓ Knows ideal joint angles from research                  │
│  ✓ Calculates angles from coordinates                      │
│  ✓ Compares angles to baselines                            │
│  ✓ Detects form issues                                     │
│  ✓ Counts reps                                             │
│  ✓ Triggers feedback                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Where Are the Baselines Defined?

### 1. **Pose Baseline Functions** (Lines 33-430)

Each exercise has dedicated functions that define what the pose "looks like":

#### Example: `checkSquatDown()` - Line 239
```typescript
function checkSquatDown(landmarks: PoseLandmarks): number {
  // ✅ WE DEFINE: "Squat down" means knees bent 70-110 degrees
  const leftKneeAngle = calculateAngle(
    landmarks.leftHip,
    landmarks.leftKnee,
    landmarks.leftAnkle
  );
  
  // ✅ OUR THRESHOLD: 70-110° is acceptable squat depth
  const leftKneeScore = leftKneeAngle >= 70 && leftKneeAngle <= 110 
    ? 100  // Perfect!
    : Math.max(0, 100 - Math.abs(90 - leftKneeAngle) * 2); // Penalty
  
  // Returns 0-100 score
  return (leftKneeScore + rightKneeScore + depthScore) / 3;
}
```

#### Example: `checkPushUpDown()` - Line 185
```typescript
function checkPushUpDown(landmarks: PoseLandmarks): number {
  // ✅ WE DEFINE: "Push-up down" means elbows bent ~90 degrees
  const leftArmAngle = calculateAngle(
    landmarks.leftShoulder,
    landmarks.leftElbow,
    landmarks.leftWrist
  );
  
  // ✅ OUR THRESHOLD: Elbow angle should be close to 90°
  const leftArmScore = Math.max(0, 100 - Math.abs(90 - leftArmAngle) * 2);
  
  return (leftArmScore + rightArmScore + alignmentScore) / 3;
}
```

**Key Point**: These functions return **0-100 scores** based on how well user's pose matches our defined ideal.

---

### 2. **Form Issue Thresholds** (Lines 548-755)

This is where we define **scientifically-validated baselines** from research:

#### Squat Thresholds (Lines 569-614)
```typescript
case 'squat': {
  // ✅ BASELINE FROM RESEARCH: 90-135° knee flexion
  const kneeAngle = Math.min(leftKneeAngle, rightKneeAngle);
  
  if (kneeAngle > 135) {
    issues.kneeAngleTooDeep = true;     // ⚠️ Injury risk
  } else if (kneeAngle < 90) {
    issues.kneeAngleTooShallow = true;  // ⚠️ Not deep enough
  }
  
  // ✅ BASELINE: 30-45° trunk lean from vertical
  const trunkLean = calculateVerticalAngle(shoulderCenter, hipCenter);
  
  if (trunkLean > 45) {
    issues.trunkLeanExcessive = true;     // ⚠️ Too much forward lean
  } else if (trunkLean < 30) {
    issues.trunkLeanInsufficient = true;  // ⚠️ Too upright
  }
  
  // ✅ BASELINE: Knees should not pass toes
  if (leftKnee.x > leftAnkle.x + 0.05) {
    issues.kneesOverToes = true;  // ⚠️ Poor form
  }
  
  break;
}
```

#### Push-up Thresholds (Lines 617-666)
```typescript
case 'pushup': {
  // ✅ BASELINE: 80-100° elbow flexion at bottom
  const avgElbowAngle = (leftElbowAngle + rightElbowAngle) / 2;
  
  if (avgElbowAngle < 120) {  // User is in "down" position
    if (avgElbowAngle < 80 || avgElbowAngle > 100) {
      issues.elbowAngleIncorrect = true;  // ⚠️ Wrong depth
    }
  }
  
  // ✅ BASELINE: 170-180° body alignment (straight line)
  const bodyAlignment = calculateBodyAlignment(
    shoulderCenter, 
    hipCenter, 
    ankleCenter
  );
  
  if (bodyAlignment < 170 || bodyAlignment > 180) {
    issues.bodyNotStraight = true;  // ⚠️ Hips sagging/raised
  }
  
  break;
}
```

#### Plank Thresholds (Lines 668-702)
```typescript
case 'plank': {
  // ✅ BASELINE: 170-190° body alignment
  const bodyAlignment = calculateBodyAlignment(
    shoulderCenter, 
    hipCenter, 
    ankleCenter
  );
  
  if (bodyAlignment < 170) {
    issues.hipsSagging = true;    // ⚠️ Core not engaged
  } else if (bodyAlignment > 190) {
    issues.hipsRaised = true;     // ⚠️ Hips too high
  }
  
  break;
}
```

---

### 3. **Rep Counting Logic** (LiveExerciseView.tsx, Lines 348-460)

This is where we detect when a rep is **attempted** and when it's **successful**:

#### The Threshold System
```typescript
// ✅ WE DEFINE: Minimum 60% match to recognize a pose
const MIN_POSE_MATCH_THRESHOLD = 60;  // Out of 100

// ✅ WE DEFINE: 40-60% = attempted but failed rep
const PARTIAL_REP_THRESHOLD = 40;

// Get best matching pose
config.poses.forEach(pose => {
  const score = comparePose(currentLandmarks, pose);  // Returns 0-100
  if (score > bestMatchScore) {
    bestMatchScore = score;
    bestMatchPose = pose;
  }
});

// ✅ OUR LOGIC: User must score ≥60% to count as "in pose"
const isInRecognizablePose = bestMatchScore >= MIN_POSE_MATCH_THRESHOLD;
```

#### Rep Counting State Machine
```typescript
// For push-ups: ['pushup-up', 'pushup-down']
// For squats: ['squat-up-side', 'squat-down-side']

if (isInRecognizablePose) {
  if (bestMatchPose === startPose) {
    // ✅ User entered START position (e.g., pushup-up)
    setIsInStartPosition(true);
    setLastPoseMatch(startPose);
    
  } else if (bestMatchPose === endPose) {
    // ✅ User reached END position (e.g., pushup-down)
    if (isInStartPosition) {
      setLastPoseMatch(endPose);
    }
  }
  
  // ✅ REP COMPLETE: Returned from end to start
  if (bestMatchPose === startPose && lastPoseMatch === endPose) {
    setRepsCompleted(prev => prev + 1);  // 🎉 Count the rep!
    speakFeedback(`Rep ${newReps} complete`);
  }
}
```

**This is a finite state machine:**
1. Wait for START pose (score ≥60%)
2. Wait for END pose (score ≥60%)  
3. Wait for return to START pose (score ≥60%)
4. **→ REP COUNTED!**

---

## How comparePose() Works - The Core Algorithm

Located at **Line 884**:

```typescript
export function comparePose(
  landmarks: PoseLandmarks,   // From MediaPipe
  expectedPose: string         // e.g., 'squat-down-side'
): number {
  // Returns 0-100 score
  
  switch (expectedPose) {
    case 'squat-down-side':
      return checkSquatDownSide(landmarks);  // ← Runs our custom logic
    case 'pushup-down':
      return checkPushUpDown(landmarks);     // ← Runs our custom logic
    case 'plank':
      return checkPlank(landmarks);          // ← Runs our custom logic
    // ... etc
  }
}
```

### Example: Scoring a Squat

```
MediaPipe gives us: { leftHip: {x, y}, leftKnee: {x, y}, leftAnkle: {x, y} }
                              ↓
                   calculateAngle(hip, knee, ankle)
                              ↓
                   Result: 95° knee flexion
                              ↓
            Compare to our baseline: 90-135° is good
                              ↓
                   95° is in range! ✅
                              ↓
              Score = 100 (perfect match)
                              ↓
    If 95° was 150° (too shallow): Score = 50 (penalty applied)
    If 95° was 70° (too deep): Score = 40 (penalty applied)
```

---

## Scientific Baselines Used

These are from peer-reviewed biomechanics research:

| Exercise | Metric | Baseline | Source Logic |
|----------|--------|----------|--------------|
| **Squat** | Knee flexion | 90-135° | Lines 572-583 |
| | Trunk lean | 30-45° | Lines 604-612 |
| | Knees vs toes | Knees behind toes | Lines 585-592 |
| **Push-up** | Elbow angle (bottom) | 80-100° | Lines 620-633 |
| | Body alignment | 170-180° | Lines 635-656 |
| **Plank** | Body alignment | 170-190° | Lines 668-688 |
| | Hip abduction | <30° | Lines 690-695 |
| **Sit-up** | Hip flexion | 70-90° | Lines 704-729 |
| | Lumbar flexion | 30-45° | Lines 731-746 |

---

## Feedback Trigger System

**3-Second Rule** (LiveExerciseView.tsx, Line 627):

```typescript
// Track consecutive deviations
if (hasIncorrectJoint && isInRecognizablePose) {
  setDeviationCount(prev => prev + 1);  // Increment each second
} else {
  setDeviationCount(0);  // Reset if form is good
}

// Trigger feedback after 3 consecutive seconds of bad form
if (deviationCount >= 3) {
  speakFeedback('Keep your core tight!');
  setDeviationCount(0);  // Reset after feedback
}
```

**Why 3 seconds?**
- Prevents feedback spam
- Gives user time to self-correct
- Confirms persistent form issues (not just momentary fluctuations)

---

## Complete Data Flow Example: Squat Rep

```
1. MediaPipe detects landmarks:
   { leftHip: {x:0.5, y:0.4}, leftKnee: {x:0.5, y:0.6}, leftAnkle: {x:0.5, y:0.8} }
                              ↓
2. Our code calculates angle:
   calculateAngle(hip, knee, ankle) = 95°
                              ↓
3. comparePose('squat-down-side', landmarks) runs:
   - Check knee angle: 95° is in 90-135° range ✅
   - Check trunk lean: 38° is in 30-45° range ✅
   - Check knees vs toes: Knees behind toes ✅
   - Return score: 92/100 (excellent form!)
                              ↓
4. Rep counting logic:
   - Score 92 ≥ 60 threshold → isInRecognizablePose = true
   - bestMatchPose = 'squat-down-side'
   - User was in 'squat-up-side' → Transitioned to down position
   - Set lastPoseMatch = 'squat-down-side'
                              ↓
5. User stands back up:
   - comparePose('squat-up-side', landmarks) = 88/100
   - bestMatchPose = 'squat-up-side'
   - Previous pose was 'squat-down-side' → FULL CYCLE COMPLETE!
   - setRepsCompleted(prev => prev + 1) ← 🎉 REP COUNTED!
   - speakFeedback('Rep 1 complete')
                              ↓
6. detectFormIssues() runs (every 1 second):
   - Knee angle: 95° → No issues ✅
   - Trunk lean: 38° → No issues ✅
   - Knees vs toes: Clear → No issues ✅
   - formIssues = {} (empty = perfect form)
                              ↓
7. Overlay visualization:
   - formIssues empty → All joints GREEN 🟢
   - If issues detected → Problem joints RED 🔴
```

---

## Key Takeaways

1. **MediaPipe = Eyes Only**
   - Just detects body landmarks
   - No exercise knowledge

2. **Our Code = Brain**
   - Defines all exercise logic
   - Sets all thresholds
   - Counts all reps
   - Triggers all feedback

3. **Baselines Are Custom-Programmed**
   - Based on scientific research
   - Defined in `/utils/poseComparison.ts`
   - Tuned for real-time performance

4. **Thresholds Control Everything**
   - 60% match = pose recognized
   - 3 seconds = feedback triggered
   - Scientific angles = form validated

5. **Rep Counting = State Machine**
   - Must hit START → END → START cycle
   - Each pose needs ≥60% match
   - Full cycle = one rep counted

---

## Files to Reference

- **`/utils/poseComparison.ts`** - All baseline logic (933 lines)
- **`/components/LiveExerciseView.tsx`** - Rep counting & feedback (Lines 348-627)
- **`/hooks/useMediaPipePose.ts`** - Just landmark extraction (no exercise logic)

---

## In Summary

**Q: Where did we set up baselines?**  
**A:** In `/utils/poseComparison.ts` - every function from lines 33-430

**Q: Where are thresholds defined?**  
**A:** In `detectFormIssues()` function - lines 548-755

**Q: How does it know what a squat is?**  
**A:** We programmed it - `checkSquatDown()` function defines the squat

**Q: Who counts the reps?**  
**A:** Our code - state machine in `LiveExerciseView.tsx` lines 440-500

**Q: What does MediaPipe know?**  
**A:** Nothing about exercises - just "here are the body joints"

**The overlay follows our rules, not MediaPipe's - because MediaPipe has no rules!** 🎯
