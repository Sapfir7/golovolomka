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
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
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
  previewUrl?: string | null;
  radius?: number;
  onClick?: () => void;
}

export function MemoryOrb({
  position,
  color,
  orbIndex,
  isSelected,
  isTransitioning,
  previewUrl,
  radius = 0.1125,
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
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!previewUrl) {
      setTexture(null);
      return;
    }
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.load(
      previewUrl,
      (t) => {
        if (cancelled) return;
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        setTexture(t);
      },
      undefined,
      () => setTexture(null)
    );
    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  return (
    <group ref={groupRef} position={position} onClick={handleClick}>
      {/* Внутреннее ядро с превью: фото слегка "внутри стекла" */}
      <mesh scale={[radius * 1.3, radius * 1.3, radius * 1.3]}>
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial
          ref={coreRef}
          color={hex}
          emissive={emissive}
          emissiveIntensity={0.75}
          map={texture}
          roughness={0.55}
          metalness={0}
          transparent
          opacity={texture ? 0.88 : 0.55}
          depthWrite={false}
        />
      </mesh>

      {/* Стеклянная оболочка */}
      <mesh>
        <sphereGeometry args={[radius, 42, 42]} />
        <meshPhysicalMaterial
          color={hex}
          transmission={0.94}
          thickness={radius * 0.5}
          roughness={0.16}
          metalness={0}
          ior={1.48}
          reflectivity={0.35}
          clearcoat={1}
          clearcoatRoughness={0.1}
          envMapIntensity={1.4}
          transparent
          opacity={0.85}
          depthWrite={false}
        />
      </mesh>

      {/* Локальный свет от шара */}
      <pointLight
        color={hex}
        intensity={isSelected ? 0.9 : 0.35}
        distance={0.9}
        decay={2}
      />
    </group>
  );
}
