/**
 * MemoryOrb – стеклянный светящийся шар воспоминания.
 *
 * Структура (от центра к краям):
 *  1. Два скрещенных диска-ядра (emissive) – создают внутреннее свечение
 *  2. Внешняя стеклянная сфера (MeshPhysicalMaterial, transmission)
 *  3. PointLight для подсветки окружающего пространства
 *
 * Левитация: синусоида по Y с индивидуальной фазой (не все синхронно).
 */
import { useRef, useMemo, useCallback } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { MemoryColor } from "../types";

export const COLOR_HEX: Record<MemoryColor, string> = {
  yellow: "#FFE156",
  blue:   "#52C5F8",
  red:    "#FF5555",
  purple: "#CC7FFF",
};

const EMISSIVE_HEX: Record<MemoryColor, string> = {
  yellow: "#FFB300",
  blue:   "#0077BB",
  red:    "#CC1100",
  purple: "#8800EE",
};

export interface MemoryOrbProps {
  position: [number, number, number];
  color: MemoryColor;
  orbIndex: number;
  isSelected: boolean;
  isTransitioning: boolean;
  onClick?: () => void;
}

export function MemoryOrb({
  position,
  color,
  orbIndex,
  isSelected,
  isTransitioning,
  onClick,
}: MemoryOrbProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const coreRef = useRef<THREE.MeshStandardMaterial>(null!);
  const phase = useMemo(() => (orbIndex * 0.73) % (Math.PI * 2), [orbIndex]);
  const baseY = position[1];

  useFrame(({ clock }) => {
    if (!groupRef.current || isTransitioning) return;
    const t = clock.getElapsedTime();
    groupRef.current.position.y = baseY + Math.sin(t * 0.8 + phase) * 0.07;
    if (coreRef.current) {
      coreRef.current.emissiveIntensity = isSelected
        ? 1.8 + Math.sin(t * 3.5) * 0.5
        : 1.0 + Math.sin(t * 1.2 + phase) * 0.15;
    }
  });

  const handleClick = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onClick?.();
    },
    [onClick]
  );

  const hex = COLOR_HEX[color];
  const emissive = EMISSIVE_HEX[color];

  return (
    <group ref={groupRef} position={position} onClick={handleClick}>
      {/* Внутреннее ядро – первый диск */}
      <mesh scale={[0.5, 0.5, 0.5]}>
        <circleGeometry args={[1, 48]} />
        <meshStandardMaterial
          ref={coreRef}
          color={hex}
          emissive={emissive}
          emissiveIntensity={1.0}
          side={THREE.DoubleSide}
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      </mesh>

      {/* Внутреннее ядро – второй диск под углом 45° */}
      <mesh scale={[0.38, 0.38, 0.38]} rotation={[0, 0, Math.PI / 4]}>
        <circleGeometry args={[1, 8]} />
        <meshStandardMaterial
          color={hex}
          emissive={emissive}
          emissiveIntensity={0.7}
          side={THREE.DoubleSide}
          transparent
          opacity={0.6}
          depthWrite={false}
        />
      </mesh>

      {/* Стеклянная оболочка */}
      <mesh>
        <sphereGeometry args={[0.54, 56, 56]} />
        <meshPhysicalMaterial
          color={hex}
          transmission={0.9}
          thickness={0.55}
          roughness={0.04}
          metalness={0}
          ior={1.48}
          reflectivity={0.28}
          clearcoat={1}
          clearcoatRoughness={0.04}
          envMapIntensity={1.4}
          transparent
          opacity={0.94}
          depthWrite={false}
        />
      </mesh>

      {/* Локальный свет от шара */}
      <pointLight
        color={hex}
        intensity={isSelected ? 3.0 : 1.2}
        distance={2.0}
        decay={2}
      />
    </group>
  );
}
