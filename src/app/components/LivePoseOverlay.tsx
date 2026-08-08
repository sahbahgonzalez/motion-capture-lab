import { type PoseLandmarks } from '../hooks/useMediaPipePose';
import { SKELETON_CONNECTIONS, LANDMARK_KEYS } from '../hooks/useTriangulation';

// Matches the 3D lab's LANDMARK_COLORS palette exactly
const LANDMARK_COLORS: Record<keyof PoseLandmarks, string> = {
  nose: '#a78bfa',
  leftShoulder: '#34d399', rightShoulder: '#34d399',
  leftElbow: '#60a5fa', rightElbow: '#60a5fa',
  leftWrist: '#f87171', rightWrist: '#f87171',
  leftHip: '#fbbf24', rightHip: '#fbbf24',
  leftKnee: '#fb923c', rightKnee: '#fb923c',
  leftAnkle: '#e879f9', rightAnkle: '#e879f9',
};

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
  style = {},
}: LivePoseOverlayProps) {
  if (!landmarks || !videoWidth || !videoHeight) return null;

  const x = (lm: { x: number }) => lm.x * videoWidth;
  const y = (lm: { y: number }) => lm.y * videoHeight;

  return (
    <svg
      className={`absolute top-0 left-0 pointer-events-none ${className}`}
      width="100%"
      height="100%"
      viewBox={`0 0 ${videoWidth} ${videoHeight}`}
      preserveAspectRatio="xMidYMid slice"
      style={{ position: 'absolute', top: 0, left: 0, transform: 'scaleX(-1)', ...style }}
    >
      {/* Bones */}
      {SKELETON_CONNECTIONS.map(([a, b]) => {
        const pa = landmarks[a];
        const pb = landmarks[b];
        if (!pa || !pb || (pa.visibility ?? 1) < 0.5 || (pb.visibility ?? 1) < 0.5) return null;
        return (
          <line
            key={`${a}-${b}`}
            x1={x(pa)} y1={y(pa)} x2={x(pb)} y2={y(pb)}
            stroke="rgba(255,255,255,0.6)"
            strokeWidth="4"
            strokeLinecap="round"
          />
        );
      })}

      {/* Joints */}
      {LANDMARK_KEYS.map(key => {
        const pt = landmarks[key];
        if (!pt || (pt.visibility ?? 1) < 0.5) return null;
        const isHead = key === 'nose';
        return (
          <circle
            key={key}
            cx={x(pt)} cy={y(pt)}
            r={isHead ? 7 : 5}
            fill={LANDMARK_COLORS[key]}
            stroke="white"
            strokeWidth="1.5"
          />
        );
      })}
    </svg>
  );
}
