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
  float v = 0.0;
  float a = 0.5;
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

  // Elliptical distance from center (oval mask)
  vec2 q = (vUv - 0.5) * 2.0;
  float ellipse = length(q);

  // Noisy edge: fbm displaces the oval boundary
  vec2 noiseCoord = vUv * 6.0 + vec2(uTime * 0.08, uTime * 0.05);
  float edgeNoise = fbm2(noiseCoord) * 0.35;

  // Inner clear zone → fibrous dissolve → fully transparent
  float innerEdge = 0.6;
  float outerEdge = 1.05 + edgeNoise;
  float ovalMask = 1.0 - smoothstep(innerEdge, outerEdge, ellipse);

  // Extra fibers at the boundary
  float fiberZone = smoothstep(innerEdge - 0.1, innerEdge + 0.15, ellipse) *
                    (1.0 - smoothstep(outerEdge - 0.1, outerEdge + 0.05, ellipse));
  float fibers = fbm2(vUv * 18.0 + vec2(uTime * 0.12, -uTime * 0.08));
  ovalMask += fiberZone * fibers * 0.25;
  ovalMask = clamp(ovalMask, 0.0, 1.0);

  // Sample texture
  vec4 t = texture2D(map, clamp(st, 0.001, 0.999));
  vec3 rgb = t.rgb;

  // Color tint toward memory color
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  vec3 tinted = mix(rgb, uVigTint * (0.5 + lum * 0.9), uColorMix);

  // Vignette glow at edges (colored)
  float vigDist = smoothstep(0.35, 1.1, ellipse) * uVigStr;
  vec3 glowCol = uVigTint * (0.35 + 0.5 * lum);
  vec3 final = mix(tinted, glowCol, vigDist);

  // Edge glow bloom
  float bloom = smoothstep(innerEdge - 0.05, innerEdge + 0.2, ellipse) *
                (1.0 - smoothstep(outerEdge - 0.15, outerEdge + 0.1, ellipse));
  final += uVigTint * bloom * 0.2;

  gl_FragColor = vec4(final, ovalMask * uOpacity);
}
`;

export interface ErkanProjectionUniforms {
  vignetteTint: THREE.Color;
  vignetteStrength: number;
  uvRotation: number;
  mirrorX: boolean;
  colorMix?: number;
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
