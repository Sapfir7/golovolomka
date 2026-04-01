import * as THREE from "three";

const vert = `
uniform float uYMin;
uniform float uInvH;
varying float vT;
varying float vR;
varying vec3 vLocalPos;

void main() {
  vLocalPos = position;
  float h = (position.y - uYMin) * uInvH;
  vT = clamp(h, 0.0, 1.0);
  float maxR = max(length(position.xz), 0.001);
  vR = length(position.xz) / maxR;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const frag = `
precision highp float;
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
varying float vT;
varying vec3 vLocalPos;

// Cheap 3D noise for volumetric feel
float hash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z);
  return n;
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise3(p);
    p *= 2.1;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 np = vLocalPos * 3.5 + vec3(0.0, uTime * 0.2, 0.0);
  float n = fbm(np);

  float axial = smoothstep(0.0, 0.15, vT) * pow(1.0 - vT, 0.3);

  float r = length(vLocalPos.xz);
  float rFade = smoothstep(1.0, 0.2, r / max(r + 0.01, 0.01));

  float noiseEdge = smoothstep(0.25, 0.7, n);
  float a = uStrength * axial * noiseEdge;
  a *= mix(0.7, 1.0, n);

  gl_FragColor = vec4(uColor * (0.9 + 0.2 * n), a);
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

  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(opts?.color ?? "#fff6e0") },
      uStrength: { value: opts?.strength ?? 0.0 },
      uYMin: { value: minY },
      uInvH: { value: 1 / range },
      uTime: { value: 0 },
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
