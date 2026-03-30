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
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
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
