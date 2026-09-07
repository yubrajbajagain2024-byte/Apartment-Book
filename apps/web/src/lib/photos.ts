"use client";

import { uploadImage, type Client, type PhotoMeta, type UploadKind } from "@apartment-book/shared";

/** Longest edge of the blur placeholder, in pixels. Tiny on purpose (about 1 KB). */
const BLUR_EDGE = 24;

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    // Honour EXIF orientation so portrait phone photos are not sideways.
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

/**
 * Read a photo's dimensions and build a tiny blurred preview in the browser.
 * The original file is never modified; this only produces metadata.
 * Returns nulls when the browser cannot decode the file (for example HEIC outside Safari).
 */
export async function readImageMeta(file: File): Promise<Pick<PhotoMeta, "width" | "height" | "blur">> {
  try {
    const source = await decode(file);
    const width = "naturalWidth" in source ? source.naturalWidth : source.width;
    const height = "naturalHeight" in source ? source.naturalHeight : source.height;
    if (!width || !height) return { width: null, height: null, blur: null };
    const scale = BLUR_EDGE / Math.max(width, height);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { width, height, blur: null };
    ctx.drawImage(source, 0, 0, w, h);
    if ("close" in source) source.close();
    return { width, height, blur: canvas.toDataURL("image/jpeg", 0.5) };
  } catch {
    return { width: null, height: null, blur: null };
  }
}

/** Upload the untouched original and return it with its metadata. */
export async function uploadPhoto(
  supabase: Client,
  input: { kind: UploadKind; userId: string; file: File },
): Promise<PhotoMeta> {
  const [url, meta] = await Promise.all([
    uploadImage(supabase, { kind: input.kind, userId: input.userId, file: input.file, fileName: input.file.name }),
    readImageMeta(input.file),
  ]);
  return { url, ...meta };
}

/** Short human size, e.g. "3.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
