/**
 * Яркость видимого луча (uStrength в шейдере) и множитель реального SpotLight.
 *
 * В GLB: конус без текстур, имя меша `light_cone` (или lightcone / spot_beam / spotbeam).
 * Ось луча в шейдере считается по локальному Y (как у стандартного конуса в Blender).
 *
 * Меняйте числа здесь; **когда** менять яркость — в Scene.tsx (таймлайн + ZOOMED / goShelf).
 */
export const BEAM_STRENGTH = {
  shelf: 0.09,
  zoomed: 0.15,
  flightToCam02: 0.22,
  atTraj02: 0.3,
  approachScreen: 0.38,
  desk: 0.2,
  backFade: 0.12,
  flightHome: 0.2,
} as const;

/** Множитель к базовой интенсивности Spot из GLB (сейчас 12). */
export const SPOT_MUL = {
  shelf: 1,
  zoomed: 1.06,
  flightToCam02: 1.12,
  atTraj02: 1.2,
  approachScreen: 1.28,
  desk: 1.1,
  backFade: 1.02,
  flightHome: 1.1,
} as const;
