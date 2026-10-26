import * as ImagePicker from "expo-image-picker";
import { BUZZ_COMPOSER_COPY, BUZZ_LIMITS, muxPosterUrl } from "@apartment-book/shared";
import type { DraftVideo } from "./buzz-store";
import { devOverrides } from "./dev-overrides";
import { uploadVideo } from "./video";

/**
 * One video for a buzz: at most a minute (BUZZ_LIMITS.videoMaxSeconds), checked on the phone before anything is
 * uploaded, filmed with the camera capped at a minute. It goes straight to Mux through the app's usual upload (see
 * video.ts) under a neutral file name, since the original one can carry a date, a place or a name; the buzz then stores
 * only its playback id (the database keeps no media id for it), and Mux's renditions carry none of the file's metadata.
 */

/** A video longer than this (the limit plus half a second of rounding) is refused before upload. */
const MAX_MS = BUZZ_LIMITS.videoMaxSeconds * 1000 + 500;

export class BuzzVideoTooLong extends Error {
  constructor() {
    super(BUZZ_COMPOSER_COPY.videoTooLong);
    this.name = "BuzzVideoTooLong";
  }
}

export type PickedBuzzVideo = ImagePicker.ImagePickerAsset;

/** Films one (stopping at a minute) or picks one from the library. Null when cancelled; throws BuzzVideoTooLong. */
export async function pickBuzzVideo(source: "camera" | "library"): Promise<PickedBuzzVideo | null> {
  let asset: PickedBuzzVideo | undefined;
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error("Allow camera access in Settings to film a video.");
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["videos"], videoMaxDuration: BUZZ_LIMITS.videoMaxSeconds, videoQuality: ImagePicker.UIImagePickerControllerQualityType.High, exif: false });
    if (result.canceled) return null;
    asset = result.assets[0];
  } else {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new Error("Allow photo access in Settings to add a video.");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], allowsMultipleSelection: false, quality: 1 });
    if (result.canceled) return null;
    asset = result.assets[0];
  }
  if (!asset) return null;
  // expo-image-picker reports the length in milliseconds.
  if (typeof asset.duration === "number" && asset.duration > MAX_MS) throw new BuzzVideoTooLong();
  return asset;
}

/** Uploads the picked video and waits until Mux has it ready; also refuses one Mux measured over the limit. */
export async function uploadBuzzVideo(asset: PickedBuzzVideo, onProgress: (fraction: number, phase: "uploading" | "processing") => void): Promise<DraftVideo> {
  // Buzz sample data (development): nothing goes to Mux; a pretend upload, then a video that will not play.
  if (devOverrides.buzzFixtures) {
    if (typeof asset.duration === "number" && asset.duration > MAX_MS) throw new BuzzVideoTooLong();
    for (let p = 0; p <= 1; p += 0.1) {
      onProgress(p, "uploading");
      await new Promise((r) => setTimeout(r, 120));
    }
    onProgress(1, "processing");
    return { playbackId: "fixturePlaybackId00000", posterUrl: null, width: asset.width, height: asset.height, durationSeconds: typeof asset.duration === "number" ? asset.duration / 1000 : null };
  }
  const v = await uploadVideo({ ...asset, fileName: "buzz.mp4" }, onProgress);
  if (typeof v.duration_seconds === "number" && v.duration_seconds * 1000 > MAX_MS) throw new BuzzVideoTooLong();
  return { playbackId: v.playback_id, posterUrl: v.poster_url ?? muxPosterUrl(v.playback_id), width: v.width, height: v.height, durationSeconds: v.duration_seconds };
}
