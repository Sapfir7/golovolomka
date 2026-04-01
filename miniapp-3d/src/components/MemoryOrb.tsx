/**
 * MemoryOrb — превью только на полусфере, обращённой к камере; снаружи стекло.
 */
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { MemoryColor } from "../types";
import { getPreviewTexture } from "../previewTextureCache";
import { COLOR_HEX, EMISSIVE_HEX } from "../memoryPalette";
import { createOrbPreviewMaterial } from "../materials/orbPreviewMaterial";

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
  const { gl, camera } = useThree();
  const groupRef = useRef<THREE.Group>(null!);
  const previewMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const coreRef = useRef<THREE.MeshStandardMaterial>(null!);
  const phase = useMemo(() => (orbIndex * 0.73) % (Math.PI * 2), [orbIndex]);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [previewMat, setPreviewMat] = useState<THREE.ShaderMaterial | null>(null);

  useEffect(() => {
    if (!texture) {
      setPreviewMat(null);
      previewMatRef.current = null;
      return;
    }
    const m = createOrbPreviewMaterial(texture, 0.86);
    previewMatRef.current = m;
    setPreviewMat(m);
    return () => {
      m.dispose();
      previewMatRef.current = null;
    };
  }, [texture]);

  useFrame(({ clock }) => {
    const m = previewMatRef.current;
    if (m?.uniforms?.cameraPosition) {
      m.uniforms.cameraPosition.value.copy(camera.position);
    }
    if (!groupRef.current || isTransitioning) return;
    const t = clock.getElapsedTime();
    if (m) {
      const base = isSelected ? 0.88 : 0.84;
      const pulse = isSelected ? Math.sin(t * 1.8 + phase) * 0.03 : Math.sin(t * 0.7 + phase) * 0.02;
      m.uniforms.uOpacity.value = Math.min(0.95, base + pulse);
    } else {
      if (!coreRef.current) return;
      const base = isSelected ? 0.22 : 0.14;
      const pulse = isSelected ? Math.sin(t * 1.8 + phase) * 0.04 : Math.sin(t * 0.7 + phase) * 0.02;
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
    texture.anisotropy = Math.min(6, maxA);
    texture.needsUpdate = true;
  }, [texture, gl]);

  const innerScale = radius * 1.18;

  return (
    <group ref={groupRef} position={position} onClick={handleClick}>
      {texture && previewMat ? (
        <mesh scale={[innerScale, innerScale, innerScale]} material={previewMat}>
          <sphereGeometry args={[1, 32, 32]} />
        </mesh>
      ) : (
        <mesh scale={[innerScale, innerScale, innerScale]}>
          <sphereGeometry args={[1, 20, 20]} />
          <meshStandardMaterial
            ref={coreRef}
            color={hex}
            emissive={emissive}
            emissiveIntensity={0.16}
            roughness={0.65}
            metalness={0}
            transparent
            opacity={0.55}
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
          opacity={0.22}
          depthWrite={false}
          envMapIntensity={0.25}
        />
      </mesh>
    </group>
  );
}
