import * as THREE from "three";

/**
 * Луч для меша-конуса из GLB (без текстур).
 * Локальная ось: считаем, что «вытянутость» по Y (как стандартный конус в Blender → glTF).
 * При другой ориентации — поверните конус в Blender.
 */
const vert = `
uniform float uYMin;
uniform float uInvYRange;
uniform float uBaseRadius;
varying float vT;
varying float vRadial;

void main() {
  vT = clamp((position.y - uYMin) * uInvYRange, 0.0, 1.0);
  float rMax = max(uBaseRadius * vT, uBaseRadius * 0.08);
  vRadial = length(position.xz) / rMax;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const frag = `
precision highp float;
uniform vec3 uColor;
uniform float uStrength;
varying float vT;
varying float vRadial;

void main() {
  float axial = smoothstep(0.03, 0.2, vT) * pow(1.0 - vT, 0.28);
  float edge = 1.0 - smoothstep(0.52, 1.02, vRadial);
  float a = uStrength * axial * edge;
  gl_FragColor = vec4(uColor, a);
}
`;

export function createConeBeamMaterial(
  geometry: THREE.BufferGeometry,
  opts?: { color?: THREE.ColorRepresentation; strength?: number }
): THREE.ShaderMaterial {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const minY = box?.min.y ?? -0.5;
  const maxY = box?.max.y ?? 0.5;
  const range = Math.max(maxY - minY, 1e-4);
  const corners = box
    ? [
        Math.hypot(box.min.x, box.min.z),
        Math.hypot(box.max.x, box.min.z),
        Math.hypot(box.min.x, box.max.z),
        Math.hypot(box.max.x, box.max.z),
      ]
    : [0.5];
  const baseRadius = Math.max(...corners, 0.02);

  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(opts?.color ?? "#fff6e0") },
      uStrength: { value: opts?.strength ?? 0.15 },
      uYMin: { value: minY },
      uInvYRange: { value: 1 / range },
      uBaseRadius: { value: baseRadius },
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}
