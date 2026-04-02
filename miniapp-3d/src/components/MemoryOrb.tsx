/**
 * MemoryOrb — glass sphere + billboard preview (always faces camera, no parallax swim).
 * Retro matte look + soft top glow (bloom-friendly).
 */
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import type { MemoryColor } from "../types";
import { getPreviewTexture } from "../previewTextureCache";
import { COLOR_HEX, EMISSIVE_HEX } from "../memoryPalette";

const previewVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const previewFrag = `
precision highp float;
uniform sampler2D map;
uniform vec3 uTint;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;

void main() {
  vec2 c = vUv - 0.5;
  float r = length(c);
  float edge = 1.0 - smoothstep(0.36, 0.5, r);
  if (edge < 0.001) discard;

  vec3 rgb = texture2D(map, vUv).rgb;
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(vec3(lum), rgb, 0.76);
  rgb = clamp(rgb * 0.93 + vec3(0.025, 0.022, 0.02), 0.0, 1.0);
  vec3 tinted = mix(rgb, uTint * (0.48 + 0.85 * lum), 0.55);

  float topGlow = smoothstep(0.2, 0.62, vUv.y) * smoothstep(0.55, 0.25, r) * 0.42;
  tinted += vec3(0.941, 0.824, 0.008) * topGlow;

  float botCool = smoothstep(0.88, 0.42, vUv.y) * smoothstep(0.32, 0.5, r) * 0.1;
  tinted += vec3(0.357, 0.580, 0.929) * botCool;

  float g = fract(sin(dot(vUv * 620.0 + uTime * 0.5, vec2(12.9898, 78.233))) * 43758.5453);
  tinted += (g - 0.5) * 0.035;

  gl_FragColor = vec4(tinted, uOpacity * edge);
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
  const previewMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const phase = useMemo(() => (orbIndex * 0.73) % (Math.PI * 2), [orbIndex]);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  const hex = COLOR_HEX[color];
  const emissive = EMISSIVE_HEX[color];
  const tintColor = useMemo(() => new THREE.Color(hex), [hex]);

  const planeSize = radius * 1.68;

  useEffect(() => {
    if (!previewUrl) { setTexture(null); return; }
    let cancelled = false;
    getPreviewTexture(previewUrl).then((tex) => { if (!cancelled && tex) setTexture(tex); });
    return () => { cancelled = true; };
  }, [previewUrl]);

  useEffect(() => {
    if (!texture) return;
    const maxA = gl.capabilities.getMaxAnisotropy();
    texture.anisotropy = Math.min(4, maxA);
    texture.needsUpdate = true;
  }, [texture, gl]);

  const previewMat = useMemo(() => {
    if (!texture) return null;
    const m = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        uTint: { value: tintColor.clone() },
        uOpacity: { value: 1.0 },
        uTime: { value: 0 },
      },
      vertexShader: previewVert,
      fragmentShader: previewFrag,
      transparent: true,
      toneMapped: false,
      depthWrite: false,
      depthTest: true,
    });
    previewMatRef.current = m;
    return m;
  }, [texture, tintColor]);

  useEffect(() => () => { previewMat?.dispose(); }, [previewMat]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    if (previewMatRef.current) {
      previewMatRef.current.uniforms.uTime.value = t;
      const base = isSelected ? 0.98 : 0.95;
      const pulse = Math.sin(t * 0.7 + phase) * 0.02;
      previewMatRef.current.uniforms.uOpacity.value = Math.min(1.0, base + pulse);
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
      {texture && previewMat ? (
        <Billboard follow={true} lockX={false} lockY={false} lockZ={false}>
          <mesh
            material={previewMat}
            position={[0, 0, 0.004]}
            renderOrder={-1}
          >
            <planeGeometry args={[planeSize, planeSize]} />
          </mesh>
        </Billboard>
      ) : (
        <mesh>
          <sphereGeometry args={[radius * 0.65, 12, 12]} />
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

      <pointLight color={hex} intensity={0.28} distance={0.55} decay={2} />

      <mesh renderOrder={0}>
        <sphereGeometry args={[radius, 20, 20]} />
        <meshPhysicalMaterial
          color={hex}
          roughness={0.38}
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
