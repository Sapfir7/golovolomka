/**
 * MemoryOrb — превью видно только на стороне шара, обращённой к камере.
 */
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { MemoryColor } from "../types";
import { getPreviewTexture } from "../previewTextureCache";
import { COLOR_HEX, EMISSIVE_HEX } from "../memoryPalette";

const orbPreviewVert = `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const orbPreviewFrag = `
precision highp float;
uniform sampler2D map;
uniform vec3 uCamPos;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
  vec3 viewDir = normalize(uCamPos - vWorldPos);
  float facing = dot(normalize(vWorldNormal), viewDir);
  float vis = smoothstep(0.0, 0.35, facing);
  vec4 c = texture2D(map, vUv);
  gl_FragColor = vec4(c.rgb, c.a * vis * uOpacity);
}
`;

function makeOrbMat(map: THREE.Texture, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      uCamPos: { value: new THREE.Vector3() },
      uOpacity: { value: opacity },
    },
    vertexShader: orbPreviewVert,
    fragmentShader: orbPreviewFrag,
    transparent: true,
    toneMapped: false,
    depthWrite: false,
  });
}

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
  const { gl, camera } = useThree();
  const groupRef = useRef<THREE.Group>(null!);
  const shaderMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const coreRef = useRef<THREE.MeshStandardMaterial>(null!);
  const phase = useMemo(() => (orbIndex * 0.73) % (Math.PI * 2), [orbIndex]);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [orbMat, setOrbMat] = useState<THREE.ShaderMaterial | null>(null);

  useEffect(() => {
    if (!texture) {
      shaderMatRef.current = null;
      setOrbMat(null);
      return;
    }
    const m = makeOrbMat(texture, 0.9);
    shaderMatRef.current = m;
    setOrbMat(m);
    return () => {
      m.dispose();
      shaderMatRef.current = null;
    };
  }, [texture]);

  useFrame(({ clock }) => {
    const m = shaderMatRef.current;
    if (m) m.uniforms.uCamPos.value.copy(camera.position);
    if (!groupRef.current || isTransitioning) return;
    const t = clock.getElapsedTime();
    if (m) {
      const base = isSelected ? 0.92 : 0.88;
      const pulse = isSelected ? Math.sin(t * 1.8 + phase) * 0.03 : Math.sin(t * 0.7 + phase) * 0.02;
      m.uniforms.uOpacity.value = Math.min(0.98, base + pulse);
    } else if (coreRef.current) {
      const base = isSelected ? 0.38 : 0.28;
      const pulse = isSelected ? Math.sin(t * 1.8 + phase) * 0.05 : Math.sin(t * 0.7 + phase) * 0.03;
      coreRef.current.emissiveIntensity = base + pulse;
    }
  });

  const handleClick = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onClick?.();
    },
    [onClick]
  );

  const hex = COLOR_HEX[color];
  const emissive = EMISSIVE_HEX[color];

  useEffect(() => {
    if (!previewUrl) {
      setTexture(null);
      return;
    }
    let cancelled = false;
    getPreviewTexture(previewUrl).then((tex) => {
      if (!cancelled && tex) setTexture(tex);
    });
    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!texture) return;
    const maxA = gl.capabilities.getMaxAnisotropy();
    texture.anisotropy = Math.min(8, maxA);
    texture.needsUpdate = true;
  }, [texture, gl]);

  const innerScale = radius * 1.18;

  return (
    <group ref={groupRef} position={position} onClick={handleClick}>
      {texture && orbMat ? (
        <mesh scale={[innerScale, innerScale, innerScale]} material={orbMat}>
          <sphereGeometry args={[1, 32, 32]} />
        </mesh>
      ) : (
        <mesh scale={[innerScale, innerScale, innerScale]}>
          <sphereGeometry args={[1, 20, 20]} />
          <meshStandardMaterial
            ref={coreRef}
            color={hex}
            emissive={emissive}
            emissiveIntensity={0.32}
            roughness={0.55}
            metalness={0}
            transparent
            opacity={0.78}
            depthWrite={false}
          />
        </mesh>
      )}

      <mesh>
        <sphereGeometry args={[radius, 20, 20]} />
        <meshStandardMaterial
          color={hex}
          roughness={0.35}
          metalness={0.05}
          transparent
          opacity={0.42}
          depthWrite={false}
          envMapIntensity={0.35}
        />
      </mesh>
    </group>
  );
}
