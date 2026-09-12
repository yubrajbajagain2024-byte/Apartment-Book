import * as ImagePicker from "expo-image-picker";
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

/** Upload the original file untouched to Supabase Storage and return its public URL + size. */
export async function uploadPickedPhoto(asset: PickedAsset, kind: UploadKind, userId: string): Promise<PhotoMeta> {
  const data = await fetch(asset.uri).then((r) => r.arrayBuffer());
  const contentType = asset.mimeType ?? (asset.uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
  const url = await uploadImage(supabase, { kind, userId, file: data, fileName: asset.fileName ?? undefined, contentType });
  return { url, width: asset.width ?? null, height: asset.height ?? null, blur: null };
}
