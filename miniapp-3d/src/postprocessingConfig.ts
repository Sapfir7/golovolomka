/**
 * Post-processing defaults — Bloom maps to postprocessing BloomEffect
 * (UnrealBloomPass-style: threshold / intensity / radius).
 */
export const EFFECT_COMPOSER = {
  multisampling: 4,
  resolutionScale: 1,
} as const;

export const BLOOM = {
  /** Luminance threshold (darker pixels excluded from bloom) */
  luminanceThreshold: 0.1,
  /** Soft edge at threshold */
  luminanceSmoothing: 0.25,
  /** Bloom strength */
  intensity: 0.7,
  /** Blur spread (mipmap blur) */
  radius: 0.5,
  mipmapBlur: true,
} as const;
