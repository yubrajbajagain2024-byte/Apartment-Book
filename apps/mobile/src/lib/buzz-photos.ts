import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { BUZZ_IMAGE_MAX_DIMENSION, BUZZ_IMAGE_QUALITY, uploadImage, type PhotoMeta } from "@apartment-book/shared";
import { supabase } from "./supabase";

/**
 * Photos for anonymous Buzz threads.
 *
 * Every photo is redrawn on the device into a brand-new JPEG before it leaves the phone.
 * The new file holds pixels only: no GPS position, no camera or phone model, no capture time,
 * no original file name. It is then uploaded with kind "buzz", which stores it under buzz/anon/
 * so the public link does not contain the uploader's id either.
 *
 * Never upload the picked file itself from here. If re-encoding fails, the photo is not added.
 */

export type BuzzPickedPhoto = { uri: string; width: number; height: number };

/** Pick up to `max` photos from the library. Returns [] when cancelled. */
export async function pickBuzzPhotos(max: number): Promise<BuzzPickedPhoto[]> {
  if (max <= 0) return [];
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error("Allow photo access in Settings to add photos.");
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: max > 1, selectionLimit: max, quality: 1, exif: false, base64: false });
  if (result.canceled) return [];
  return result.assets.slice(0, max).map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
}

/** Take one photo with the camera. Returns null when cancelled. */
export async function takeBuzzPhoto(): Promise<BuzzPickedPhoto | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error("Allow camera access in Settings to take photos.");
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: false, base64: false });
  if (result.canceled) return null;
  const a = result.assets[0];
  return { uri: a.uri, width: a.width, height: a.height };
}

/** Redraw the photo as a fresh JPEG (longest side <= BUZZ_IMAGE_MAX_DIMENSION). The result carries no metadata. */
export async function reencodeBuzzPhoto(photo: BuzzPickedPhoto): Promise<BuzzPickedPhoto> {
  const context = ImageManipulator.manipulate(photo.uri);
  const longest = Math.max(photo.width || 0, photo.height || 0);
  // When the picker did not tell us the size, resize anyway so a huge photo can never slip through.
  if (longest === 0 || longest > BUZZ_IMAGE_MAX_DIMENSION) {
    context.resize(photo.height > photo.width ? { height: BUZZ_IMAGE_MAX_DIMENSION } : { width: BUZZ_IMAGE_MAX_DIMENSION });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: BUZZ_IMAGE_QUALITY, base64: false });
  if (!saved.uri || saved.uri === photo.uri) throw new Error("Could not prepare this photo. Try another one.");
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/** Re-encode, then upload to the anonymous Buzz folder. `userId` is only used by storage rules, never in the file path. */
export async function uploadBuzzPhoto(photo: BuzzPickedPhoto, userId: string): Promise<PhotoMeta> {
  const clean = await reencodeBuzzPhoto(photo);
  const data = await fetch(clean.uri).then((r) => r.arrayBuffer());
  // No fileName on purpose: original names can contain dates, places or a person's name.
  const url = await uploadImage(supabase, { kind: "buzz", userId, file: data, contentType: "image/jpeg" });
  return { url, width: clean.width, height: clean.height, blur: null };
}
