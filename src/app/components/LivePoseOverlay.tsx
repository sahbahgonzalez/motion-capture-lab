import { motion } from 'motion/react';
import { type PoseLandmarks } from '../hooks/useMediaPipePose';

interface LivePoseOverlayProps {
  landmarks: PoseLandmarks | null;
  videoWidth: number;
  videoHeight: number;
  className?: string;
  videoElement?: HTMLVideoElement | null;
  style?: React.CSSProperties;
}

export function LivePoseOverlay({
  landmarks,
  videoWidth,
  videoHeight,
  className = '',
  videoElement,
  style = {}
}: LivePoseOverlayProps) {
  if (!landmarks || !videoWidth || !videoHeight) {
    console.log('LivePoseOverlay: missing data', { 
      hasLandmarks: !!landmarks, 
      videoWidth, 
      videoHeight 
    });
    return null;
  }

  console.log('LivePoseOverlay: rendering', { videoWidth, videoHeight });

  // Convert normalized coordinates (0-1) to viewBox coordinates
  // No X flip needed since video is already mirrored with scaleX(-1)
  const toViewBoxCoords = (point: { x: number; y: number }) => {
    return {
      x: point.x * videoWidth,  // Direct mapping since video is mirrored
      y: point.y * videoHeight,
    };
  };

  // Get all landmarks in viewBox coordinates
  const nose = toViewBoxCoords(landmarks.nose);
  const leftShoulder = toViewBoxCoords(landmarks.leftShoulder);
  const rightShoulder = toViewBoxCoords(landmarks.rightShoulder);
  const leftElbow = toViewBoxCoords(landmarks.leftElbow);
  const rightElbow = toViewBoxCoords(landmarks.rightElbow);
  const leftWrist = toViewBoxCoords(landmarks.leftWrist);
  const rightWrist = toViewBoxCoords(landmarks.rightWrist);
  const leftHip = toViewBoxCoords(landmarks.leftHip);
  const rightHip = toViewBoxCoords(landmarks.rightHip);
  const leftKnee = toViewBoxCoords(landmarks.leftKnee);
  const rightKnee = toViewBoxCoords(landmarks.rightKnee);
  const leftAnkle = toViewBoxCoords(landmarks.leftAnkle);
  const rightAnkle = toViewBoxCoords(landmarks.rightAnkle);

  // Calculate shoulder and hip midpoints
  const shoulderMid = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
  };
  const hipMid = {
    x: (leftHip.x + rightHip.x) / 2,
    y: (leftHip.y + rightHip.y) / 2,
  };

  // Use green for all body parts
  const skeletonColor = '#22c55e'; // Green

  return (
    <svg
      className={`absolute top-0 left-0 pointer-events-none ${className}`}
      width="100%"
      height="100%"
      viewBox={`0 0 ${videoWidth} ${videoHeight}`}
      preserveAspectRatio="xMidYMid slice"
      style={{ position: 'absolute', top: 0, left: 0, transform: 'scaleX(-1)', ...style }}
    >
      {/* Torso - Spine */}
      <motion.line
        x1={shoulderMid.x}
        y1={shoulderMid.y}
        x2={hipMid.x}
        y2={hipMid.y}
        stroke={skeletonColor}
        strokeWidth="4"
        strokeLinecap="round"
        initial={false}
      />

      {/* Shoulders */}
      <motion.line
        x1={leftShoulder.x}
        y1={leftShoulder.y}
        x2={rightShoulder.x}
        y2={rightShoulder.y}
        stroke={skeletonColor}
        strokeWidth="4"
        strokeLinecap="round"
        initial={false}
      />

      {/* Hips */}
      <motion.line
        x1={leftHip.x}
        y1={leftHip.y}
        x2={rightHip.x}
        y2={rightHip.y}
        stroke={skeletonColor}
        strokeWidth="4"
        strokeLinecap="round"
        initial={false}
      />

      {/* Left Arm */}
      <motion.line
        x1={leftShoulder.x}
        y1={leftShoulder.y}
        x2={leftElbow.x}
        y2={leftElbow.y}
        stroke={skeletonColor}
        strokeWidth="4"
        strokeLinecap="round"
        initial={false}
      />
      <motion.line
        x1={leftElbow.x}
        y1={leftElbow.y}
        x2={leftWrist.x}
        y2={leftWrist.y}
        stroke={skeletonColor}
        strokeWidth="4"
        strokeLinecap="round"
        initial={false}
      />

      {/* Right Arm */}
      <motion.line
        x1={rightShoulder.x}
        y1={rightShoulder.y}
        x2={rightElbow.x}
        y2={rightElbow.y}
        stroke={skeletonColor}
        strokeWidth="4"
        strokeLinecap="round"
        initial={false}
      />
      <motion.line
        x1={rightElbow.x}
        y1={rightElbow.y}
        x2={rightWrist.x}
        y2={rightWrist.y}
        stroke={skeletonColor}
        strokeWidth="4"
        strokeLinecap="round"
        initial={false}
      />

      {/* Left Leg */}
      <motion.line
        x1={leftHip.x}
        y1={leftHip.y}
        x2={leftKnee.x}
        y2={leftKnee.y}
        stroke={skeletonColor}
        strokeWidth="4"
        strokeLinecap="round"
        initial={false}
      />
      <motion.line
        x1={leftKnee.x}
        y1={leftKnee.y}
        x2={leftAnkle.x}
        y2={leftAnkle.y}
        stroke={skeletonColor}
        strokeWidth="4"
        strokeLinecap="round"
        initial={false}
      />

      {/* Right Leg */}
      <motion.line
        x1={rightHip.x}
        y1={rightHip.y}
        x2={rightKnee.x}
        y2={rightKnee.y}
        stroke={skeletonColor}
        strokeWidth="4"
        strokeLinecap="round"
        initial={false}
      />
      <motion.line
        x1={rightKnee.x}
        y1={rightKnee.y}
        x2={rightAnkle.x}
        y2={rightAnkle.y}
        stroke={skeletonColor}
        strokeWidth="4"
        strokeLinecap="round"
        initial={false}
      />

      {/* Neck to nose */}
      <motion.line
        x1={shoulderMid.x}
        y1={shoulderMid.y}
        x2={nose.x}
        y2={nose.y}
        stroke={skeletonColor}
        strokeWidth="4"
        strokeLinecap="round"
        initial={false}
      />

      {/* Joint Circles */}
      {/* Head */}
      <motion.circle
        cx={nose.x}
        cy={nose.y}
        r="8"
        fill={skeletonColor}
        stroke="white"
        strokeWidth="2"
        initial={false}
      />

      {/* Shoulders */}
      <motion.circle
        cx={leftShoulder.x}
        cy={leftShoulder.y}
        r="6"
        fill={skeletonColor}
        stroke="white"
        strokeWidth="2"
        initial={false}
      />
      <motion.circle
        cx={rightShoulder.x}
        cy={rightShoulder.y}
        r="6"
        fill={skeletonColor}
        stroke="white"
        strokeWidth="2"
        initial={false}
      />

      {/* Elbows */}
      <motion.circle
        cx={leftElbow.x}
        cy={leftElbow.y}
        r="6"
        fill={skeletonColor}
        stroke="white"
        strokeWidth="2"
        initial={false}
      />
      <motion.circle
        cx={rightElbow.x}
        cy={rightElbow.y}
        r="6"
        fill={skeletonColor}
        stroke="white"
        strokeWidth="2"
        initial={false}
      />

      {/* Wrists */}
      <motion.circle
        cx={leftWrist.x}
        cy={leftWrist.y}
        r="6"
        fill={skeletonColor}
        stroke="white"
        strokeWidth="2"
        initial={false}
      />
      <motion.circle
        cx={rightWrist.x}
        cy={rightWrist.y}
        r="6"
        fill={skeletonColor}
        stroke="white"
        strokeWidth="2"
        initial={false}
      />

      {/* Hips */}
      <motion.circle
        cx={leftHip.x}
        cy={leftHip.y}
        r="6"
        fill={skeletonColor}
        stroke="white"
        strokeWidth="2"
        initial={false}
      />
      <motion.circle
        cx={rightHip.x}
        cy={rightHip.y}
        r="6"
        fill={skeletonColor}
        stroke="white"
        strokeWidth="2"
        initial={false}
      />

      {/* Knees */}
      <motion.circle
        cx={leftKnee.x}
        cy={leftKnee.y}
        r="6"
        fill={skeletonColor}
        stroke="white"
        strokeWidth="2"
        initial={false}
      />
      <motion.circle
        cx={rightKnee.x}
        cy={rightKnee.y}
        r="6"
        fill={skeletonColor}
        stroke="white"
        strokeWidth="2"
        initial={false}
      />

      {/* Ankles */}
      <motion.circle
        cx={leftAnkle.x}
        cy={leftAnkle.y}
        r="6"
        fill={skeletonColor}
        stroke="white"
        strokeWidth="2"
        initial={false}
      />
      <motion.circle
        cx={rightAnkle.x}
        cy={rightAnkle.y}
        r="6"
        fill={skeletonColor}
        stroke="white"
        strokeWidth="2"
        initial={false}
      />
    </svg>
  );
}