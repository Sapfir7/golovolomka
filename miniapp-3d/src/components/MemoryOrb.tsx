/**
 * MemoryOrb — превью на внутренней сфере (MeshBasic), снаружи цветное стекло.
 */
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { MemoryColor } from "../types";
import { getPreviewTexture } from "../previewTextureCache";
import { COLOR_HEX, EMISSIVE_HEX } from "../memoryPalette";

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
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current || isTransitioning) return;
    const t = clock.getElapsedTime();
    if (texture) {
      if (!basicRef.current) return;
      const base = isSelected ? 0.92 : 0.88;
      const pulse = isSelected ? Math.sin(t * 1.8 + phase) * 0.03 : Math.sin(t * 0.7 + phase) * 0.02;
      basicRef.current.opacity = Math.min(0.98, base + pulse);
    } else {
      if (!coreRef.current) return;
      const base = isSelected ? 0.38 : 0.28;
      const pulse = isSelected ? Math.sin(t * 1.8 + phase) * 0.05 : Math.sin(t * 0.7 + phase) * 0.03;
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

  const innerScale = radius * 1.18;

  return (
    <group ref={groupRef} position={position} onClick={handleClick}>
      {texture ? (
        <mesh scale={[innerScale, innerScale, innerScale]}>
          <sphereGeometry args={[1, 32, 32]} />
          <meshBasicMaterial
            ref={basicRef}
            map={texture}
            color="#ffffff"
            toneMapped={false}
            transparent
            opacity={0.9}
            depthWrite={false}
          />
        </mesh>
      ) : (
        <mesh scale={[innerScale, innerScale, innerScale]}>
          <sphereGeometry args={[1, 20, 20]} />
          <meshStandardMaterial
            ref={coreRef}
            color={hex}
            emissive={emissive}
            emissiveIntensity={0.32}
            roughness={0.55}
            metalness={0}
            transparent
            opacity={0.78}
            depthWrite={false}
          />
        </mesh>
      )}

      <mesh>
        <sphereGeometry args={[radius, 20, 20]} />
        <meshStandardMaterial
          color={hex}
          roughness={0.35}
          metalness={0.05}
          transparent
          opacity={0.42}
          depthWrite={false}
          envMapIntensity={0.35}
        />
      </mesh>
    </group>
  );
}
