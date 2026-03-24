/**
 * TractorBeam – a glowing white vertical cylinder that appears during TRANSITION.
 *
 * The beam is rendered as a tall CylinderGeometry with an additive-blended
 * MeshStandardMaterial (emissive white). Bloom from postprocessing makes it
 * look like a true volumetric shaft of light.
 *
 * Visibility is controlled by the parent via `visible` prop; the beam fades
 * in/out via animated opacity in useFrame.
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface TractorBeamProps {
  /** World position of the base of the beam (usually above the orb) */
  position: [number, number, number];
  visible: boolean;
}

export function TractorBeam({ position, visible }: TractorBeamProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const matRef = useRef<THREE.MeshStandardMaterial>(null!);
  const opacityRef = useRef(0);

  useFrame((_, delta) => {
    if (!matRef.current) return;
    const target = visible ? 0.55 : 0;
    opacityRef.current = THREE.MathUtils.lerp(opacityRef.current, target, delta * 5);
    matRef.current.opacity = opacityRef.current;
    matRef.current.needsUpdate = true;
    if (meshRef.current) {
      meshRef.current.visible = opacityRef.current > 0.01;
    }
  });

  return (
    <mesh ref={meshRef} position={position} visible={visible || opacityRef.current > 0.01}>
      {/* Wide at top (8 units tall), narrow at bottom to match orb size */}
      <cylinderGeometry args={[0.35, 0.05, 8, 24, 1, true]} />
      <meshStandardMaterial
        ref={matRef}
        color="#ffffff"
        emissive="#aaddff"
        emissiveIntensity={3.5}
        transparent
        opacity={0}
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}
