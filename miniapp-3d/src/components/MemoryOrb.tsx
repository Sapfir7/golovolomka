/**
 * MemoryOrb — шар воспоминания: спокойный, умеренное свечение, превью на ядре.
 *
 * С превью: MeshBasicMaterial + toneMapped:false (чёткая картинка без «грязи» от лайтинга).
 * Без превью: стандартный материал с emissive.
 */
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { MemoryColor } from "../types";
import { getPreviewTexture } from "../previewTextureCache";

export const COLOR_HEX: Record<MemoryColor, string> = {
  yellow: "#FFE156",
  blue: "#52C5F8",
  red: "#FF5555",
  purple: "#CC7FFF",
};

const EMISSIVE_HEX: Record<MemoryColor, string> = {
  yellow: "#B8860B",
  blue: "#2A8BC4",
  red: "#AA3333",
  purple: "#6B4AA3",
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
  const { gl } = useThree();
  const groupRef = useRef<THREE.Group>(null!);
  const basicRef = useRef<THREE.MeshBasicMaterial>(null!);
  const coreRef = useRef<THREE.MeshStandardMaterial>(null!);
  const phase = useMemo(() => (orbIndex * 0.73) % (Math.PI * 2), [orbIndex]);

  useFrame(({ clock }) => {
    if (!groupRef.current || isTransitioning) return;
    const t = clock.getElapsedTime();
    if (texture) {
      if (!basicRef.current) return;
      const base = isSelected ? 0.94 : 0.9;
      const pulse = isSelected ? Math.sin(t * 2.2 + phase) * 0.05 : Math.sin(t * 0.9 + phase) * 0.04;
      basicRef.current.opacity = Math.min(1, base + pulse);
    } else {
      if (!coreRef.current) return;
      const base = isSelected ? 0.42 : 0.28;
      const pulse = isSelected ? Math.sin(t * 2.2 + phase) * 0.06 : Math.sin(t * 0.9 + phase) * 0.03;
      coreRef.current.emissiveIntensity = base + pulse;
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
    getPreviewTexture(previewUrl).then((tex) => {
      if (!cancelled && tex) setTexture(tex);
    });
    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!texture) return;
    const maxA = gl.capabilities.getMaxAnisotropy();
    texture.anisotropy = Math.min(8, maxA);
    texture.needsUpdate = true;
  }, [texture, gl]);

  const innerScale = radius * 1.2;

  return (
    <group ref={groupRef} position={position} onClick={handleClick}>
      {texture ? (
        <mesh scale={[innerScale, innerScale, innerScale]}>
          <sphereGeometry args={[1, 40, 40]} />
          <meshBasicMaterial
            ref={basicRef}
            map={texture}
            color="#ffffff"
            toneMapped={false}
            transparent
            opacity={0.92}
            depthWrite={false}
          />
        </mesh>
      ) : (
        <mesh scale={[innerScale, innerScale, innerScale]}>
          <sphereGeometry args={[1, 28, 28]} />
          <meshStandardMaterial
            ref={coreRef}
            color={hex}
            emissive={emissive}
            emissiveIntensity={0.32}
            roughness={0.6}
            metalness={0}
            transparent
            opacity={0.6}
            depthWrite={false}
          />
        </mesh>
      )}

      <mesh>
        <sphereGeometry args={[radius, 28, 28]} />
        <meshStandardMaterial
          color={hex}
          roughness={0.15}
          metalness={0.08}
          transparent
          opacity={0.35}
          depthWrite={false}
          envMapIntensity={0.5}
        />
      </mesh>
    </group>
  );
}
