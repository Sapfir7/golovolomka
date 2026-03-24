/**
 * Shelf – деревянный стеллаж с тремя рядами.
 *
 * Позиция: центр [0, 1.5, 0], шириной 9 единиц, глубиной 1.
 * Полки: Y = -1.4, 0.1, 1.6, 3.1 (дно + 3 полки + крышка @ 4.2)
 *
 * Слоты шаров: 3 ряда × 5 колонок = до 15 шаров.
 */

const PLANK_W = 9.4;
const PLANK_H = 0.14;
const PLANK_D = 1.0;
const SIDE_H = 5.8;
const SHELF_Y = 1.2; // Y-смещение всей группы

const WOOD = "#4a2c0e";
const WOOD_DARK = "#2e1a08";
const ROUGH = 0.88;

export function Shelf() {
  const plankYs = [-1.4, 0.1, 1.6, 3.1];
  return (
    <group position={[0, SHELF_Y, 0]}>
      {/* Горизонтальные полки */}
      {plankYs.map((y, i) => (
        <mesh key={i} position={[0, y, -0.5]} receiveShadow castShadow>
          <boxGeometry args={[PLANK_W, PLANK_H, PLANK_D]} />
          <meshStandardMaterial color={WOOD} roughness={ROUGH} metalness={0.04} />
        </mesh>
      ))}

      {/* Верхняя крышка */}
      <mesh position={[0, 4.2, -0.5]} receiveShadow castShadow>
        <boxGeometry args={[PLANK_W, PLANK_H, PLANK_D]} />
        <meshStandardMaterial color={WOOD} roughness={ROUGH} metalness={0.04} />
      </mesh>

      {/* Левая боковина */}
      <mesh position={[-PLANK_W / 2 - 0.07, 1.4, -0.5]} castShadow receiveShadow>
        <boxGeometry args={[0.14, SIDE_H, PLANK_D]} />
        <meshStandardMaterial color={WOOD} roughness={ROUGH} metalness={0.04} />
      </mesh>

      {/* Правая боковина */}
      <mesh position={[PLANK_W / 2 + 0.07, 1.4, -0.5]} castShadow receiveShadow>
        <boxGeometry args={[0.14, SIDE_H, PLANK_D]} />
        <meshStandardMaterial color={WOOD} roughness={ROUGH} metalness={0.04} />
      </mesh>

      {/* Задняя панель */}
      <mesh position={[0, 1.4, -1.08]} receiveShadow>
        <boxGeometry args={[PLANK_W + 0.3, SIDE_H, 0.07]} />
        <meshStandardMaterial color={WOOD_DARK} roughness={0.95} />
      </mesh>
    </group>
  );
}

// ─── Позиции слотов шаров ─────────────────────────────────────────────────────
const COLS = 5;
const COL_SPACING = 1.7;
const ROW_SPACING = 1.5;
const START_X = -(COLS - 1) * COL_SPACING / 2;

/** Возвращает мировую позицию слота шара по его порядковому номеру. */
export function orbSlotPosition(index: number): [number, number, number] {
  const row = Math.floor(index / COLS);
  const col = index % COLS;
  const x = START_X + col * COL_SPACING;
  // Полки: -1.4, 0.1, 1.6 → шар сидит на 0.55 выше полки
  const plankY = [-1.4, 0.1, 1.6][Math.min(row, 2)];
  const y = SHELF_Y + plankY + 0.62;
  return [x, y, 0];
}

/** Мировая позиция стойки на столе (куда летит шар). */
export const PROJECTION_STAND_POS: [number, number, number] = [0, 0.8, -6.5];
