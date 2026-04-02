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
  for (int i = 0; i < 4; i++) {
    v += a * noise2(p);
    p *= 2.2;
    a *= 0.45;
  }
  return v;
}

void main() {
  vec2 st = vUv;
  if (uMirrorX > 0.5) st.x = 1.0 - st.x;

  // Always sample texture with clamping — mild barrel = photo on large sphere
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

  // Elliptical distance from center (full screen UV space)
  vec2 q = (vUv - 0.5) * 2.0;
  float ellipse = length(q);

  // Memory radial distance (in memory-space units: 1.0 = memory edge)
  float memR = ellipse / uTexScale;

  // Smooth oval mask — pure ellipse, no rectangular edges ever
  float memMask = 1.0 - smoothstep(0.65, 1.05, memR);

  float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
  vec3 tinted = mix(texel.rgb, uVigTint * (0.5 + lum * 0.9), uColorMix);

  // Vignette — lift toward warm highlight, more cinematic (less swamp)
  vec3 vigBase = mix(uVigTint, vec3(1.0, 0.97, 0.94), 0.14);
  float vigNoise = fbm2(vUv * 4.0 + vec2(uTime * 0.05, uTime * 0.03));
  vec3 vigCol = vigBase * (0.14 + 0.2 * vigNoise);

  // Blend: inside oval = tinted memory, outside = vignette color
  vec3 rgb = mix(vigCol, tinted, memMask);

  // Subtle bloom ring at memory boundary
  float bloomR = smoothstep(0.5, 0.8, memR) * (1.0 - smoothstep(0.8, 1.5, memR));
  rgb += uVigTint * bloomR * uVigStr * 0.2;

  // Outer dissolution — tighter, less noisy
  float outerNoise = fbm2(vUv * 6.0 + vec2(uTime * 0.08, uTime * 0.05));
  float outerEdge = 0.72 + outerNoise * 0.14;
  float outerMask = 1.0 - smoothstep(outerEdge - 0.18, outerEdge + 0.06, ellipse);

  // Subtle fibers at outer boundary
  float fiberZone = smoothstep(0.45, 0.65, ellipse) *
                    (1.0 - smoothstep(outerEdge - 0.05, outerEdge + 0.1, ellipse));
  float fibers = fbm2(vUv * 18.0 + vec2(uTime * 0.1, -uTime * 0.07));
  outerMask += fiberZone * fibers * 0.1;
  outerMask = clamp(outerMask, 0.0, 1.0);

  // Subtle warm inner glow
  float innerGlow = 1.0 - smoothstep(0.0, uTexScale * 0.5, ellipse);
  rgb += uVigTint * innerGlow * 0.04;

  // Film grain for cinematic feel
  float grain = (hash2(vUv * 800.0 + vec2(uTime * 73.1, uTime * 91.7)) - 0.5) * 0.025;
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
