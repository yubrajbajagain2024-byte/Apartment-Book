"use client";

import { BUZZ_IMAGE_MAX_DIMENSION, BUZZ_IMAGE_QUALITY, uploadImage, type Client, type PhotoMeta } from "@apartment-book/shared";

/** Longest edge of the blur placeholder, in pixels. */
const BLUR_EDGE = 24;

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    // Apply the EXIF rotation to the pixels, because the EXIF block itself is thrown away below.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("decode failed"));
      };
      img.src = url;
    });
  }
}

function draw(source: ImageBitmap | HTMLImageElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  // JPEG has no transparency: put see-through PNGs on white instead of black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

export type CleanBuzzPhoto = { blob: Blob; width: number; height: number; blur: string | null };

/**
 * Buzz is anonymous, and a camera file can say where and with which phone it
 * was taken. This redraws the photo on a canvas and exports a brand-new JPEG,
 * so nothing from the original file (EXIF, GPS, device, file name) survives.
 * Throws when the browser cannot open the photo: the original is never used as a fallback.
 */
export async function cleanBuzzPhoto(file: File): Promise<CleanBuzzPhoto> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decode(file);
  } catch {
    throw new Error("This photo could not be opened here. Try a JPG or PNG.");
  }
  try {
    const srcW = "naturalWidth" in source ? source.naturalWidth : source.width;
    const srcH = "naturalHeight" in source ? source.naturalHeight : source.height;
    if (!srcW || !srcH) throw new Error("This photo could not be opened here. Try a JPG or PNG.");
    const scale = Math.min(1, BUZZ_IMAGE_MAX_DIMENSION / Math.max(srcW, srcH));
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    const canvas = draw(source, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", BUZZ_IMAGE_QUALITY));
    if (!blob) throw new Error("This photo could not be prepared. Try another one.");

    let blur: string | null = null;
    try {
      const tiny = BLUR_EDGE / Math.max(width, height);
      blur = draw(source, Math.max(1, Math.round(width * tiny)), Math.max(1, Math.round(height * tiny))).toDataURL("image/jpeg", 0.5);
    } catch {
      blur = null;
    }
    return { blob, width, height, blur };
  } finally {
    if ("close" in source) source.close();
  }
}

/** Clean the photo, then upload ONLY the cleaned copy to buzz/anon/ (no user id in the address). */
export async function uploadBuzzPhoto(supabase: Client, file: File): Promise<PhotoMeta> {
  const clean = await cleanBuzzPhoto(file);
  // `userId` is ignored for kind "buzz"; the placeholder keeps real ids out of this code path.
  const url = await uploadImage(supabase, { kind: "buzz", userId: "anon", file: clean.blob, contentType: "image/jpeg" });
  return { url, width: clean.width, height: clean.height, blur: clean.blur };
}
