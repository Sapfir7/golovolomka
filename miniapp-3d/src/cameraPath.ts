import * as THREE from "three";

/**
 * Дополнительные точки в мировых координатах между стартом камеры (зум к шару)
 * и финалом у проектора. Если массив не пуст — траектория идёт по Catmull–Rom.
 *
 * Путь **шара** к проектору задаётся в GLB объектами **temp1 → temp2 → temp3** (temp3 —
 * последняя точка перед `pos_final`); в коде см. `orbFlightCurve` в Scene.tsx.
 */
export const SHELF_TO_DESK_WAYPOINTS: readonly (readonly [number, number, number])[] | null = null;

export function hasCustomWaypoints(): boolean {
  return Array.isArray(SHELF_TO_DESK_WAYPOINTS) && SHELF_TO_DESK_WAYPOINTS.length > 0;
}

export function waypointsToVectors(): THREE.Vector3[] {
  if (!SHELF_TO_DESK_WAYPOINTS?.length) return [];
  return SHELF_TO_DESK_WAYPOINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z));
}
