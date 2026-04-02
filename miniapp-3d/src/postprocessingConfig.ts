/**
 * Post-processing: SSAO + Bloom + ACES (ToneMapping pass). Composer turns off renderer tone mapping.
 */
export const EFFECT_COMPOSER = {
  multisampling: 0,
  resolutionScale: 0.85,
} as const;

export const BLOOM = {
  luminanceThreshold: 0.12,
  luminanceSmoothing: 0.35,
  intensity: 0.58,
  radius: 0.58,
  mipmapBlur: true,
} as const;

/** `radius` is screen-space scale in [1e-6, 1] per postprocessing SSAOEffect. */
export const SSAO = {
  intensity: 0.38,
  samples: 21,
  rings: 5,
  radius: 0.24,
  bias: 0.035,
  luminanceInfluence: 0.65,
  worldDistanceThreshold: 0.78,
  worldDistanceFalloff: 0.06,
  worldProximityThreshold: 0.22,
  worldProximityFalloff: 0.09,
} as const;
