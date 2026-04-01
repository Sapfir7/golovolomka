/**
 * MemoryOrb — glass sphere with a flat circular photo disc inside, tinted to the orb color.
 *
 * Visual reference: ball.png — the photo is center-cropped 1:1,
 * placed on a flat disc inside the glass sphere, with a circular mask
 * and a color tint/filter overlay matching the orb color.
 */
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { MemoryColor } from "../types";
import { getPreviewTexture } from "../previewTextureCache";
import { COLOR_HEX, EMISSIVE_HEX } from "../memoryPalette";

/* ── Disc shader: circular mask + color tint ── */

const discVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const discFrag = `
precision highp float;
uniform sampler2D map;
uniform vec3 uTint;
uniform float uOpacity;
void main() {
  vec2 c = vUv - 0.5;
  float dist = length(c);
  if (dist > 0.5) discard;

  vec4 tex = texture2D(map, vUv);
  vec3 rgb = tex.rgb;

  // Color-tint: blend toward the orb color (like a colored glass filter)
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  vec3 tinted = mix(rgb, uTint * (0.6 + 0.8 * lum), 0.45);

  // Soft edge for the circle
  float edge = smoothstep(0.5, 0.46, dist);
  gl_FragColor = vec4(tinted, edge * uOpacity * tex.a);
}
`;

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
  const coreRef = useRef<THREE.MeshStandardMaterial>(null!);
  const discMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const phase = useMemo(() => (orbIndex * 0.73) % (Math.PI * 2), [orbIndex]);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  const hex = COLOR_HEX[color];
  const emissive = EMISSIVE_HEX[color];
  const tintColor = useMemo(() => new THREE.Color(hex), [hex]);

  useEffect(() => {
    if (!previewUrl) { setTexture(null); return; }
    let cancelled = false;
    getPreviewTexture(previewUrl).then((tex) => { if (!cancelled && tex) setTexture(tex); });
    return () => { cancelled = true; };
  }, [previewUrl]);

  useEffect(() => {
    if (!texture) return;
    const maxA = gl.capabilities.getMaxAnisotropy();
    texture.anisotropy = Math.min(8, maxA);
    texture.needsUpdate = true;
  }, [texture, gl]);

  const discMat = useMemo(() => {
    if (!texture) return null;
    const m = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        uTint: { value: tintColor.clone() },
        uOpacity: { value: 0.92 },
      },
      vertexShader: discVert,
      fragmentShader: discFrag,
      transparent: true,
      toneMapped: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    discMatRef.current = m;
    return m;
  }, [texture, tintColor]);

  useEffect(() => () => { discMat?.dispose(); }, [discMat]);

  useFrame(({ clock }) => {
    if (!groupRef.current || isTransitioning) return;
    const t = clock.getElapsedTime();

    if (discMatRef.current) {
      const base = isSelected ? 0.95 : 0.9;
      const pulse = isSelected ? Math.sin(t * 1.8 + phase) * 0.03 : Math.sin(t * 0.7 + phase) * 0.02;
      discMatRef.current.uniforms.uOpacity.value = Math.min(0.98, base + pulse);
    } else if (coreRef.current) {
      const base = isSelected ? 0.4 : 0.3;
      const pulse = isSelected ? Math.sin(t * 1.8 + phase) * 0.06 : Math.sin(t * 0.7 + phase) * 0.03;
      coreRef.current.emissiveIntensity = base + pulse;
    }
  });

  const handleClick = useCallback(
    (e: { stopPropagation: () => void }) => { e.stopPropagation(); onClick?.(); },
    [onClick]
  );

  const discRadius = radius * 0.82;

  return (
    <group ref={groupRef} position={position} onClick={handleClick}>
      {/* Inner photo disc (flat circle with circular mask + tint) */}
      {texture && discMat ? (
        <mesh material={discMat} rotation={[0, 0, 0]}>
          <planeGeometry args={[discRadius * 2, discRadius * 2]} />
        </mesh>
      ) : (
        /* Emissive core when no texture */
        <mesh>
          <sphereGeometry args={[radius * 0.6, 16, 16]} />
          <meshStandardMaterial
            ref={coreRef}
            color={hex}
            emissive={emissive}
            emissiveIntensity={0.35}
            roughness={0.5}
            metalness={0}
            transparent
            opacity={0.8}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Outer glass sphere */}
      <mesh>
        <sphereGeometry args={[radius, 24, 24]} />
        <meshPhysicalMaterial
          color={hex}
          roughness={0.08}
          metalness={0.0}
          transparent
          opacity={0.28}
          transmission={0.6}
          thickness={0.4}
          ior={1.45}
          envMapIntensity={0.5}
          clearcoat={0.3}
          clearcoatRoughness={0.1}
          depthWrite={false}
          side={THREE.FrontSide}
        />
      </mesh>
    </group>
  );
}
