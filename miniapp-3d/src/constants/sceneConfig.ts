/** GLB из `miniapp-3d/public/` → после сборки в `miniapp-3d-dist/` */
export const SCENE_MODEL_URL = `${import.meta.env.BASE_URL}temp_krik_temp_texture.glb`;

export const ORB_RADIUS = 0.1125;
export const NUM_SLOTS = 5;

export const SCREEN_UV_ROTATION = -Math.PI / 2;
export const SCREEN_MIRROR_X = true;

export const SPOT_BASE_INTENSITY = 8;
export const LIGHT_DIM_FACTOR = 0.22;
export const VIGNETTE_EXPAND = 1.8;

export const SCREEN_FADE_OUT_SEC = 0.8;
export const SCREEN_FADE_OUT_EASE = "power2.out";
export const SCREEN_FADE_IN_SEC = 0.8;
export const SCREEN_FADE_IN_EASE = "power2.inOut";

export const CAM_SHELF_TO_02_SEC = 1.45;
export const ORB_DROP_DURATION = 0.7;
export const PAUSE_AT_CAM02_AFTER_DROP_SEC = 0.55;
export const T_ORB_DROP_START = CAM_SHELF_TO_02_SEC;
export const T_ORB_LAND = T_ORB_DROP_START + ORB_DROP_DURATION;
export const T_BEAM_START = T_ORB_LAND + PAUSE_AT_CAM02_AFTER_DROP_SEC;
export const CAM_FLY_AFTER_BEAM_DELAY = 0.4;
export const T_CAM_TO_MAIN_START = T_BEAM_START + CAM_FLY_AFTER_BEAM_DELAY;
export const CAM_TO_MAIN_DURATION = 1.6;
export const T_DESK_ENTER = T_CAM_TO_MAIN_START + CAM_TO_MAIN_DURATION;

export function isLikelyIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export const IOS_WEBGL_SAFE = isLikelyIOS();
