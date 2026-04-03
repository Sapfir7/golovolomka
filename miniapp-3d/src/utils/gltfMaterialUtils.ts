import * as THREE from "three";

/** Усиление карты нормалей относительно значения из glTF (слишком высокое усиливает швы по тангентам). */
export const GLB_NORMAL_SCALE_MUL = 1.25;

/**
 * Квант позиции для поиска дубликатов вершин на UV-швах (чуть крупнее — ловим float-дрейф экспорта).
 */
const NORMAL_WELD_EPS = 1e-4;

/** Если все нормали в «кучке» почти сонаправлены — усредняем (гладкий шов). Иначе кромка — не трогаем. */
const WELD_MIN_NORMAL_ALIGN = 0.72;

const _nAcc = new THREE.Vector3();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();

/**
 * Сглаживает линии на UV-швах: вершины в одной точке пространства получают одну нормаль,
 * но только если они уже почти параллельны (не съедаем острые углы шкафа).
 */
function weldSimilarNormalsAtCoincidentPositions(geometry: THREE.BufferGeometry): void {
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const norm = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
  if (!pos || !norm || pos.count !== norm.count) return;

  const q = 1 / NORMAL_WELD_EPS;
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(i);
  }

  for (const indices of buckets.values()) {
    if (indices.length < 2) continue;
    let minPairDot = 1;
    for (let a = 0; a < indices.length; a++) {
      _va.set(norm.getX(indices[a]), norm.getY(indices[a]), norm.getZ(indices[a]));
      for (let b = a + 1; b < indices.length; b++) {
        _vb.set(norm.getX(indices[b]), norm.getY(indices[b]), norm.getZ(indices[b]));
        minPairDot = Math.min(minPairDot, _va.dot(_vb));
      }
    }
    if (minPairDot < WELD_MIN_NORMAL_ALIGN) continue;

    _nAcc.set(0, 0, 0);
    for (const vi of indices) {
      _nAcc.x += norm.getX(vi);
      _nAcc.y += norm.getY(vi);
      _nAcc.z += norm.getZ(vi);
    }
    if (_nAcc.lengthSq() < 1e-22) continue;
    _nAcc.normalize();
    for (const vi of indices) norm.setXYZ(vi, _nAcc.x, _nAcc.y, _nAcc.z);
  }
  norm.needsUpdate = true;
}

/** Non–color data: must not use sRGB or normals look flat / roughness washes out. */
function underNamedAncestor(o: THREE.Object3D, name: string): boolean {
  let p: THREE.Object3D | null = o.parent;
  while (p) {
    if (p.name === name) return true;
    p = p.parent;
  }
  return false;
}

/**
 * Сглаженные вершинные нормали (аналог Shade Smooth) на всей модели, кроме конуса луча —
 * у него своя геометрия под шейдер.
 * После пересчёта нормалей старые тангенты сбрасываются, если есть normalMap (их заново считает configureGlbPbrMaterials).
 */
export function smoothGlbVertexNormals(root: THREE.Object3D): void {
  const skipSelf = new Set([
    "trajectory_00", "trajectory_01", "trajectory_02", "trajectory_03", "trajectory_04",
    "Conus_light",
  ]);
  root.traverse((o) => {
    if (skipSelf.has(o.name) || underNamedAncestor(o, "Conus_light")) return;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const g = mesh.geometry;
    if (!g.getAttribute("position")) return;
    g.computeVertexNormals();
    weldSimilarNormalsAtCoincidentPositions(g);

    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
    const needsNewTangents = mats.some(
      (m) =>
        (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial) &&
        m.normalMap != null,
    );
    if (needsNewTangents && g.getAttribute("tangent")) g.deleteAttribute("tangent");
  });
}

/** Усилить normal map (и clearcoat normal) в `factor` раз. */
export function applyGlbNormalScale(root: THREE.Object3D, factor: number): void {
  if (factor === 1) return;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
    for (const mat of mats) {
      if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
      if (mat.normalMap) mat.normalScale.multiplyScalar(factor);
      if (mat instanceof THREE.MeshPhysicalMaterial && mat.clearcoatNormalMap) {
        mat.clearcoatNormalScale.multiplyScalar(factor);
      }
      mat.needsUpdate = true;
    }
  });
}

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

/**
 * Reduces streaky / stepped look on oblique surfaces (wood on curved cabinet):
 * max anisotropic filtering + mipmapped minification where the GPU allows it.
 * Does not fix faceted mesh or bad UVs — those need Blender.
 */
export function enhanceGltfTextureSampling(
  root: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
): void {
  const maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const seen = new Set<THREE.Texture>();

  const polish2D = (tex: THREE.Texture | null | undefined): void => {
    if (!tex?.isTexture || seen.has(tex)) return;
    if ((tex as THREE.CubeTexture).isCubeTexture) return;
    seen.add(tex);
    tex.anisotropy = maxAniso;
    const img = tex.image as { width?: number; height?: number } | undefined;
    const w = img && typeof img.width === "number" ? img.width : 0;
    const h = img && typeof img.height === "number" ? img.height : 0;
    if (w > 0 && h > 0) {
      if (THREE.MathUtils.isPowerOfTwo(w) && THREE.MathUtils.isPowerOfTwo(h)) {
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
      } else {
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
      }
      tex.magFilter = THREE.LinearFilter;
    }
    tex.needsUpdate = true;
  };

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
    for (const mat of mats) {
      if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
      mat.flatShading = false;
      polish2D(mat.map);
      polish2D(mat.lightMap);
      polish2D(mat.aoMap);
      polish2D(mat.emissiveMap);
      polish2D(mat.bumpMap);
      polish2D(mat.normalMap);
      polish2D(mat.displacementMap);
      polish2D(mat.roughnessMap);
      polish2D(mat.metalnessMap);
      if (mat instanceof THREE.MeshPhysicalMaterial) {
        polish2D(mat.clearcoatMap);
        polish2D(mat.clearcoatNormalMap);
        polish2D(mat.sheenColorMap);
        polish2D(mat.sheenRoughnessMap);
        polish2D(mat.specularIntensityMap);
        polish2D(mat.specularColorMap);
        polish2D(mat.transmissionMap);
        polish2D(mat.thicknessMap);
        polish2D(mat.iridescenceMap);
        polish2D(mat.iridescenceThicknessMap);
        polish2D(mat.anisotropyMap);
      }
      mat.needsUpdate = true;
    }
  });
}
