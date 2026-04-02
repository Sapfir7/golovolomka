import * as THREE from "three";

const vertexShader = `
varying vec2 vUv;
uniform float uUvRotation;

void main() {
  vec2 uv2 = uv;
  if (abs(uUvRotation) > 0.0001) {
    vec2 c = uv2 - 0.5;
    float cs = cos(uUvRotation);
    float sn = sin(uUvRotation);
    uv2 = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
  }
  vUv = uv2;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
precision highp float;
uniform sampler2D map;
uniform float uMirrorX;
uniform vec3 uVigTint;
uniform float uVigStr;
uniform float uOpacity;
uniform float uColorMix;
uniform float uTexScale;
uniform float uSphereCurve;
varying vec2 vUv;

float hash2(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(hash2(i), hash2(i + vec2(1,0)), u.x),
    mix(hash2(i + vec2(0,1)), hash2(i + vec2(1,1)), u.x),
    u.y);
}

// Lightweight FBM (3 octaves) — smoky vignette without triple fbm cost
float fbmCheap(vec2 p) {
  float v = 0.0, a = 0.55;
  for (int i = 0; i < 3; i++) {
    v += a * noise2(p);
    p *= 2.08;
    a *= 0.48;
  }
  return v;
}

void main() {
  vec2 st = vUv;
  if (uMirrorX > 0.5) st.x = 1.0 - st.x;

  vec2 texUv = clamp((st - 0.5) / uTexScale + 0.5, 0.0, 1.0);
  vec2 dS = texUv - 0.5;
  float sr2 = dot(dS, dS);
  texUv = clamp(0.5 + dS * (1.0 + uSphereCurve * sr2), 0.0, 1.0);
  vec4 texel = texture2D(map, texUv);

  vec2 q = (vUv - 0.5) * 2.0;
  float ellipse = length(q);
  float memR = ellipse / uTexScale;

  float photoMask = 1.0 - smoothstep(0.34, 0.92, memR);
  photoMask = pow(max(photoMask, 0.0), 0.94);

  float lum0 = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
  vec3 photoRetro = mix(vec3(lum0), texel.rgb, 0.88);
  photoRetro = clamp(photoRetro * 0.95 + 0.018, 0.0, 1.0);
  vec3 tinted = mix(photoRetro, uVigTint * (0.5 + lum0 * 0.88), uColorMix);

  vec3 vigBase = mix(uVigTint, vec3(0.98, 0.95, 0.55), 0.14);
  float vn = fbmCheap(vUv * 2.6);
  vec3 vigCol = vigBase * (0.14 + 0.16 * vn);

  vec3 rgb = mix(vigCol, tinted, photoMask);

  float bloomR = smoothstep(0.42, 0.72, memR) * (1.0 - smoothstep(0.72, 1.35, memR));
  vec3 warmRim = mix(uVigTint, vec3(0.941, 0.824, 0.008), 0.45);
  rgb += warmRim * bloomR * uVigStr * 0.22;

  float outerNoise = fbmCheap(vUv * 3.8);
  float outerEdge = 0.72 + outerNoise * 0.1;
  float outerMask = 1.0 - smoothstep(outerEdge - 0.2, outerEdge + 0.07, ellipse);

  float fiberZone = smoothstep(0.42, 0.62, ellipse) *
                    (1.0 - smoothstep(outerEdge - 0.06, outerEdge + 0.1, ellipse));
  outerMask += fiberZone * fbmCheap(vUv * 6.0) * 0.04;
  outerMask = clamp(outerMask, 0.0, 1.0);

  float innerGlow = 1.0 - smoothstep(0.0, uTexScale * 0.5, ellipse);
  rgb += uVigTint * innerGlow * 0.035;

  float grain = (hash2(vUv * 500.0) - 0.5) * 0.014;

  float finalAlpha = outerMask * uOpacity;
  if (finalAlpha < 0.004) discard;
  gl_FragColor = vec4(rgb + grain, finalAlpha);
}
`;

export interface ErkanProjectionUniforms {
  vignetteTint: THREE.Color;
  vignetteStrength: number;
  uvRotation: number;
  mirrorX: boolean;
  colorMix?: number;
  texScale?: number;
  sphereCurve?: number;
}

export function createErkanProjectionMaterial(
  map: THREE.Texture,
  u: ErkanProjectionUniforms
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      uVigTint: { value: u.vignetteTint.clone() },
      uVigStr: { value: u.vignetteStrength },
      uUvRotation: { value: u.uvRotation },
      uMirrorX: { value: u.mirrorX ? 1.0 : 0.0 },
      uOpacity: { value: 1.0 },
      uColorMix: { value: u.colorMix ?? 0.3 },
      uTexScale: { value: u.texScale ?? 1.0 },
      uSphereCurve: { value: u.sphereCurve ?? 0.07 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    toneMapped: false,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}
