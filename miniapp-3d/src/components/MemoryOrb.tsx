/**
 * MemoryOrb — шар воспоминания: спокойный, без «левитации», умеренное свечение, превью на ядре.
 */
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { MemoryColor } from "../types";

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
  const groupRef = useRef<THREE.Group>(null!);
  const coreRef = useRef<THREE.MeshStandardMaterial>(null!);
  const phase = useMemo(() => (orbIndex * 0.73) % (Math.PI * 2), [orbIndex]);

  useFrame(({ clock }) => {
    if (!groupRef.current || isTransitioning) return;
    const t = clock.getElapsedTime();
    if (coreRef.current) {
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
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
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
      <mesh scale={[radius * 1.25, radius * 1.25, radius * 1.25]}>
        <sphereGeometry args={[1, 20, 20]} />
        <meshStandardMaterial
          ref={coreRef}
          color={hex}
          emissive={emissive}
          emissiveIntensity={0.32}
          map={texture}
          roughness={0.62}
          metalness={0}
          transparent
          opacity={texture ? 0.92 : 0.62}
          depthWrite={false}
        />
      </mesh>

      <mesh>
        <sphereGeometry args={[radius, 28, 28]} />
        <meshPhysicalMaterial
          color={hex}
          transmission={0.72}
          thickness={radius * 0.45}
          roughness={0.22}
          metalness={0}
          ior={1.45}
          reflectivity={0.22}
          clearcoat={0.45}
          clearcoatRoughness={0.28}
          envMapIntensity={0.55}
          transparent
          opacity={0.88}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
