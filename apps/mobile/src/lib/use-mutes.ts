import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";
import { activeMute, clearMute, listMutes, setMute, type ConversationSummary, type MuteDuration, type MuteScope, type NotificationMute } from "@apartment-book/shared";
import { supabase } from "@/lib/supabase";

/**
 * What the signed-in person has muted (see migration 26): a person's messages anywhere, one chat, or every group chat,
 * each until a time or until unmuted. Read when the screen comes into view and after every change here, so the inbox
 * and a chat's info agree. `mutedFor(chat)` says whether a chat's notices are withheld right now, whichever mute does it.
 */
export function useMutes(userId: string | null) {
  const [mutes, setMutes] = useState<NotificationMute[]>([]);
  const refresh = useCallback(async () => {
    if (!userId) return setMutes([]);
    try {
      setMutes(await listMutes(supabase, userId));
    } catch {
      // The last list stands; muting is never worth an error screen.
    }
  }, [userId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  const mute = useCallback(
    async (scope: MuteScope, targetId: string | null, duration: MuteDuration) => {
      if (!userId) return;
      await setMute(supabase, userId, scope, targetId, duration);
      await refresh();
    },
    [userId, refresh],
  );
  const unmute = useCallback(
    async (scope: MuteScope, targetId: string | null = null) => {
      if (!userId) return;
      await clearMute(supabase, userId, scope, targetId);
      await refresh();
    },
    [userId, refresh],
  );
  const find = useCallback((scope: MuteScope, targetId: string | null = null) => activeMute(mutes, scope, targetId), [mutes]);
  const mutedFor = useCallback(
    (c: ConversationSummary) => {
      if (find("conversation", c.id)) return true;
      if (c.type === "group") return Boolean(find("all_groups"));
      const other = c.otherMembers[0];
      return Boolean(other && find("user", other.id));
    },
    [find],
  );
  return { mutes, refresh, mute, unmute, find, mutedFor };
}
