import * as THREE from "three";

const vertexShader = `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
precision highp float;
uniform sampler2D map;
uniform vec3 cameraPosition;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float facing = max(0.0, dot(normalize(vWorldNormal), viewDir));
  float cap = smoothstep(0.06, 0.36, facing);
  vec4 c = texture2D(map, vUv);
  gl_FragColor = vec4(c.rgb, c.a * cap * uOpacity);
}
`;

export function createOrbPreviewMaterial(map: THREE.Texture, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      cameraPosition: { value: new THREE.Vector3() },
      uOpacity: { value: opacity },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    toneMapped: false,
    depthWrite: false,
  });
}
