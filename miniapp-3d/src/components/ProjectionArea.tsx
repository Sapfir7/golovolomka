/**
 * ProjectionArea – стойка для шара + SpotLight в центре комнаты.
 *
 * Шар опускается сюда во время TRANSITION.
 * SpotLight направлен на заднюю стену и включается в фазе DESK.
 * Реальное изображение воспоминания отображается HTML-оверлеем (UIOverlay).
 */
import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { PROJECTION_STAND_POS } from "./Shelf";

interface ProjectionAreaProps {
  spotlightOn: boolean;
}

export function ProjectionArea({ spotlightOn }: ProjectionAreaProps) {
  const spotRef = useRef<THREE.SpotLight>(null!);
  const lensRef = useRef<THREE.MeshStandardMaterial>(null!);
  const currentIntensity = useRef(0);

  useFrame((_, delta) => {
    const target = spotlightOn ? 22 : 0;
    currentIntensity.current = THREE.MathUtils.lerp(currentIntensity.current, target, delta * 3);
    if (spotRef.current) spotRef.current.intensity = currentIntensity.current;
    if (lensRef.current) lensRef.current.emissiveIntensity = spotlightOn ? 2.5 : 0.05;
  });

  const [sx, sy, sz] = PROJECTION_STAND_POS;

  return (
    <group>
      {/* ── Колонна стойки ────────────────────────────────────── */}
      <mesh position={[sx, sy - 1.2, sz]} castShadow>
        <cylinderGeometry args={[0.07, 0.14, 2.0, 16]} />
        <meshStandardMaterial color="#8899aa" metalness={0.75} roughness={0.25} />
      </mesh>

      {/* ── Основание ─────────────────────────────────────────── */}
      <mesh position={[sx, sy - 2.2, sz]}>
        <cylinderGeometry args={[0.4, 0.45, 0.12, 24]} />
        <meshStandardMaterial color="#556677" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* ── Кольцо-держатель ──────────────────────────────────── */}
      <mesh position={[sx, sy, sz]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.28, 0.045, 12, 40]} />
        <meshStandardMaterial color="#aabbcc" metalness={0.9} roughness={0.1} />
      </mesh>

      {/* ── Маленький проектор над стойкой ────────────────────── */}
      <mesh position={[sx, sy + 1.5, sz + 0.3]} rotation={[0.25, 0, 0]} castShadow>
        <boxGeometry args={[0.6, 0.25, 0.9]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.5} metalness={0.5} />
      </mesh>

      {/* Линза проектора */}
      <mesh position={[sx, sy + 1.5, sz - 0.16]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.05, 20]} />
        <meshStandardMaterial
          ref={lensRef}
          color="#aaccff"
          emissive="#7799ee"
          emissiveIntensity={0.05}
          roughness={0.1}
        />
      </mesh>

      {/* ── SpotLight из проектора на заднюю стену ─────────────── */}
      <spotLight
        ref={spotRef}
        position={[sx, sy + 2.0, sz - 0.1]}
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore drei forwards target
        target-position={[0, 3.5, -12]}
        angle={0.32}
        penumbra={0.55}
        intensity={0}
        color="#dde8ff"
        castShadow={false}
      />

      {/* Мягкое точечное свечение от шара в стойке */}
      <pointLight
        position={[sx, sy, sz]}
        color="#cc99ff"
        intensity={spotlightOn ? 3 : 0}
        distance={4}
        decay={2}
      />
    </group>
  );
}
