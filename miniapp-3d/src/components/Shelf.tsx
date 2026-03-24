/**
 * Shelf – a simple wooden bookshelf with 3 rows.
 * Orbs are placed separately; the shelf is just the structural geometry.
 *
 * Layout (X, Y, Z):
 *  - Centered at origin
 *  - 3 planks at Y = -1.4, 0.0, 1.4
 *  - Width = 8 units, depth = 1 unit
 */
import { useRef } from "react";
import * as THREE from "three";

const PLANK_W = 9;
const PLANK_H = 0.12;
const PLANK_D = 1.1;
const SIDE_H = 4.4;
const SHELF_COLOR = "#5c3d1e";
const SHELF_ROUGH = 0.85;

export function Shelf() {
  const woodMat = useRef<THREE.MeshStandardMaterial>(null);

  const plankYs = [-1.55, 0, 1.55];

  return (
    <group position={[0, 0, 0]}>
      {/* Horizontal planks */}
      {plankYs.map((y, i) => (
        <mesh key={i} position={[0, y, -0.5]} receiveShadow castShadow>
          <boxGeometry args={[PLANK_W, PLANK_H, PLANK_D]} />
          <meshStandardMaterial
            ref={i === 0 ? woodMat : undefined}
            color={SHELF_COLOR}
            roughness={SHELF_ROUGH}
            metalness={0.05}
          />
        </mesh>
      ))}

      {/* Top cap */}
      <mesh position={[0, 2.2, -0.5]} receiveShadow castShadow>
        <boxGeometry args={[PLANK_W, PLANK_H, PLANK_D]} />
        <meshStandardMaterial color={SHELF_COLOR} roughness={SHELF_ROUGH} metalness={0.05} />
      </mesh>

      {/* Left side panel */}
      <mesh position={[-PLANK_W / 2 - 0.06, 0.3, -0.5]} receiveShadow castShadow>
        <boxGeometry args={[0.12, SIDE_H, PLANK_D]} />
        <meshStandardMaterial color={SHELF_COLOR} roughness={SHELF_ROUGH} metalness={0.05} />
      </mesh>

      {/* Right side panel */}
      <mesh position={[PLANK_W / 2 + 0.06, 0.3, -0.5]} receiveShadow castShadow>
        <boxGeometry args={[0.12, SIDE_H, PLANK_D]} />
        <meshStandardMaterial color={SHELF_COLOR} roughness={SHELF_ROUGH} metalness={0.05} />
      </mesh>

      {/* Back wall panel – subtle dark plane */}
      <mesh position={[0, 0.3, -1.06]} receiveShadow>
        <boxGeometry args={[PLANK_W + 0.25, SIDE_H, 0.06]} />
        <meshStandardMaterial color="#3a2510" roughness={0.95} />
      </mesh>
    </group>
  );
}

// ─── Slot layout helpers ──────────────────────────────────────────────────────

/** Returns world-space [x, y, z] for orb slot `index` (0-based left-to-right, row by row) */
export function orbSlotPosition(index: number): [number, number, number] {
  const perRow = 5;
  const row = Math.floor(index / perRow);     // 0 = bottom shelf
  const col = index % perRow;

  // Distribute cols symmetrically across shelf width
  const startX = -(perRow - 1) * 1.6 / 2;
  const x = startX + col * 1.6;
  // Rows are spaced 1.55 apart, each orb sits 0.5 above the plank
  const y = -1.55 + row * 1.55 + 0.62;
  const z = 0;

  return [x, y, z];
}

// Destination on the desk stand (world space)
export const DESK_STAND_POS: [number, number, number] = [5.1, 0.75, 1.2];
