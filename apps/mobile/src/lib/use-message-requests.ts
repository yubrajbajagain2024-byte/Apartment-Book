import { useEffect, useMemo, useRef, useState } from "react";
import { conversationsWrittenIn, getFollowStatsMany, type ConversationSummary } from "@apartment-book/shared";
import { supabase } from "@/lib/supabase";

const NONE: ReadonlySet<string> = new Set();

/**
 * Message requests, Instagram style: a direct chat that someone you do not follow started with you and that you have not
 * written in yet sits under Requests, not Chats, until you reply (or follow them). Nothing is stored for this: it is read
 * off the chats themselves, the follow stats of the people in them and whether you have a message in each, so it is the
 * same on every device. `loading` is true while the chats on screen have not been sorted yet (they all count as chats
 * meanwhile, so nothing flickers in and out of Requests).
 */
export function useMessageRequests(conversations: ConversationSummary[], userId: string | null): { requestIds: ReadonlySet<string>; loading: boolean } {
  // Only a direct chat with messages that somebody else started can be a request.
  const candidates = useMemo(() => conversations.filter((c) => c.type !== "group" && c.lastMessageAt && c.createdBy !== userId && c.otherMembers.length === 1), [conversations, userId]);
  // A new message in a candidate (your reply, say) changes the key and sorts the chats again.
  const key = userId ? candidates.map((c) => `${c.id}:${c.lastMessageAt}`).join(",") : "";
  const [state, setState] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: "", ids: NONE });
  const done = useRef("");

  useEffect(() => {
    if (done.current === key) return;
    if (!userId || candidates.length === 0) {
      done.current = key;
      setState({ key, ids: NONE });
      return;
    }
    let alive = true;
    (async () => {
      try {
        const stats = await getFollowStatsMany(supabase, candidates.map((c) => c.otherMembers[0]!.id));
        const strangers = candidates.filter((c) => !stats[c.otherMembers[0]!.id]?.followedByMe);
        const written = await conversationsWrittenIn(supabase, userId, strangers.map((c) => c.id));
        if (!alive) return;
        done.current = key;
        setState({ key, ids: new Set(strangers.filter((c) => !written.has(c.id)).map((c) => c.id)) });
      } catch {
        // Could not tell: everything stays under Chats until the next look.
        if (!alive) return;
        done.current = key;
        setState({ key, ids: NONE });
      }
    })();
    return () => {
      alive = false;
    };
  }, [key, userId, candidates]);

  return { requestIds: state.ids, loading: state.key !== key };
}
