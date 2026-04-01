/**
 * Shared preview texture cache.
 *
 * Loads images through an HTML canvas to guarantee EXIF orientation is applied
 * (Three.js TextureLoader can skip EXIF in some browser/GPU combos).
 *
 * Usage:
 *   - Call `preloadAllPreviews(urls)` early (App bootstrap) to start fetching.
 *   - In components call `getPreviewTexture(url)` which returns the cached
 *     promise — resolves once the texture is ready.
 */
import * as THREE from "three";

const cache = new Map<string, Promise<THREE.Texture | null>>();

function loadViaCanvas(url: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) {
        resolve(null);
        return;
      }
      const side = Math.min(w, h);
      const sx = (w - side) / 2;
      const sy = (h - side) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, sx, sy, side, side, 0, 0, side, side);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      /** WebGL UV на сфере: иначе превью часто вверх ногами при flipY по умолчанию. */
      texture.flipY = false;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      resolve(texture);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function getPreviewTexture(url: string): Promise<THREE.Texture | null> {
  const existing = cache.get(url);
  if (existing) return existing;
  const promise = loadViaCanvas(url);
  cache.set(url, promise);
  return promise;
}

export function preloadAllPreviews(urls: (string | null | undefined)[]): void {
  for (const url of urls) {
    if (url) getPreviewTexture(url);
  }
}

/**
 * Ждёт загрузки превью (или таймаут), плюс короткая пауза — чтобы шары не мигали пустыми.
 */
export async function awaitPreviewLoads(
  urls: (string | null | undefined)[],
  opts?: { timeoutMs?: number; minWaitMs?: number }
): Promise<void> {
  const list = [...new Set(urls.filter(Boolean) as string[])];
  if (list.length === 0) return;
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const minWaitMs = opts?.minWaitMs ?? 400;
  const t0 = Date.now();
  const loads = list.map((u) => getPreviewTexture(u));
  await Promise.race([Promise.all(loads), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
  const pad = minWaitMs - (Date.now() - t0);
  if (pad > 0) await new Promise((r) => setTimeout(r, pad));
}
