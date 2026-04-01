/**
 * Shared preview texture cache.
 *
 * Как в Telegram-чате: `object-fit: contain` в квадрате (поля), без центр-кропа.
 * EXIF через `createImageBitmap(..., { imageOrientation: 'from-image' })`.
 *
 * Usage:
 *   - Call `preloadAllPreviews(urls)` early (App bootstrap) to start fetching.
 *   - In components call `getPreviewTexture(url)` which returns the cached
 *     promise — resolves once the texture is ready.
 */
import * as THREE from "three";

const cache = new Map<string, Promise<THREE.Texture | null>>();

/** Сторона квадратной текстуры превью (даунскейл с больших фото). */
const PREVIEW_CANVAS_MAX = 640;

function drawContainOnSquare(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  side: number,
  fillStyle: string
): void {
  const w0 = bitmap.width;
  const h0 = bitmap.height;
  const scale = Math.min(side / w0, side / h0);
  const dw = Math.max(1, Math.round(w0 * scale));
  const dh = Math.max(1, Math.round(h0 * scale));
  const ox = (side - dw) / 2;
  const oy = (side - dh) / 2;
  ctx.fillStyle = fillStyle;
  ctx.fillRect(0, 0, side, side);
  ctx.drawImage(bitmap, 0, 0, w0, h0, ox, oy, dw, dh);
}

async function imageToOrientedBitmap(img: HTMLImageElement): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(img, { imageOrientation: "from-image" });
  } catch {
    return createImageBitmap(img);
  }
}

function loadViaCanvas(url: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      void (async () => {
        let bitmap: ImageBitmap | null = null;
        try {
          bitmap = await imageToOrientedBitmap(img);
        } catch {
          resolve(null);
          return;
        }
        const w = bitmap.width;
        const h = bitmap.height;
        if (!w || !h) {
          bitmap.close();
          resolve(null);
          return;
        }
        const side = PREVIEW_CANVAS_MAX;
        const canvas = document.createElement("canvas");
        canvas.width = side;
        canvas.height = side;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          bitmap.close();
          resolve(null);
          return;
        }
        drawContainOnSquare(ctx, bitmap, side, "#0a0810");
        bitmap.close();
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
      })();
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
