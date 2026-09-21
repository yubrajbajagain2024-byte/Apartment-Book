import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPostEngagementMany, getPostPreviewsMany, getSavedIds, type PostEngagement, type PostPreview, type PostTargetType } from "@apartment-book/shared";
import { supabase } from "./supabase";

/** Saved ids and like/comment counts for the posts currently in a feed. */
export function useEngagement(type: PostTargetType, items: { id: string }[], userId: string | null) {
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [engagement, setEngagement] = useState<Record<string, PostEngagement>>({});
  const ids = useMemo(() => items.map((i) => i.id).join(","), [items]);
  const loadedFor = useRef(userId);
  useEffect(() => {
    const list = ids ? ids.split(",") : [];
    // "Liked by me" belongs to one person: after signing in or out, fetch everything again.
    const userChanged = loadedFor.current !== userId;
    loadedFor.current = userId;
    const missing = userChanged ? list : list.filter((id) => !(id in engagement));
    if (missing.length > 0) getPostEngagementMany(supabase, type, missing).then((rows) => setEngagement((prev) => ({ ...prev, ...rows }))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, type, userId]);
  useEffect(() => {
    if (!userId) {
      setSavedIds(new Set());
      return;
    }
    getSavedIds(supabase, userId, type).then(setSavedIds).catch(() => {});
  }, [userId, type]);
  return { savedIds, engagement };
}

/** "Liked by …" faces and the newest comment for the posts in a feed. `refresh(id)` reloads one post, e.g. after its comment sheet closes. */
export function usePostPreviews(type: PostTargetType, items: { id: string }[], userId: string | null) {
  const [previews, setPreviews] = useState<Record<string, PostPreview>>({});
  const ids = useMemo(() => items.map((i) => i.id).join(","), [items]);
  const loadedFor = useRef(userId);
  useEffect(() => {
    const list = ids ? ids.split(",") : [];
    // Blocks hide people from these lines, so a different viewer means a fresh load.
    const userChanged = loadedFor.current !== userId;
    loadedFor.current = userId;
    const missing = userChanged ? list : list.filter((id) => !(id in previews));
    if (missing.length > 0) getPostPreviewsMany(supabase, type, missing).then((rows) => setPreviews((prev) => ({ ...prev, ...rows }))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, type, userId]);
  const refresh = useCallback(
    (id: string) => {
      getPostPreviewsMany(supabase, type, [id]).then((rows) => setPreviews((prev) => ({ ...prev, ...rows }))).catch(() => {});
    },
    [type],
  );
  return { previews, refresh };
}
