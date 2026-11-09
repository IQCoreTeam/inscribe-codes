// Image helpers shared by the studio producers and the deploy engine: decode a
// File to pixels, composite layers, and the single squoosh compression step
// (@jsquash resize + webp, the same wasm squoosh.app runs) that keeps every
// buyer's inscription small.
import resize from "@jsquash/resize";
import { encode as encodeWebp } from "@jsquash/webp";

// Deploys composite and compress at this edge; previews can be smaller.
export const COMPOSITE_EDGE = 512;

export async function compressImage(imageData, { maxEdge = 512, quality = 80 } = {}) {
  let img = imageData;
  const longest = Math.max(img.width, img.height);
  if (longest > maxEdge) {
    const scale = maxEdge / longest;
    img = await resize(img, { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  }
  const buf = await encodeWebp(img, { quality });
  return { bytes: new Uint8Array(buf), mime: "image/webp" };
}

export const fileToBitmap = (file) => createImageBitmap(file);

export function bitmapToImageData(bitmap, edge = COMPOSITE_EDGE) {
  const cv = document.createElement("canvas");
  cv.width = edge; cv.height = edge;
  const ctx = cv.getContext("2d");
  const scale = Math.min(edge / bitmap.width, edge / bitmap.height);
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  ctx.drawImage(bitmap, Math.floor((edge - w) / 2), Math.floor((edge - h) / 2), w, h);
  return ctx.getImageData(0, 0, edge, edge);
}

// Stack one picked trait bitmap per layer, bottom first.
export function compositeLayers(layers, picks, edge = COMPOSITE_EDGE) {
  const cv = document.createElement("canvas");
  cv.width = edge; cv.height = edge;
  const ctx = cv.getContext("2d");
  layers.forEach((layer, i) => {
    const trait = layer.traits[picks[i]];
    if (trait) ctx.drawImage(trait.bitmap, 0, 0, edge, edge);
  });
  return cv;
}
export const compositeImageData = (layers, picks, edge = COMPOSITE_EDGE) =>
  compositeLayers(layers, picks, edge).getContext("2d").getImageData(0, 0, edge, edge);
export const compositeDataUrl = (layers, picks, edge) => compositeLayers(layers, picks, edge).toDataURL("image/png");
