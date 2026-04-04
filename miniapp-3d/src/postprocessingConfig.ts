/**
 * Post-processing: SSAO + Bloom + ACES (ToneMapping pass). Composer turns off renderer tone mapping.
 * `multisampling` restores MSAA on the composer path (otherwise edges look jagged vs raw WebGL AA).
 * `resolutionScale` 1 = full internal buffer; below 1 softens edges (cheap upscale).
 */
export const EFFECT_COMPOSER = {
  /** WebGL2 MSAA; 0 disables. 8 is a strong default for shelf/cabinet edge stability. */
  multisampling: 8,
  resolutionScale: 1,
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
  samples: 40,
  rings: 7,
  radius: 0.24,
  bias: 0.035,
  luminanceInfluence: 0.65,
  worldDistanceThreshold: 0.78,
  worldDistanceFalloff: 0.06,
  worldProximityThreshold: 0.22,
  worldProximityFalloff: 0.09,
} as const;
