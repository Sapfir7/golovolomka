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
uniform float uTime;
uniform float uTexScale;
uniform float uSphereCurve;
varying vec2 vUv;

float hash2(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract(p.x * p.y);
}

// Quintic interpolation — no grid squares like linear floor cells
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(hash2(i), hash2(i + vec2(1,0)), u.x),
    mix(hash2(i + vec2(0,1)), hash2(i + vec2(1,1)), u.x),
    u.y);
}

float fbm2(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 mrot = mat2(0.86, -0.51, 0.51, 0.86);
  for (int i = 0; i < 4; i++) {
    v += a * noise2(p);
    p = mrot * (p * 2.05 + vec2(17.3, 23.7));
    a *= 0.44;
  }
  return v;
}

// Smoky haze: blur FBM in frequency space by averaging offsets
float fbmSoft(vec2 p) {
  float a = fbm2(p);
  float b = fbm2(p + vec2(23.1, 8.4));
  float c = fbm2(p * 0.94 - vec2(11.2, 19.6));
  return (a * 0.5 + b * 0.28 + c * 0.22);
}

void main() {
  vec2 st = vUv;
  if (uMirrorX > 0.5) st.x = 1.0 - st.x;

  vec2 texUv = clamp((st - 0.5) / uTexScale + 0.5, 0.0, 1.0);
  vec2 dS = texUv - 0.5;
  float sr2 = dot(dS, dS);
  texUv = clamp(0.5 + dS * (1.0 + uSphereCurve * sr2), 0.0, 1.0);
  vec4 texel = texture2D(map, texUv);
  vec4 t1 = texture2D(map, clamp(texUv + vec2(0.0012, 0.0), 0.0, 1.0));
  vec4 t2 = texture2D(map, clamp(texUv - vec2(0.0012, 0.0), 0.0, 1.0));
  vec4 t3 = texture2D(map, clamp(texUv + vec2(0.0, 0.0012), 0.0, 1.0));
  vec4 t4 = texture2D(map, clamp(texUv - vec2(0.0, 0.0012), 0.0, 1.0));
  texel = mix(texel, (texel + t1 + t2 + t3 + t4) * 0.2, 0.35);

  vec2 q = (vUv - 0.5) * 2.0;
  float ellipse = length(q);
  float memR = ellipse / uTexScale;

  // Photo: soft ellipse larger / wider than vignette core — corners blend away before outer frame
  float photoMask = 1.0 - smoothstep(0.34, 0.92, memR);
  photoMask = pow(max(photoMask, 0.0), 0.94);

  float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
  vec3 tinted = mix(texel.rgb, uVigTint * (0.5 + lum * 0.9), uColorMix);

  vec3 vigBase = mix(uVigTint, vec3(1.0, 0.97, 0.94), 0.14);
  float vigNoise = fbmSoft(vUv * 2.8 + vec2(uTime * 0.035, uTime * 0.022));
  float vigWisp = fbmSoft(vUv * 5.2 + vec2(-uTime * 0.02, uTime * 0.04));
  float vigBlend = mix(vigNoise, vigWisp, 0.35);
  vec3 vigCol = vigBase * (0.14 + 0.18 * vigBlend);

  vec3 rgb = mix(vigCol, tinted, photoMask);

  float bloomR = smoothstep(0.42, 0.72, memR) * (1.0 - smoothstep(0.72, 1.35, memR));
  rgb += uVigTint * bloomR * uVigStr * 0.2;

  float outerNoise = fbmSoft(vUv * 4.2 + vec2(uTime * 0.05, uTime * 0.035));
  float outerEdge = 0.72 + outerNoise * 0.11;
  float outerMask = 1.0 - smoothstep(outerEdge - 0.2, outerEdge + 0.07, ellipse);

  float fiberZone = smoothstep(0.42, 0.62, ellipse) *
                    (1.0 - smoothstep(outerEdge - 0.06, outerEdge + 0.1, ellipse));
  float fibers = fbmSoft(vUv * 7.5 + vec2(uTime * 0.06, -uTime * 0.05));
  outerMask += fiberZone * fibers * 0.055;
  outerMask = clamp(outerMask, 0.0, 1.0);

  float innerGlow = 1.0 - smoothstep(0.0, uTexScale * 0.5, ellipse);
  rgb += uVigTint * innerGlow * 0.04;

  float grain = (fbmSoft(vUv * 120.0 + vec2(uTime * 2.1, uTime * 2.7)) - 0.5) * 0.018;
  rgb += grain;

  float finalAlpha = outerMask * uOpacity;
  if (finalAlpha < 0.004) discard;
  gl_FragColor = vec4(rgb, finalAlpha);
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
      uTime: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    toneMapped: false,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}
