import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import { getProfile, updateProfile } from "@apartment-book/shared";
import { errorText } from "./hooks";
import { pickPhotos, uploadPickedPhoto, type PickedAsset } from "./photos";
import { useSession } from "./session";
import { supabase } from "./supabase";

/**
 * Pick a new profile photo and upload it: the "+" on your own profile and "Change photo" in Settings. With `save`, the
 * photo replaces the old one straight away and the session profile reloads, so every avatar of yours updates; without
 * it, the caller holds on to the returned URL until its own Save. Resolves to the new URL, or null when the picker was
 * cancelled or something failed (an alert says what).
 */
export function useChangeAvatar({ save = false }: { save?: boolean } = {}) {
  const { user, refreshProfile } = useSession();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const userId = user?.id ?? null;

  const change = useCallback(async (): Promise<string | null> => {
    if (!userId || running.current) return null;
    let asset: PickedAsset | undefined;
    try {
      [asset] = await pickPhotos(1);
    } catch (e) {
      // No photo access: the message says where to allow it.
      Alert.alert("Photo", errorText(e));
      return null;
    }
    if (!asset) return null;
    running.current = true;
    setBusy(true);
    try {
      const { url } = await uploadPickedPhoto(asset, "avatars", userId);
      if (save) {
        // updateProfile writes every basic field, so it starts from the stored profile rather than what this screen last saw.
        const current = await getProfile(supabase, userId);
        if (!current) throw new Error("Your profile could not be found.");
        await updateProfile(supabase, userId, { fullName: current.full_name, universityId: current.university_id, program: current.program, graduationYear: current.graduation_year, bio: current.bio, avatarUrl: url });
        await refreshProfile();
      }
      return url;
    } catch (e) {
      Alert.alert("Photo", errorText(e, "Could not change your photo. Try again."));
      return null;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [userId, save, refreshProfile]);

  return { change, busy };
}
