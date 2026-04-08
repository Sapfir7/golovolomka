/**
 * Имена узлов в `1res_08042026.glb` (Blender → glTF).
 * Меняй здесь при переименовании объектов в сцене.
 */

/** Пустышки слотов для шаров воспоминаний: slot00, slot01, … */
export const GLB_SLOT_NAME_RE = /^slot(\d+)$/i;

/** Экран проектора (меш), регистр как в Blender */
export const GLB_SCREEN_NODE_CANDIDATES = ["Screen", "screen"] as const;

/** Конус визуального луча */
export const GLB_CONE_NODE = "Cone";

/** Удалённый из сцены объект — скрываем, если остался в GLB */
export const GLB_TABLE2_NODE = "table2";

/** Финишная точка шара у «стола» */
export const GLB_FINISH_NODE = "finish";

/** Точки траектории шара (туда), включая finish */
export const GLB_TRAJ_NODES_FORWARD = ["pos_00", "pos_01", "pos_02", GLB_FINISH_NODE] as const;

/** Камера обзора полки / стартовый кадр */
export const GLB_CAMERA_SHELF = "Camera";

/** Камеры приближения к экрану по порядку */
export const GLB_CAMERAS_TO_SCREEN = [
  "Camera_to_00",
  "Camera_to_01",
  "Camera_to_02",
  "Camera_to_03",
] as const;

/** Камеры отъезда от экрана (обратный путь; порядок — от стола к полке) */
export const GLB_CAMERAS_OUT = ["Camera_out_05", "Camera_out_04"] as const;

/** Не тени / не сглаживать нормали на этих узлах */
export const GLB_SHADOW_SKIP_NAMES = new Set<string>([
  ...GLB_TRAJ_NODES_FORWARD,
  "slot00",
  "slot01",
  "slot02",
  "slot03",
  GLB_CONE_NODE,
  "Screen",
  "screen",
]);

/** Пропуск computeVertexNormals (как Conus раньше) */
export const GLB_SMOOTH_NORMAL_SKIP = new Set<string>([
  ...GLB_TRAJ_NODES_FORWARD,
  GLB_CONE_NODE,
  GLB_TABLE2_NODE,
]);
