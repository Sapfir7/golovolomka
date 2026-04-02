/**
 * Post-processing: SSAO + Bloom (Unreal-style via BloomEffect) + ACES in ToneMapping pass.
 * Composer disables renderer tone mapping; exposure-ish lift via BrightnessContrast before ACES.
 */
export const EFFECT_COMPOSER = {
  multisampling: 0,
  resolutionScale: 0.85,
} as const;

/** Target ~THREE toneMappingExposure 1.2 while using postprocessing ToneMapping (linear lift before ACES). */
export const COMPOSER_EXPOSURE_LIFT = {
  brightness: 0.11,
  contrast: 0.04,
} as const;

export const BLOOM = {
  luminanceThreshold: 0.1,
  luminanceSmoothing: 0.35,
  intensity: 0.6,
  radius: 0.5,
  mipmapBlur: true,
} as const;

/** `radius` is screen-space scale in [1e-6, 1] per postprocessing SSAOEffect. */
export const SSAO = {
  intensity: 0.5,
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
