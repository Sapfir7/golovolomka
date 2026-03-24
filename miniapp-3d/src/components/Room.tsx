/**
 * Room – фиолетовая комната в стиле "Головоломки".
 *
 * Геометрия:
 *  Пол:       Y = -2,  Z: -12 → +12,  X: -12 → +12
 *  Потолок:   Y = +9
 *  Задняя стена: Z = -12  ← сюда будет направлен проектор
 *  Боковые:   X = ±12
 *  Стеллаж находится в центре (Z ≈ 0), перед ним камера.
 *  Стойка проектора: Z ≈ -6.5
 */
import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

const WALL_COLOR = "#1e0840";
const FLOOR_COLOR = "#160630";
const ACCENT_COLOR = "#6633cc";

export function Room() {
  const glowRef1 = useRef<THREE.PointLight>(null!);
  const glowRef2 = useRef<THREE.PointLight>(null!);

  // Пульсирующее освещение для атмосферы
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (glowRef1.current) glowRef1.current.intensity = 1.2 + Math.sin(t * 0.7) * 0.3;
    if (glowRef2.current) glowRef2.current.intensity = 0.9 + Math.sin(t * 0.5 + 1.5) * 0.25;
  });

  return (
    <group>
      {/* ── Пол ───────────────────────────────────────────────── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2, 0]} receiveShadow>
        <planeGeometry args={[26, 28]} />
        <meshStandardMaterial color={FLOOR_COLOR} roughness={0.92} metalness={0.08} />
      </mesh>

      {/* Полосы-акценты на полу */}
      {[-2, 0, 2].map((x, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, -1.98, -3]}>
          <planeGeometry args={[0.08, 18]} />
          <meshStandardMaterial
            color={ACCENT_COLOR}
            emissive={ACCENT_COLOR}
            emissiveIntensity={0.4}
            transparent
            opacity={0.6}
          />
        </mesh>
      ))}

      {/* ── Потолок ───────────────────────────────────────────── */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 9, -2]} receiveShadow>
        <planeGeometry args={[26, 28]} />
        <meshStandardMaterial color="#130525" roughness={0.95} />
      </mesh>

      {/* ── Задняя стена (экранная) ────────────────────────────── */}
      <mesh position={[0, 3.5, -12]} receiveShadow>
        <planeGeometry args={[26, 14]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.82} />
      </mesh>

      {/* Мягкое свечение на задней стене (имитация проекции) */}
      <mesh position={[0, 3.5, -11.98]}>
        <planeGeometry args={[10, 7]} />
        <meshStandardMaterial
          color="#330066"
          emissive="#220044"
          emissiveIntensity={0.3}
          transparent
          opacity={0.35}
        />
      </mesh>

      {/* ── Левая стена ───────────────────────────────────────── */}
      <mesh position={[-13, 3.5, -2]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[28, 14]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.85} />
      </mesh>

      {/* ── Правая стена ──────────────────────────────────────── */}
      <mesh position={[13, 3.5, -2]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[28, 14]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.85} />
      </mesh>

      {/* ── Направляющие огни на потолке ──────────────────────── */}
      {[[-4, 0], [0, 0], [4, 0], [0, -5]].map(([x, z], i) => (
        <group key={i} position={[x, 8.7, z - 2]}>
          <mesh>
            <cylinderGeometry args={[0.18, 0.18, 0.12, 16]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#9955ff"
              emissiveIntensity={1.2}
            />
          </mesh>
          <pointLight color="#9955ff" intensity={1.8} distance={6} decay={2} />
        </group>
      ))}

      {/* ── Атмосферное освещение ─────────────────────────────── */}
      {/* Мягкий фиолетовый заполняющий свет */}
      <pointLight ref={glowRef1} position={[0, 6, 2]} color="#7722cc" distance={18} decay={1.5} />
      {/* Синеватая подсветка снизу */}
      <pointLight ref={glowRef2} position={[0, 0, -4]} color="#2244aa" distance={14} decay={2} />
      {/* Тёплый акцент над стеллажом */}
      <pointLight position={[0, 7, 1]} color="#cc88ff" intensity={0.6} distance={12} decay={2} />
    </group>
  );
}
