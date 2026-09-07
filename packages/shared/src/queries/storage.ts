import { MAX_IMAGE_SIZE_BYTES, STORAGE_BUCKET } from "../constants";
import type { Client } from "../types/models";

export type UploadKind = "apartments" | "items" | "roommates" | "avatars" | "messages";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function extensionFor(type: string, fallbackName?: string): string {
  switch (type) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default: {
      const fromName = fallbackName?.split(".").pop()?.toLowerCase();
      return fromName && fromName.length <= 5 ? fromName : "bin";
    }
  }
}

function randomId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type UploadSource = Blob | ArrayBuffer | Uint8Array;

/**
 * Upload an image to the public `uploads` bucket at `{kind}/{userId}/{random}.{ext}`
 * and return its public URL.
 *
 * Web: pass the `File` from an `<input type="file">`.
 * React Native (Expo): read the picked image as an ArrayBuffer, e.g.
 *   const data = await fetch(asset.uri).then((r) => r.arrayBuffer());
 *   uploadImage(supabase, { kind, userId, file: data, contentType: asset.mimeType ?? "image/jpeg" });
 */
export async function uploadImage(
  supabase: Client,
  input: { kind: UploadKind; userId: string; file: UploadSource; fileName?: string; contentType?: string },
): Promise<string> {
  const isBlob = typeof Blob !== "undefined" && input.file instanceof Blob;
  const contentType = input.contentType || (isBlob ? (input.file as Blob).type : "") || "application/octet-stream";
  const size = isBlob ? (input.file as Blob).size : (input.file as ArrayBuffer | Uint8Array).byteLength;
  if (!ALLOWED_TYPES.has(contentType)) {
    throw new Error("Only JPG, PNG, WEBP or GIF images are allowed");
  }
  if (size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("Images must be smaller than 5 MB");
  }
  const path = `${input.kind}/${input.userId}/${Date.now()}-${randomId()}.${extensionFor(contentType, input.fileName)}`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, input.file, { contentType, cacheControl: "31536000", upsert: false });
  if (error) throw error;
  return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Remove a previously uploaded image by its public URL (only works for your own files). */
export async function deleteImageByUrl(supabase: Client, publicUrl: string): Promise<void> {
  const marker = `/object/public/${STORAGE_BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return;
  const path = decodeURIComponent(publicUrl.slice(index + marker.length));
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([path]);
  if (error) throw error;
}
