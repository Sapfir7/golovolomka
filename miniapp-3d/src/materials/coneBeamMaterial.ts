import * as THREE from "three";
import { CONE_BEAM_NEUTRAL } from "../memoryPalette";

/**
 * Volumetric cone beam — distance + angle attenuation + 2D FBM noise
 * (same family as screenProjectionMaterial vignette) to break up hard edges.
 */

const vert = `
uniform float uYMin;
uniform float uInvH;
varying float vT;
varying vec3 vLocalPos;
varying vec3 vNormal2;
varying vec3 vWorldPosition;
varying vec4 vClipPos;

void main() {
  vLocalPos = position;
  vT = clamp((position.y - uYMin) * uInvH, 0.0, 1.0);
  vNormal2 = normalize(normalMatrix * normal);

  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;

  vClipPos = projectionMatrix * viewMatrix * worldPos;
  gl_Position = vClipPos;
}
`;

const frag = `
precision highp float;
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
uniform float uReveal;
uniform vec3 uSpotPos;
uniform float uAttenuation;
uniform float uAnglePower;

varying float vT;
varying vec3 vLocalPos;
varying vec3 vNormal2;
varying vec3 vWorldPosition;
varying vec4 vClipPos;

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

float fbm3(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise3(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

// Same 2D noise stack as screenProjectionMaterial (vignette grain)
float hash2(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i), hash2(i + vec2(1,0)), f.x),
    mix(hash2(i + vec2(0,1)), hash2(i + vec2(1,1)), f.x),
    f.y);
}

float fbm2(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise2(p);
    p *= 2.2;
    a *= 0.45;
  }
  return v;
}

void main() {
  float dist = distance(vWorldPosition, uSpotPos) / uAttenuation;
  float intensity = 1.0 - clamp(dist, 0.0, 1.0);

  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float angleFade = pow(abs(dot(vNormal2, viewDir)), uAnglePower);
  intensity *= angleFade;

  float revealEdge = 1.0 - uReveal;
  float revealMask = smoothstep(revealEdge, revealEdge + 0.3, vT);

  vec3 np = vLocalPos * 0.6 + vec3(uTime * 0.04, uTime * 0.06, uTime * 0.03);
  float n3 = fbm3(np);

  // Wall silhouette noise (azimuth + height) — breaks cone facets into light
  float az = atan(vLocalPos.z, vLocalPos.x);
  float radXZ = length(vLocalPos.xz) + 1e-4;
  vec2 wallUv = vec2(az * 2.8 + uTime * 0.05, vT * 9.0 + n3 * 0.4);
  float wallGrain = fbm2(wallUv);
  float wallFine = noise2(vec2(az * 6.0 - uTime * 0.1, radXZ * 2.5 + vT * 4.0));
  float wallBreak = mix(0.42, 1.0, wallGrain) * mix(0.62, 1.0, wallFine);
  intensity *= wallBreak;

  vec2 ndc = vClipPos.xy / max(vClipPos.w, 1e-4);
  vec2 screenUv = ndc * 0.5 + 0.5;
  vec2 grainUv = screenUv * 720.0 + vec2(uTime * 0.06, uTime * 0.04);
  float n2 = fbm2(grainUv * 0.07 + vec2(uTime * 0.04, -uTime * 0.03));
  float edgeBreak = mix(0.48, 1.0, n2);
  intensity *= edgeBreak;

  float alpha = uStrength * intensity * revealMask;
  alpha *= mix(0.55, 1.0, n3);

  vec3 col = uColor * (1.12 + 0.32 * n3 + 0.08 * (n2 - 0.5));

  gl_FragColor = vec4(col, alpha);
}
`;

export function createConeBeamMaterial(
  geometry: THREE.BufferGeometry,
  opts?: {
    color?: THREE.ColorRepresentation;
    strength?: number;
    spotPos?: THREE.Vector3;
    attenuation?: number;
    anglePower?: number;
  }
): THREE.ShaderMaterial {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const minY = box.min.y;
  const maxY = box.max.y;
  const range = Math.max(maxY - minY, 1e-4);

  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(opts?.color ?? CONE_BEAM_NEUTRAL) },
      uStrength: { value: opts?.strength ?? 0.0 },
      uReveal: { value: 0.0 },
      uYMin: { value: minY },
      uInvH: { value: 1 / range },
      uTime: { value: 0 },
      uSpotPos: { value: opts?.spotPos?.clone() ?? new THREE.Vector3(0, maxY, 0) },
      uAttenuation: { value: opts?.attenuation ?? 5.0 },
      uAnglePower: { value: opts?.anglePower ?? 4.0 },
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
