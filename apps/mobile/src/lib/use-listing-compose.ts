import { useEffect, useState } from "react";
import { listingPrivacyAvailable, verifiedCampus } from "@apartment-book/shared";
import { dropUploads, ensureUpload, type UploadPlace } from "./compose-media";
import type { ComposeState } from "./compose-store";
import { useSession } from "./session";
import { supabase } from "./supabase";

/**
 * "Campus only" is the campus of the account's confirmed university email, as the database decides it, not the
 * profile's (which people can change). Until that is known the profile's stands in, so nothing flickers.
 */
export function useVerifiedCampus(): { campusId: string | null; campus: string | null } {
  const { user, profile } = useSession();
  const [verified, setVerified] = useState<{ id: string; name: string } | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void verifiedCampus(supabase, { email: user?.email, email_confirmed_at: user?.email_confirmed_at }, profile?.role).then((c) => active && setVerified(c));
    return () => {
      active = false;
    };
  }, [user?.email, user?.email_confirmed_at, profile?.role]);
  if (verified === undefined) return { campusId: profile?.university_id ?? null, campus: profile?.university?.name ?? null };
  return { campusId: verified?.id ?? null, campus: verified?.name ?? null };
}

/** Whether this database keeps anonymous listings and listing audiences (null until known). */
export function useListingPrivacyAvailable(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void listingPrivacyAvailable(supabase).then((v) => active && setOk(v));
    return () => {
      active = false;
    };
  }, []);
  return ok;
}

/** Where a listing's photos go: its own folder, or the nameless one when it is posted anonymously. */
export function listingPlace(s: Pick<ComposeState, "mode" | "anonymous">): UploadPlace {
  return { kind: s.mode === "roommate" ? "roommates" : "items", anonymous: s.anonymous };
}

/**
 * A listing's photos and video upload while its steps are being filled in, each to where it belongs: changing
 * whether it is anonymous starts them again in the other folder (a picture's address must never name an anonymous
 * poster). Anything taken out stops.
 */
export function useListingUploads(s: ComposeState) {
  const { user } = useSession();
  useEffect(() => {
    if (!user) return;
    dropUploads(s.media.map((m) => m.id));
    const place = listingPlace(s);
    for (const m of s.media) void ensureUpload(m, user.id, place).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.media, s.anonymous, s.mode, user]);
}
