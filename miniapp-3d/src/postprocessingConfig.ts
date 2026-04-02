/**
 * Post-processing — tuned for soft bloom (UnrealBloomPass-style via BloomEffect).
 * Lower multisampling + resolutionScale saves GPU on mobile.
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
