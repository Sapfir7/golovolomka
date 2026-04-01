import * as THREE from "three";

const vertexShader = `
varying vec2 vUv;
uniform float uUvRotation;

void main() {
  vec2 uv = uv;
  if (abs(uUvRotation) > 0.0001) {
    vec2 c = uv - 0.5;
    float cs = cos(uUvRotation);
    float sn = sin(uUvRotation);
    uv = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
  }
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
precision highp float;
uniform sampler2D map;
uniform float uShaderContain;
uniform float uTexAspect;
uniform float uPlaneAspect;
uniform vec3 uBg;
uniform vec3 uVigTint;
uniform float uVigStr;
varying vec2 vUv;

vec2 planeToTex(vec2 uv, float R, float A) {
  vec2 st;
  if (R >= A) {
    st.x = (uv.x - 0.5) * (R / A) + 0.5;
    st.y = uv.y;
  } else {
    st.x = uv.x;
    st.y = (uv.y - 0.5) * (A / R) + 0.5;
  }
  return st;
}

void main() {
  vec2 st = uShaderContain > 0.5
    ? planeToTex(vUv, uTexAspect, uPlaneAspect)
    : vUv;
  bool outside = uShaderContain > 0.5 && (st.x < 0.0 || st.x > 1.0 || st.y < 0.0 || st.y > 1.0);
  vec4 t = texture2D(map, clamp(st, 0.001, 0.999));
  vec3 rgb = outside ? uBg : t.rgb;

  vec2 q = (vUv - 0.5) * 2.0;
  float vr = length(q);
  float vig = smoothstep(0.38, 1.18, vr) * uVigStr;
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  vec3 edgeCol = mix(uVigTint * 0.2, uVigTint * (0.35 + 0.4 * lum), 0.72);
  rgb = mix(rgb, edgeCol, vig);

  gl_FragColor = vec4(rgb, 0.996);
}
`;

export interface ErkanProjectionUniforms {
  shaderContain: number;
  texAspect: number;
  planeAspect: number;
  bg: THREE.Color;
  vignetteTint: THREE.Color;
  vignetteStrength: number;
  uvRotation: number;
}

export function createErkanProjectionMaterial(
  map: THREE.Texture,
  u: ErkanProjectionUniforms
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      uShaderContain: { value: u.shaderContain },
      uTexAspect: { value: u.texAspect },
      uPlaneAspect: { value: u.planeAspect },
      uBg: { value: u.bg.clone() },
      uVigTint: { value: u.vignetteTint.clone() },
      uVigStr: { value: u.vignetteStrength },
      uUvRotation: { value: u.uvRotation },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    toneMapped: false,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

export function updateErkanVignetteUniforms(
  mat: THREE.ShaderMaterial,
  vignetteTint: THREE.Color,
  strength = 0.72
): void {
  const u = mat.uniforms;
  if (u.uVigTint) u.uVigTint.value.copy(vignetteTint);
  if (u.uVigStr) u.uVigStr.value = strength;
}

export function updateErkanVideoAspect(mat: THREE.ShaderMaterial, texW: number, texH: number): void {
  const ta = texW / Math.max(1, texH);
  if (mat.uniforms.uTexAspect) mat.uniforms.uTexAspect.value = ta;
}
