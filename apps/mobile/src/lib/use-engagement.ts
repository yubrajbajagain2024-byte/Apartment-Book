import { useEffect, useMemo, useRef, useState } from "react";
import { getPostEngagementMany, getSavedIds, type PostEngagement, type PostTargetType } from "@apartment-book/shared";
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
