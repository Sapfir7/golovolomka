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
varying vec2 vUv;

void main() {
  vec2 c = vUv - 0.5;
  float r = length(c);
  float disk = 1.0 - smoothstep(0.485, 0.5, r);
  if (disk < 0.001) discard;

  vec3 rgb = texture2D(map, vUv).rgb;
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(vec3(lum), rgb, 0.76);
  rgb = clamp(rgb * 0.93 + vec3(0.025, 0.022, 0.02), 0.0, 1.0);
  vec3 photoTinted = mix(rgb, uTint * (0.48 + 0.85 * lum), 0.55);

  float rn = clamp(r * 2.0, 0.0, 1.0);

  // Inner vignette: pull mid-radius toward memory hue, strength follows photo brightness
  float innerVig = smoothstep(0.2, 0.5, rn) * (1.0 - smoothstep(0.46, 0.8, rn));
  float memSat = 0.42 + 0.58 * lum;
  vec3 memWash = uTint * memSat;
  vec3 saturated = mix(photoTinted, memWash, innerVig * 0.5);

  float photoW = 1.0 - smoothstep(0.38, 0.86, rn);
  vec3 edgeMid = uTint * 0.48;
  vec3 edgeDark = uTint * 0.11;
  vec3 edgeFill = mix(edgeMid, edgeDark, smoothstep(0.5, 1.0, rn));
  vec3 tinted = mix(edgeFill, saturated, photoW);

  float topGlow = smoothstep(0.2, 0.62, vUv.y) * smoothstep(0.55, 0.25, r) * 0.35;
  tinted += uTint * topGlow;
  float botGlow = smoothstep(0.88, 0.42, vUv.y) * smoothstep(0.32, 0.5, r) * 0.09;
  tinted += uTint * 0.9 * botGlow;

  float alphaRadial = mix(0.99, 1.0, smoothstep(0.16, 0.74, rn));
  gl_FragColor = vec4(tinted, uOpacity * disk * alphaRadial);
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

  /** Disk diameter ≈ sphere silhouette (2·r); was 1.68·r and left transparent rim */
  const planeSize = radius * 2.06;

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
      },
      vertexShader: previewVert,
      fragmentShader: previewFrag,
      transparent: true,
      toneMapped: false,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    previewMatRef.current = m;
    return m;
  }, [texture, tintColor]);

  useEffect(() => () => { previewMat?.dispose(); }, [previewMat]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    if (previewMatRef.current) {
      const base = isSelected ? 0.995 : 0.99;
      const pulse = Math.sin(t * 0.7 + phase) * 0.004;
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
            position={[0, 0, radius * 0.042]}
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
