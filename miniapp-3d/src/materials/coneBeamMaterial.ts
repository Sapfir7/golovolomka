import * as THREE from "three";

const vert = `
uniform float uYMin;
uniform float uInvH;
varying float vT;
varying vec3 vLocalPos;

void main() {
  vLocalPos = position;
  vT = clamp((position.y - uYMin) * uInvH, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const frag = `
precision highp float;
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
uniform float uReveal;
varying float vT;
varying vec3 vLocalPos;

float hash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise3(p);
    p *= 2.1;
    a *= 0.5;
  }
  return v;
}

void main() {
  // Reveal from tip (vT=1) toward base (vT=0)
  float revealEdge = 1.0 - uReveal;
  float revealMask = smoothstep(revealEdge, revealEdge + 0.15, vT);

  // Multi-scale noise for hazy, scattered light
  vec3 np = vLocalPos * 3.0 + vec3(uTime * 0.1, uTime * 0.15, uTime * 0.08);
  float n = fbm(np);
  float wisp = fbm(vLocalPos * 1.2 + vec3(0.0, uTime * 0.06, 0.0));
  float detail = fbm(vLocalPos * 7.0 + vec3(uTime * 0.2, 0.0, uTime * 0.12));

  // Soft fade at both ends of the cone
  float axial = smoothstep(0.0, 0.06, vT) * smoothstep(0.0, 0.06, 1.0 - vT);

  float alpha = uStrength * axial * revealMask;
  alpha *= mix(0.2, 1.0, n);
  alpha *= mix(0.4, 1.0, wisp);
  alpha *= mix(0.7, 1.0, detail);

  vec3 col = uColor * (0.75 + 0.35 * n);
  gl_FragColor = vec4(col, alpha);
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
      uReveal: { value: 0.0 },
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
