import type { PoseLandmarks } from '../hooks/useMediaPipePose';
import { LANDMARK_KEYS, SKELETON_CONNECTIONS, type TriangulatedPose } from '../hooks/useTriangulation';
export const LANDMARK_COLORS: Record<keyof PoseLandmarks, string> = {
  nose: '#a78bfa',
  leftShoulder: '#34d399', rightShoulder: '#34d399',
  leftElbow: '#60a5fa', rightElbow: '#60a5fa',
  leftWrist: '#f87171', rightWrist: '#f87171',
  leftHip: '#fbbf24', rightHip: '#fbbf24',
  leftKnee: '#fb923c', rightKnee: '#fb923c',
  leftAnkle: '#e879f9', rightAnkle: '#e879f9',
};

export interface Bounds { minX: number; minY: number; rangeX: number; rangeY: number; }

export function projectPose(pose3D: TriangulatedPose, view: 'front' | 'side' | 'top') {
  return LANDMARK_KEYS
    .map(k => {
      const pt = pose3D[k];
      if (!pt) return null;
      const px = view === 'side' ? pt.z : pt.x;
      const py = view === 'top'  ? pt.z : -pt.y;
      return { key: k, px, py };
    })
    .filter(Boolean) as { key: keyof PoseLandmarks; px: number; py: number }[];
}

export function computeBounds(points: { px: number; py: number }[]): Bounds | null {
  if (points.length === 0) return null;
  const xs = points.map(p => p.px), ys = points.map(p => p.py);
  return {
    minX: Math.min(...xs), minY: Math.min(...ys),
    rangeX: Math.max(...xs) - Math.min(...xs) || 1,
    rangeY: Math.max(...ys) - Math.min(...ys) || 1,
  };
}

export function SkeletonView({
  pose3D, view, width, height, label, labelColor = '#6b7280', sharedBounds,
}: {
  pose3D: TriangulatedPose; view: 'front' | 'side' | 'top';
  width: number; height: number; label?: string; labelColor?: string;
  sharedBounds?: Bounds | null;
}) {
  const PAD = 24;
  const projected = projectPose(pose3D, view);
  if (projected.length === 0) {
    return (
      <svg width={width} height={height}>
        {label && <text x={8} y={18} fill={labelColor} fontSize="11" fontWeight="600">{label}</text>}
        <text x={width/2} y={height/2} textAnchor="middle" fill="#4b5563" fontSize="13">No joints detected</text>
      </svg>
    );
  }
  const bounds = sharedBounds ?? computeBounds(projected)!;
  const { minX, minY, rangeX, rangeY } = bounds;
  const scale = Math.min((width - PAD * 2) / rangeX, (height - PAD * 2) / rangeY);
  const toSVG = (px: number, py: number) => ({
    x: PAD + (px - minX) * scale + ((width  - PAD * 2) - rangeX * scale) / 2,
    y: PAD + (py - minY) * scale + ((height - PAD * 2) - rangeY * scale) / 2,
  });
  const ptMap = Object.fromEntries(projected.map(p => [p.key, p]));
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      {label && <text x={8} y={18} fill={labelColor} fontSize="11" fontWeight="600">{label}</text>}
      {SKELETON_CONNECTIONS.map(([a, b]) => {
        const pa = ptMap[a], pb = ptMap[b];
        if (!pa || !pb) return null;
        const A = toSVG(pa.px, pa.py), B = toSVG(pb.px, pb.py);
        return <line key={`${a}-${b}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y}
          stroke="rgba(255,255,255,0.5)" strokeWidth="4" strokeLinecap="round" />;
      })}
      {projected.map(({ key, px, py }) => {
        const { x, y } = toSVG(px, py);
        return <circle key={key} cx={x} cy={y} r={5}
          fill={LANDMARK_COLORS[key]} stroke="rgba(0,0,0,0.6)" strokeWidth="1.5" />;
      })}
    </svg>
  );
}

