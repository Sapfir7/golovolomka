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

  // Remap UV so the memory texture sits in the center of the larger screen
  vec2 texUv = (st - 0.5) / uTexScale + 0.5;
  bool inTex = texUv.x > 0.001 && texUv.x < 0.999 &&
               texUv.y > 0.001 && texUv.y < 0.999;
  vec4 texel = inTex ? texture2D(map, texUv) : vec4(0.0);

  // Elliptical distance from center (full screen space)
  vec2 q = (vUv - 0.5) * 2.0;
  float ellipse = length(q);

  // Luminance for tinting
  float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));

  // Tint memory toward vignette color
  vec3 tinted = mix(texel.rgb, uVigTint * (0.5 + lum * 0.9), uColorMix);

  // Memory oval boundary: memory inscribed inside the vignette ellipse
  float memEdge = uTexScale;
  float memFade = smoothstep(memEdge * 0.6, memEdge * 1.1, ellipse);

  // Vignette color with animated noise texture
  float vigNoise = fbm2(vUv * 4.0 + vec2(uTime * 0.05, uTime * 0.03));
  vec3 vigCol = uVigTint * (0.1 + 0.2 * vigNoise);

  // Blend memory content → vignette color
  vec3 rgb = mix(tinted, vigCol, memFade);

  // Glow bloom ring at memory boundary
  float bloom = smoothstep(memEdge * 0.45, memEdge * 0.85, ellipse) *
                (1.0 - smoothstep(memEdge * 0.85, memEdge * 1.5, ellipse));
  rgb += uVigTint * bloom * uVigStr * 0.3;

  // Outer dissolution mask with noisy boundary
  float outerNoise = fbm2(vUv * 6.0 + vec2(uTime * 0.08, uTime * 0.05));
  float outerEdge = 0.85 + outerNoise * 0.22;
  float outerMask = 1.0 - smoothstep(outerEdge - 0.15, outerEdge + 0.08, ellipse);

  // Wispy fibers at the outer boundary
  float fiberZone = smoothstep(0.55, 0.78, ellipse) *
                    (1.0 - smoothstep(outerEdge - 0.05, outerEdge + 0.12, ellipse));
  float fibers = fbm2(vUv * 18.0 + vec2(uTime * 0.1, -uTime * 0.07));
  outerMask += fiberZone * fibers * 0.22;
  outerMask = clamp(outerMask, 0.0, 1.0);

  // Subtle warm inner glow
  float innerGlow = 1.0 - smoothstep(0.0, memEdge * 0.6, ellipse);
  rgb += uVigTint * innerGlow * 0.06;

  gl_FragColor = vec4(rgb, outerMask * uOpacity);
}
`;

export interface ErkanProjectionUniforms {
  vignetteTint: THREE.Color;
  vignetteStrength: number;
  uvRotation: number;
  mirrorX: boolean;
  colorMix?: number;
  texScale?: number;
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
