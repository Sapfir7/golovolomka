import type { MemoryColor } from "./types";

/** Primary palette — orbs, beam, screen tint, UI accents */
export const COLOR_HEX: Record<MemoryColor, string> = {
  yellow: "#f0d202",
  red: "#f7130a",
  blue: "#5b94ed",
  purple: "#9a95fb",
};

/** Darker emissive base (same hues, lower luminance) */
export const EMISSIVE_HEX: Record<MemoryColor, string> = {
  yellow: "#6b5e01",
  red: "#6a0905",
  blue: "#2a4770",
  purple: "#4a467e",
};

/** Idle cone / default beam tint (soft yellow from primary yellow) */
export const CONE_BEAM_NEUTRAL = "#faf3b0";

/** Screen vignette when no memory tint is set yet */
export const FALLBACK_VIGNETTE_HEX = "#322e52";

/** Cycle GLB scene lights through the four brand colors */
export const LIGHT_CYCLE_HEX = [
  COLOR_HEX.yellow,
  COLOR_HEX.red,
  COLOR_HEX.blue,
  COLOR_HEX.purple,
] as const;
