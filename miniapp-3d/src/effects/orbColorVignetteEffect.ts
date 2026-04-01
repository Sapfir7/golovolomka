import { Effect, BlendFunction } from "postprocessing";
import * as THREE from "three";

const fragmentShader = `
uniform vec3 uTint;
uniform float uRadius;
uniform float uSoftness;
uniform float uStrength;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 p = (uv - 0.5) * 2.0;
  float r = length(p);
  float edge = smoothstep(uRadius, uRadius + uSoftness, r) * uStrength;
  float lum = dot(inputColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 edgeRgb = mix(uTint * 0.22, uTint * (0.42 + 0.35 * lum), 0.65);
  vec3 rgb = mix(inputColor.rgb, edgeRgb, edge);
  outputColor = vec4(rgb, inputColor.a);
}
`;

export interface OrbColorVignetteOptions {
  blendFunction?: BlendFunction;
  /** CSS hex, e.g. #9d62c4 */
  tint?: string | THREE.Color;
  uRadius?: number;
  uSoftness?: number;
  uStrength?: number;
}

export class OrbColorVignetteEffect extends Effect {
  constructor({
    blendFunction = BlendFunction.NORMAL,
    tint = "#2a1838",
    uRadius = 0.62,
    uSoftness = 0.55,
    uStrength = 0.74,
  }: OrbColorVignetteOptions = {}) {
    const c = tint instanceof THREE.Color ? tint : new THREE.Color(tint);
    const uniforms = new Map<string, THREE.Uniform<THREE.Color | number>>([
      ["uTint", new THREE.Uniform<THREE.Color>(c)],
      ["uRadius", new THREE.Uniform<number>(uRadius)],
      ["uSoftness", new THREE.Uniform<number>(uSoftness)],
      ["uStrength", new THREE.Uniform<number>(uStrength)],
    ]);
    super("OrbColorVignetteEffect", fragmentShader, {
      blendFunction,
      uniforms: uniforms as Map<string, THREE.Uniform<THREE.Color>>,
    });
  }
}
