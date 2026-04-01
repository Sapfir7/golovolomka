/**
 * MemoryOrb — glass sphere with a flat circular photo disc inside, tinted to the orb color.
 */
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { MemoryColor } from "../types";
import { getPreviewTexture } from "../previewTextureCache";
import { COLOR_HEX, EMISSIVE_HEX } from "../memoryPalette";

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
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float dist = length(c);
  if (dist > 0.5) discard;

  vec4 tex = texture2D(map, vUv);
  vec3 rgb = tex.rgb;

  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  vec3 tinted = mix(rgb, uTint * (0.6 + 0.8 * lum), 0.38);

  float edge = smoothstep(0.5, 0.44, dist);
  gl_FragColor = vec4(tinted, edge * uOpacity);
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
        uOpacity: { value: 1.0 },
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
      const base = isSelected ? 0.98 : 0.95;
      const pulse = isSelected ? Math.sin(t * 1.8 + phase) * 0.02 : Math.sin(t * 0.7 + phase) * 0.015;
      discMatRef.current.uniforms.uOpacity.value = Math.min(1.0, base + pulse);
    } else if (coreRef.current) {
      const base = isSelected ? 0.45 : 0.35;
      const pulse = isSelected ? Math.sin(t * 1.8 + phase) * 0.06 : Math.sin(t * 0.7 + phase) * 0.03;
      coreRef.current.emissiveIntensity = base + pulse;
    }
  });

  const handleClick = useCallback(
    (e: { stopPropagation: () => void }) => { e.stopPropagation(); onClick?.(); },
    [onClick]
  );

  const discRadius = radius * 0.85;

  return (
    <group ref={groupRef} position={position} onClick={handleClick}>
      {texture && discMat ? (
        <mesh material={discMat}>
          <planeGeometry args={[discRadius * 2, discRadius * 2]} />
        </mesh>
      ) : (
        <mesh>
          <sphereGeometry args={[radius * 0.65, 16, 16]} />
          <meshStandardMaterial
            ref={coreRef}
            color={hex}
            emissive={emissive}
            emissiveIntensity={0.4}
            roughness={0.45}
            metalness={0}
            transparent
            opacity={0.85}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Outer glass sphere */}
      <mesh>
        <sphereGeometry args={[radius, 28, 28]} />
        <meshPhysicalMaterial
          color={hex}
          roughness={0.05}
          metalness={0.0}
          transparent
          opacity={0.45}
          transmission={0.35}
          thickness={0.5}
          ior={1.5}
          envMapIntensity={0.6}
          clearcoat={0.5}
          clearcoatRoughness={0.08}
          depthWrite={false}
          side={THREE.FrontSide}
        />
      </mesh>
    </group>
  );
}
