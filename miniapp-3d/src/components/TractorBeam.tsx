/**
 * TractorBeam – светящийся белый цилиндр-луч захвата.
 * Появляется только во время TRANSITION.
 * Аддитивное смешивание + Bloom = объёмный световой эффект.
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface TractorBeamProps {
  position: [number, number, number];
  visible: boolean;
}

export function TractorBeam({ position, visible }: TractorBeamProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const matRef = useRef<THREE.MeshStandardMaterial>(null!);
  const opacity = useRef(0);

  useFrame((_, delta) => {
    const target = visible ? 0.5 : 0;
    opacity.current = THREE.MathUtils.lerp(opacity.current, target, delta * 6);
    if (matRef.current) {
      matRef.current.opacity = opacity.current;
    }
    if (meshRef.current) {
      meshRef.current.visible = opacity.current > 0.01;
    }
  });

  return (
    <mesh ref={meshRef} position={position} visible={false}>
      <cylinderGeometry args={[0.32, 0.04, 9, 20, 1, true]} />
      <meshStandardMaterial
        ref={matRef}
        color="#ffffff"
        emissive="#bbddff"
        emissiveIntensity={4}
        transparent
        opacity={0}
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}
