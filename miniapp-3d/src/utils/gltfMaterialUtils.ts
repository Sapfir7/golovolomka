import * as THREE from "three";

/** Non–color data: must not use sRGB or normals look flat / roughness washes out. */
function fixDataTexture(tex: THREE.Texture): void {
  if (tex.colorSpace !== THREE.NoColorSpace) {
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
  }
}

function fixStandardPhysicalMaps(
  mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
): void {
  if (mat.normalMap) fixDataTexture(mat.normalMap);
  if (mat.roughnessMap) fixDataTexture(mat.roughnessMap);
  if (mat.metalnessMap) fixDataTexture(mat.metalnessMap);
  if (mat.aoMap) fixDataTexture(mat.aoMap);
  if (mat.bumpMap) fixDataTexture(mat.bumpMap);
  if (mat.alphaMap) fixDataTexture(mat.alphaMap);
  if (mat.displacementMap) fixDataTexture(mat.displacementMap);
  if (mat.lightMap) fixDataTexture(mat.lightMap);
  if (mat instanceof THREE.MeshPhysicalMaterial) {
    if (mat.clearcoatNormalMap) fixDataTexture(mat.clearcoatNormalMap);
    if (mat.clearcoatMap) fixDataTexture(mat.clearcoatMap);
    if (mat.sheenRoughnessMap) fixDataTexture(mat.sheenRoughnessMap);
    if (mat.specularIntensityMap) fixDataTexture(mat.specularIntensityMap);
    if (mat.transmissionMap) fixDataTexture(mat.transmissionMap);
    if (mat.thicknessMap) fixDataTexture(mat.thicknessMap);
    if (mat.iridescenceMap) fixDataTexture(mat.iridescenceMap);
    if (mat.iridescenceThicknessMap) fixDataTexture(mat.iridescenceThicknessMap);
    if (mat.anisotropyMap) fixDataTexture(mat.anisotropyMap);
  }
}

/**
 * Blender/glTF sometimes marks normal & roughness as sRGB; fix and ensure tangents for normal maps.
 */
export function configureGlbPbrMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
    for (const mat of mats) {
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
        fixStandardPhysicalMaps(mat);
      }
    }

    const hasNormal = mats.some(
      (m) =>
        (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial) &&
        m.normalMap != null,
    );
    const g = mesh.geometry;
    if (!hasNormal || g.getAttribute("tangent")) return;
    if (!g.index || !g.getAttribute("uv") || !g.getAttribute("normal")) return;
    try {
      g.computeTangents();
    } catch {
      /* non-indexed or bad UVs */
    }
  });
}

function bumpRoughness(
  mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
): void {
  const hasRoughMap = mat.roughnessMap != null;
  if (mat instanceof THREE.MeshPhysicalMaterial) {
    const add = hasRoughMap ? 0.05 : 0.26;
    mat.roughness = Math.min(mat.roughness + add, 1.0);
    mat.metalness = Math.min(mat.metalness, 0.1);
    mat.envMapIntensity = Math.min(mat.envMapIntensity * 0.82, 0.42);
    if (mat.clearcoat > 0) mat.clearcoatRoughness = Math.min(mat.clearcoatRoughness + 0.25, 1);
    return;
  }
  const add = hasRoughMap ? 0.06 : 0.22;
  mat.roughness = Math.min(mat.roughness + add, 1.0);
  mat.metalness = Math.min(mat.metalness, 0.12);
  mat.envMapIntensity = Math.min(mat.envMapIntensity * 0.85, 0.45);
}

/** Softer global look without killing authored roughness maps (e.g. wood). */
export function softenGlbMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[];
    for (const mat of mats) {
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
        bumpRoughness(mat);
      }
    }
  });
}
