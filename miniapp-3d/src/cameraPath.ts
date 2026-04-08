import * as THREE from "three";

/**
 * Дополнительные точки для дуги **камеры** (Catmull–Rom), если задать массив.
 *
 * Путь **шара**: в GLB объекты **Temp1 → Temp2 → Temp3** (регистр как в Blender),
 * слоты **slot00…**, экран **Screen**, камеры **Camera_to_*** / **Camera_out_*** / **Camera**.
 */
export const SHELF_TO_DESK_WAYPOINTS: readonly (readonly [number, number, number])[] | null = null;

export function hasCustomWaypoints(): boolean {
  return Array.isArray(SHELF_TO_DESK_WAYPOINTS) && SHELF_TO_DESK_WAYPOINTS.length > 0;
}

export function waypointsToVectors(): THREE.Vector3[] {
  if (!SHELF_TO_DESK_WAYPOINTS?.length) return [];
  return SHELF_TO_DESK_WAYPOINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z));
}
