/**
 * MemoryOrb – a single glowing glass sphere containing a memory.
 *
 * Construction:
 *  1. Outer shell: MeshPhysicalMaterial (transmission + roughness) for glass refraction
 *  2. Inner glow plane: PlaneGeometry with colored emissive material (simulates the core glow)
 *  3. Levitation: sine-wave animation in useFrame, phase offset by index
 *
 * Colors map to "Головоломка" palette:
 *   yellow → #FFD700  (joy)
 *   blue   → #4FC3F7  (sadness)
 *   red    → #EF5350  (anger)
 *   purple → #CE93D8  (fear/anxiety)
 */
import { useRef, useMemo, useCallback } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { MemoryColor } from "../types";

export const COLOR_MAP: Record<MemoryColor, string> = {
  yellow: "#FFE566",
  blue: "#59C9F5",
  red: "#FF5C5C",
  purple: "#C87FFF",
};

export const EMISSIVE_MAP: Record<MemoryColor, string> = {
  yellow: "#FFC200",
  blue: "#0088CC",
  red: "#CC1100",
  purple: "#8800CC",
};

interface MemoryOrbProps {
  position: [number, number, number];
  color: MemoryColor;
  /** 0-based index used to offset the levitation phase */
  orbIndex: number;
  isSelected: boolean;
  isTransitioning: boolean;
  onClick: () => void;
  /** Ref forwarded from parent to drive GSAP animation of this orb's position */
  posRef?: React.RefObject<THREE.Group>;
}

export function MemoryOrb({
  position,
  color,
  orbIndex,
  isSelected,
  isTransitioning,
  onClick,
  posRef,
}: MemoryOrbProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const innerRef = useRef<THREE.Mesh>(null!);
  const glowRef = useRef<THREE.Mesh>(null!);

  const hexColor = COLOR_MAP[color];
  const emissive = EMISSIVE_MAP[color];

  // Levitation phase offset so orbs don't all move in sync
  const phaseOffset = useMemo(() => (orbIndex * 0.73) % (Math.PI * 2), [orbIndex]);
  const baseY = position[1];

  useFrame(({ clock }) => {
    if (!groupRef.current || isTransitioning) return;

    // Gentle vertical bob
    const t = clock.getElapsedTime();
    const levitate = Math.sin(t * 0.9 + phaseOffset) * 0.06;
    groupRef.current.position.y = baseY + levitate;

    // Slow rotation for the inner glow plane to create shimmer
    if (glowRef.current) {
      glowRef.current.rotation.z += 0.003;
    }

    // Pulse emissive intensity when selected
    if (isSelected && innerRef.current) {
      const mat = innerRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.4 + Math.sin(t * 3) * 0.4;
    }
  });

  const handleClick = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onClick();
    },
    [onClick]
  );

  return (
    <group
      ref={(node) => {
        groupRef.current = node!;
        if (posRef) (posRef as React.MutableRefObject<THREE.Group | null>).current = node;
      }}
      position={position}
      onClick={handleClick}
    >
      {/* Inner glow core — emissive disc that shows through glass */}
      <mesh ref={glowRef} scale={[0.55, 0.55, 0.55]}>
        <circleGeometry args={[1, 48]} />
        <meshStandardMaterial
          color={hexColor}
          emissive={emissive}
          emissiveIntensity={isSelected ? 1.8 : 1.1}
          side={THREE.DoubleSide}
          transparent
          opacity={0.92}
        />
      </mesh>

      {/* Secondary soft glow layer at 45° */}
      <mesh ref={innerRef} scale={[0.42, 0.42, 0.42]} rotation={[0, 0, Math.PI / 4]}>
        <circleGeometry args={[1, 8]} />
        <meshStandardMaterial
          color={hexColor}
          emissive={emissive}
          emissiveIntensity={isSelected ? 1.6 : 0.9}
          side={THREE.DoubleSide}
          transparent
          opacity={0.7}
        />
      </mesh>

      {/* Outer glass shell — MeshPhysicalMaterial for refraction */}
      <mesh>
        <sphereGeometry args={[0.55, 64, 64]} />
        <meshPhysicalMaterial
          color={hexColor}
          transmission={0.88}        // glass-like transparency
          thickness={0.6}            // refractive thickness
          roughness={0.05}           // near-smooth glass
          metalness={0.0}
          ior={1.5}                  // index of refraction for glass
          reflectivity={0.3}
          clearcoat={1.0}
          clearcoatRoughness={0.05}
          envMapIntensity={1.2}
          transparent
          opacity={0.92}
          depthWrite={false}
        />
      </mesh>

      {/* Thin point light for per-orb glow spill */}
      <pointLight
        color={hexColor}
        intensity={isSelected ? 2.5 : 1.0}
        distance={1.8}
        decay={2}
      />
    </group>
  );
}
