/** Рисует bitmap в прямоугольник cw×ch с object-fit: contain (поля fillStyle). */
export function drawBitmapContain(
  ctx: CanvasRenderingContext2D,
  bitmap: CanvasImageSource,
  srcW: number,
  srcH: number,
  cw: number,
  ch: number,
  fillStyle: string
): void {
  const scale = Math.min(cw / srcW, ch / srcH);
  const dw = Math.max(1, Math.round(srcW * scale));
  const dh = Math.max(1, Math.round(srcH * scale));
  const ox = (cw - dw) / 2;
  const oy = (ch - dh) / 2;
  ctx.fillStyle = fillStyle;
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(bitmap, 0, 0, srcW, srcH, ox, oy, dw, dh);
}

/** Сторона canvas под соотношение сторон плоскости (ширина/высота), max по длинной стороне. */
export function canvasSizeForPlaneAspect(planeAspect: number, maxDim = 1024): [number, number] {
  const ar = Math.max(1e-6, planeAspect);
  if (ar >= 1) {
    const w = maxDim;
    const h = Math.max(2, Math.round(maxDim / ar));
    return [w, h];
  }
  const h = maxDim;
  const w = Math.max(2, Math.round(maxDim * ar));
  return [w, h];
}
