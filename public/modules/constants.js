export const THEME = {
  background: 0x0a0a0f,
  fogDensity: 0.0003,
  accent: 0x8b5cf6,
  accentHighlight: 0xa78bfa,
  secondary: 0x06b6d4,
};

export const NODE = {
  minSize: 1.5,
  maxSizeBonus: 6,
  segments: 24,
  emissive: 0.5,
  emissiveHighlightSelf: 0.8,
  emissiveHighlightNeighbor: 0.55,
  emissiveDimmed: 0.08,
  emissiveThresholdDimmed: 0.05,
  opacity: 1.0,
  opacityDimmed: 0.1,
};

export const EDGE = {
  baseOpacity: 0.08,
  opacityRange: 0.15,
  highlightOpacity: 0.7,
  thresholdDimmedOpacity: 0.01,
  curveSegments: 20,
  curvature: 0.12,
};

export const SIMULATION = {
  alphaDecay: 0.015,
  alphaMin: 0.001,
  repulsion: 1500,
  repulsionCutoff: 200,
  linkDistance: 60,
  linkStrength: 0.3,
  centerStrength: 0.003,
  clusterStrength: 0.15,
  clusterRepulsion: 3000,
  damping: 0.55,
  maxVelocity: 15,
  initialSpread: 200,
};

export const CAMERA = {
  fov: 60,
  near: 0.1,
  far: 10000,
  defaultZ: 600,
  minDistance: 20,
  maxDistance: 5000,
};

export const FOLDER_COLORS = [
  0x8b5cf6, 0x06b6d4, 0x10b981, 0xf59e0b, 0xef4444,
  0xec4899, 0x6366f1, 0x14b8a6, 0x84cc16, 0xf97316,
];

export function folderColor(folder) {
  let hash = 0;
  for (let i = 0; i < folder.length; i++) {
    hash = (hash * 31 + folder.charCodeAt(i)) | 0;
  }
  return FOLDER_COLORS[Math.abs(hash) % FOLDER_COLORS.length];
}
