import * as THREE from "three";

/**
 * Дополнительные точки в мировых координатах между стартом камеры (зум к шару)
 * и финалом у проектора. Если массив не пуст — траектория идёт по Catmull–Rom
 * через эти точки (плавная кривая через все заданные точки).
 *
 * Пример (подставь свои координаты из Blender / отладки):
 * export const SHELF_TO_DESK_WAYPOINTS = [
 *   [3.2, 2.1, -2.0],
 *   [0.5, 2.8, -3.0],
 * ] as const;
 */
export const SHELF_TO_DESK_WAYPOINTS: readonly (readonly [number, number, number])[] | null = null;

export function hasCustomWaypoints(): boolean {
  return Array.isArray(SHELF_TO_DESK_WAYPOINTS) && SHELF_TO_DESK_WAYPOINTS.length > 0;
}

export function waypointsToVectors(): THREE.Vector3[] {
  if (!SHELF_TO_DESK_WAYPOINTS?.length) return [];
  return SHELF_TO_DESK_WAYPOINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z));
}
