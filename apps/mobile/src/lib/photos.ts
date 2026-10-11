import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { uploadImage, type PhotoMeta, type UploadKind } from "@apartment-book/shared";
import { supabase } from "./supabase";

export type PickedAsset = ImagePicker.ImagePickerAsset;

/** Pick up to `max` photos at full quality. Returns [] when cancelled. */
export async function pickPhotos(max: number): Promise<PickedAsset[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error("Allow photo access in Settings to add photos.");
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: max > 1, selectionLimit: max, quality: 1, exif: false });
  return result.canceled ? [] : result.assets;
}

export async function takePhoto(): Promise<PickedAsset | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error("Allow camera access in Settings to take photos.");
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: false });
  return result.canceled ? null : result.assets[0];
}

/** iPhone photos are often HEIC, which the app shows but most browsers (Chrome, Firefox, older Safari) cannot. */
export function isHeic(asset: PickedAsset): boolean {
  const type = asset.mimeType?.toLowerCase() ?? "";
  const name = (asset.fileName ?? asset.uri).toLowerCase();
  return type === "image/heic" || type === "image/heif" || /\.(heic|heif)$/.test(name);
}

/** The same picture as a JPEG at full size, so the website can show it too. */
export async function heicToJpeg(asset: PickedAsset): Promise<{ uri: string; width: number; height: number }> {
  const rendered = await ImageManipulator.manipulate(asset.uri).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9, base64: false });
  if (!saved.uri) throw new Error("Could not prepare this photo. Try another one.");
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/**
 * Upload a picked photo to Supabase Storage and return its public URL + size. JPEG, PNG, WebP and GIF go up untouched;
 * HEIC is converted to JPEG first, because a HEIC profile photo or post shows as a broken image on the website.
 */
export async function uploadPickedPhoto(asset: PickedAsset, kind: UploadKind, userId: string): Promise<PhotoMeta> {
  if (isHeic(asset)) {
    const jpeg = await heicToJpeg(asset);
    const data = await fetch(jpeg.uri).then((r) => r.arrayBuffer());
    const fileName = asset.fileName ? asset.fileName.replace(/\.(heic|heif)$/i, ".jpg") : undefined;
    const url = await uploadImage(supabase, { kind, userId, file: data, fileName, contentType: "image/jpeg" });
    return { url, width: jpeg.width || asset.width || null, height: jpeg.height || asset.height || null, blur: null };
  }
  const data = await fetch(asset.uri).then((r) => r.arrayBuffer());
  const contentType = asset.mimeType ?? (asset.uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
  const url = await uploadImage(supabase, { kind, userId, file: data, fileName: asset.fileName ?? undefined, contentType });
  return { url, width: asset.width ?? null, height: asset.height ?? null, blur: null };
}
