"use client";

import { useEffect } from "react";
import { recordView, type SavedTargetType } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";

const KEY = "ab-viewer-key";

/** Counts one view per viewer per day for a listing (signed in or not). */
export function ViewTracker({ targetType, targetId }: { targetType: SavedTargetType; targetId: string }) {
  useEffect(() => {
    let viewerKey: string | null = null;
    try {
      viewerKey = localStorage.getItem(KEY);
      if (!viewerKey) {
        viewerKey = crypto.randomUUID();
        localStorage.setItem(KEY, viewerKey);
      }
    } catch {
      viewerKey = null;
    }
    recordView(createClient(), targetType, targetId, viewerKey).catch(() => {});
  }, [targetType, targetId]);
  return null;
}
