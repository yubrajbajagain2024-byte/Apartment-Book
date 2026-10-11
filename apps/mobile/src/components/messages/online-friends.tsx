import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { getOrCreateDirectConversation, type ProfileSummary } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { errorText } from "@/lib/hooks";
import { useOnlineUsers } from "@/lib/presence";
import { supabase } from "@/lib/supabase";
import { space } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-provider";
import { INBOX_AVATAR } from "./inbox-row";
import { notify } from "./info-dialogs";

/** One friend's column: a photo as big as the chats' below it, with room either side for the first name. */
const ITEM_WIDTH = INBOX_AVATAR + 8;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * Opening your chat with a friend from the online row. The inbox screen holds this, not the row, so it outlives the list
 * (which starts over on another filter or a search). `openFriend` finds or makes the 1:1 chat and opens it, or says why
 * it could not; meanwhile `openingFriend` is that friend's id and the row is disabled. After the chat opens, taps do
 * nothing until the inbox is shown again, so a quick second tap cannot open it twice. If you leave the inbox (for another
 * chat or tab) before the chat is found, it is not opened over where you are, and no error is shown there.
 */
export function useOpenFriendChat() {
  const router = useRouter();
  const [openingFriend, setOpeningFriend] = useState<string | null>(null);
  // Blocks further taps; the state above updates too late to stop a quick second one.
  const busy = useRef(false);
  // Moves on each time the inbox is left, so an answer can tell whether you are still where you tapped.
  const visit = useRef(0);

  useFocusEffect(
    useCallback(() => {
      busy.current = false;
      setOpeningFriend(null);
      return () => {
        visit.current += 1;
      };
    }, []),
  );

  const openFriend = useCallback(
    async (friend: ProfileSummary) => {
      if (busy.current) return;
      busy.current = true;
      setOpeningFriend(friend.id);
      Keyboard.dismiss();
      const tappedOn = visit.current;
      try {
        const id = await getOrCreateDirectConversation(supabase, friend.id);
        if (visit.current !== tappedOn) return;
        router.push({ pathname: "/messages/[id]", params: { id } });
        // The photo brightens again, but taps stay ignored while the chat opens over the inbox.
        setOpeningFriend(null);
      } catch (e) {
        if (visit.current !== tappedOn) return;
        busy.current = false;
        setOpeningFriend(null);
        notify("Couldn't open the chat", errorText(e, "Please try again."));
      }
    },
    [router],
  );

  return { openingFriend, openFriend };
}

/**
 * Messenger's row of active friends, at the top of the inbox right under the search box: each of `friends` (people you
 * follow who follow you back) who is online right now, as their photo with the green dot and their first name, in the
 * order `friends` comes in (by name). A tap opens your chat with them (`onOpen` and `opening` come from
 * useOpenFriendChat). Who is online comes live from the presence channel, so friends who hide their active status never
 * show here, and nobody does while you hide yours. With no friend online the row is not there at all.
 *
 * While the list is `scrolled` down, the row neither appears nor goes away, since either would move every chat on screen
 * by its height; it catches up once the list is back at the top. Faces still come and go meanwhile, but the last ones to
 * go offline stay (without the green dot) until then.
 */
export const InboxOnlineFriends = memo(function InboxOnlineFriends({ friends, me, scrolled, opening, onOpen }: { friends: ProfileSummary[]; me: string | null; scrolled: boolean; opening: string | null; onOpen: (friend: ProfileSummary) => void }) {
  const styles = useStyles();
  const online = useOnlineUsers();
  const live = useMemo(() => friends.filter((f) => f.id !== me && online.has(f.id)), [friends, me, online]);
  // Who the row shows: `live`, except that while the list is scrolled down it stays shown, or hidden, as it was.
  const [people, setPeople] = useState(live);
  if (people !== live && (!scrolled || (people.length > 0) === (live.length > 0))) setPeople(live);

  if (people.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // The status bar's scroll-to-top is for the chats underneath; this row stays out of its way.
      scrollsToTop={false}
      keyboardShouldPersistTaps="handled"
      accessibilityRole="list"
      accessibilityLabel="Online friends"
      contentContainerStyle={styles.row}
    >
      {people.map((p) => {
        const active = online.has(p.id);
        return (
          <View
            key={p.id}
            // `accessibilityRole` has no list item, so `role` gives the list its items: <li>s on the web; phones ignore it.
            role="listitem"
          >
            <Pressable
              onPress={() => onOpen(p)}
              disabled={opening !== null}
              accessibilityRole="button"
              accessibilityLabel={`Message ${p.full_name}`}
              accessibilityValue={active ? { text: "Active now" } : undefined}
              accessibilityHint="Opens your chat with them"
              accessibilityState={{ disabled: opening !== null, busy: opening === p.id }}
              style={({ pressed }) => [styles.item, (pressed || opening === p.id) && styles.dimmed]}
            >
              <Avatar name={p.full_name} url={p.avatar_url} size={INBOX_AVATAR} online={active} />
              <Text style={styles.name} numberOfLines={1}>
                {firstName(p.full_name)}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
});

const useStyles = makeStyles((colors) => ({
  // The side padding less half a column's spare width, so the first photo lines up with the chats' photos below.
  row: { gap: space.sm, paddingHorizontal: space.lg - (ITEM_WIDTH - INBOX_AVATAR) / 2, paddingTop: space.xs, paddingBottom: space.sm },
  item: { width: ITEM_WIDTH, alignItems: "center", gap: 6 },
  dimmed: { opacity: 0.6 },
  name: { maxWidth: ITEM_WIDTH, fontSize: 13, color: colors.text },
}));
