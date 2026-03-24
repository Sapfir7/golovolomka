/**
 * DeskProjector – table + stand + projector + screen wall.
 *
 * Geometry layout (local space, group centered at [5, 0, 0]):
 *  • Table top:    box at y=0, xz-extent 3×1.5
 *  • Stand column: cylinder at y=0.5 (sits on table, holds orb above)
 *  • Stand ring:   torus at top of column  ← orb rests here
 *  • Projector:    box at y=0.15 toward back of table
 *  • SpotLight:    positioned above/behind projector, aimed at screen wall
 *  • Screen wall:  large plane at z=-3 (the "projection screen")
 *
 * Playback texture is injected via `screenTexture` prop (a THREE.Texture or null).
 * When null the wall shows a subtle off-white gradient (idle state).
 */
import { useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

interface DeskProjectorProps {
  screenTexture: THREE.Texture | null;
  spotlightOn: boolean;
}

export function DeskProjector({ screenTexture, spotlightOn }: DeskProjectorProps) {
  const spotRef = useRef<THREE.SpotLight>(null!);
  const screenMatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const spotIntensity = useRef(0);

  // Animate spotlight intensity on/off
  useFrame((_, delta) => {
    const target = spotlightOn ? 14 : 0;
    spotIntensity.current = THREE.MathUtils.lerp(spotIntensity.current, target, delta * 3.5);
    if (spotRef.current) {
      spotRef.current.intensity = spotIntensity.current;
    }
  });

  // Swap screen material map when texture changes
  useEffect(() => {
    if (!screenMatRef.current) return;
    screenMatRef.current.map = screenTexture;
    screenMatRef.current.emissiveMap = screenTexture;
    screenMatRef.current.emissiveIntensity = screenTexture ? 0.6 : 0;
    screenMatRef.current.needsUpdate = true;
  }, [screenTexture]);

  return (
    // Whole desk group offset to the right of the shelf
    <group position={[5, -1.65, 0]}>
      {/* ── Table top ─────────────────────────────────────── */}
      <mesh position={[0, 0, 0]} receiveShadow castShadow>
        <boxGeometry args={[3.2, 0.12, 1.8]} />
        <meshStandardMaterial color="#7c5c38" roughness={0.75} metalness={0.05} />
      </mesh>

      {/* ── Orb stand – column ────────────────────────────── */}
      <mesh position={[-0.5, 0.55, 0.2]} castShadow>
        <cylinderGeometry args={[0.06, 0.12, 1.0, 16]} />
        <meshStandardMaterial color="#a0a0b0" roughness={0.3} metalness={0.7} />
      </mesh>

      {/* ── Orb stand – cradle ring ───────────────────────── */}
      <mesh position={[-0.5, 1.08, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.22, 0.04, 12, 32]} />
        <meshStandardMaterial color="#888899" roughness={0.2} metalness={0.8} />
      </mesh>

      {/* ── Projector body ────────────────────────────────── */}
      <mesh position={[0.7, 0.22, -0.3]} castShadow>
        <boxGeometry args={[0.85, 0.3, 0.5]} />
        <meshStandardMaterial color="#222233" roughness={0.55} metalness={0.4} />
      </mesh>

      {/* Projector lens (emissive when on) */}
      <mesh position={[0.7, 0.22, -0.56]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 0.06, 24]} />
        <meshStandardMaterial
          color="#aaccff"
          emissive="#88aaff"
          emissiveIntensity={spotlightOn ? 2.5 : 0.1}
          roughness={0.1}
          metalness={0.2}
        />
      </mesh>

      {/* ── SpotLight from projector toward screen ─────────── */}
      <spotLight
        ref={spotRef}
        position={[0.7, 0.9, -0.3]}
        target-position={[0, 0.5, -4]}
        angle={0.38}
        penumbra={0.4}
        intensity={0}
        color="#ddeeff"
        castShadow
        shadow-mapSize={[1024, 1024]}
      />

      {/* ── Screen wall ───────────────────────────────────── */}
      <mesh position={[0, 1.5, -3.2]} receiveShadow>
        <planeGeometry args={[4.5, 3.2]} />
        <meshStandardMaterial
          ref={screenMatRef}
          color="#f5f5fa"
          emissive="#f5f5fa"
          emissiveIntensity={0}
          roughness={0.85}
        />
      </mesh>

      {/* Screen frame border */}
      <mesh position={[0, 1.5, -3.21]}>
        <ringGeometry args={[2.3, 2.38, 4]} />
        <meshStandardMaterial color="#333344" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** World position of the orb stand cradle (where the orb lands) */
export const STAND_WORLD: [number, number, number] = [4.6, -0.57, 1.4];
