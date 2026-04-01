/**
 * MemoryOrb — glass sphere with preview texture projected flat onto inner sphere,
 * color-tinted, with view-dependent vignette. Preview stays visible during flight.
 */
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { MemoryColor } from "../types";
import { getPreviewTexture } from "../previewTextureCache";
import { COLOR_HEX, EMISSIVE_HEX } from "../memoryPalette";

const innerVert = `
uniform float uRadius;
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = position.xy / uRadius * 0.5 + 0.5;
  vec3 viewNorm = normalize(normalMatrix * normal);
  vFacing = abs(viewNorm.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const innerFrag = `
precision highp float;
uniform sampler2D map;
uniform vec3 uTint;
uniform float uOpacity;
varying vec2 vUv;
varying float vFacing;
void main() {
  vec4 tex = texture2D(map, clamp(vUv, 0.0, 1.0));
  vec3 rgb = tex.rgb;
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  vec3 tinted = mix(rgb, uTint * (0.55 + 0.85 * lum), 0.45);
  float vignette = smoothstep(0.0, 0.5, vFacing);
  gl_FragColor = vec4(tinted, uOpacity * vignette);
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
  previewUrl,
  radius = 0.1125,
  onClick,
}: MemoryOrbProps) {
  const { gl } = useThree();
  const groupRef = useRef<THREE.Group>(null!);
  const coreRef = useRef<THREE.MeshStandardMaterial>(null!);
  const innerMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const phase = useMemo(() => (orbIndex * 0.73) % (Math.PI * 2), [orbIndex]);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  const hex = COLOR_HEX[color];
  const emissive = EMISSIVE_HEX[color];
  const tintColor = useMemo(() => new THREE.Color(hex), [hex]);

  const innerR = radius * 0.96;

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

  const innerMat = useMemo(() => {
    if (!texture) return null;
    const m = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        uTint: { value: tintColor.clone() },
        uOpacity: { value: 1.0 },
        uRadius: { value: innerR },
      },
      vertexShader: innerVert,
      fragmentShader: innerFrag,
      transparent: true,
      toneMapped: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    innerMatRef.current = m;
    return m;
  }, [texture, tintColor, innerR]);

  useEffect(() => () => { innerMat?.dispose(); }, [innerMat]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    if (innerMatRef.current) {
      const base = isSelected ? 0.98 : 0.95;
      const pulse = Math.sin(t * 0.7 + phase) * 0.02;
      innerMatRef.current.uniforms.uOpacity.value = Math.min(1.0, base + pulse);
    } else if (coreRef.current) {
      const base = isSelected ? 0.45 : 0.35;
      const pulse = Math.sin(t * 0.7 + phase) * 0.04;
      coreRef.current.emissiveIntensity = base + pulse;
    }
  });

  const handleClick = useCallback(
    (e: { stopPropagation: () => void }) => { e.stopPropagation(); onClick?.(); },
    [onClick]
  );

  return (
    <group ref={groupRef} position={position} onClick={handleClick}>
      {/* Inner sphere with flat-projected preview + view-dependent vignette */}
      {texture && innerMat ? (
        <mesh material={innerMat}>
          <sphereGeometry args={[innerR, 32, 32]} />
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

      {/* Subtle colored glow */}
      <pointLight color={hex} intensity={0.3} distance={0.6} decay={2} />

      {/* Outer glass sphere */}
      <mesh>
        <sphereGeometry args={[radius, 28, 28]} />
        <meshPhysicalMaterial
          color={hex}
          roughness={0.25}
          metalness={0.0}
          transparent
          opacity={0.32}
          transmission={0.25}
          thickness={0.6}
          ior={1.45}
          envMapIntensity={0.4}
          clearcoat={0.3}
          clearcoatRoughness={0.15}
          depthWrite={false}
          side={THREE.FrontSide}
        />
      </mesh>
    </group>
  );
}
