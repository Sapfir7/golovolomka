import * as THREE from "three";

const vert = `
varying float vAxial;
varying float vRadial;
uniform float uHalfHeight;
uniform float uBottomRadius;

void main() {
  vec3 p = position;
  float h = uHalfHeight * 2.0;
  vAxial = (p.y + uHalfHeight) / h;
  float maxR = uBottomRadius * (uHalfHeight - p.y) / h;
  vRadial = length(p.xz) / max(maxR, 0.0001);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const frag = `
precision highp float;
varying float vAxial;
varying float vRadial;
uniform vec3 uColor;
uniform float uStrength;

void main() {
  float tip = smoothstep(0.0, 0.18, vAxial);
  float body = pow(1.0 - vAxial, 0.5);
  float edge = 1.0 - smoothstep(0.55, 1.05, vRadial);
  float a = tip * body * edge * uStrength;
  gl_FragColor = vec4(uColor, a);
}
`;

export function createSpotBeamMaterial(opts: {
  color?: THREE.ColorRepresentation;
  strength?: number;
  coneHeight: number;
  bottomRadius: number;
}): THREE.ShaderMaterial {
  const halfH = opts.coneHeight * 0.5;
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(opts.color ?? "#fff8e8") },
      uStrength: { value: opts.strength ?? 0.22 },
      uHalfHeight: { value: halfH },
      uBottomRadius: { value: opts.bottomRadius },
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
