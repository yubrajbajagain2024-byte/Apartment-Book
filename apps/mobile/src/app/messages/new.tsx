import { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getOrCreateDirectConversation, listFriends, searchProfiles, type ProfileSummary } from "@apartment-book/shared";
import { InboxSearchField } from "@/components/messages/inbox-header";
import { InboxNote, InboxPersonRow, InboxSectionHeader } from "@/components/messages/inbox-row";
import { useUsernames } from "@/components/messages/inbox-utils";
import { Button, EmptyState } from "@/components/ui";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { space } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-provider";

const NOBODY: ProfileSummary[] = [];

/**
 * New message, in the inbox's look: the rounded search box (name or @username), your friends as suggestions until you
 * type, and a tap opens the chat with that person (an existing one, or a new one).
 */
export default function NewMessageScreen() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, loading: sessionLoading } = useSession();
  const me = user?.id ?? null;
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ q: string; people: ProfileSummary[] } | null>(null);
  const [friends, setFriends] = useState<ProfileSummary[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  // Wait until typing stops before searching.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    if (!me) return;
    let alive = true;
    listFriends(supabase).then(
      (rows) => alive && setFriends(rows.filter((p) => p.id !== me)),
      () => alive && setFriends(NOBODY),
    );
    return () => {
      alive = false;
    };
  }, [me]);
  useEffect(() => {
    if (!me || q.length < 2) return;
    let alive = true;
    searchProfiles(supabase, q, { excludeIds: [me], limit: 20 }).then(
      (people) => alive && setResults({ q, people }),
      () => alive && setResults({ q, people: NOBODY }),
    );
    return () => {
      alive = false;
    };
  }, [q, me]);

  const typed = text.trim();
  const typing = typed.length >= 2;
  // The last results stay up while the next search runs, so the list does not flash on every keystroke.
  const people = typing ? (results?.people ?? NOBODY) : (friends ?? NOBODY);
  const pending = typing ? !results || results.q !== typed : friends === null;
  const usernameOf = useUsernames(useMemo(() => people.map((p) => p.id), [people]));

  async function start(person: ProfileSummary) {
    if (opening) return;
    setOpening(person.id);
    try {
      const id = await getOrCreateDirectConversation(supabase, person.id);
      router.replace({ pathname: "/messages/[id]", params: { id } });
    } catch (e) {
      setOpening(null);
      Alert.alert("Couldn't open the chat", errorText(e));
    }
  }

  if (!sessionLoading && !user) {
    return (
      <View style={styles.screen}>
        <EmptyState icon="chatbubbles-outline" title="Log in to send messages" action={<Button title="Log in" onPress={() => router.push("/(auth)/login")} />} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <InboxSearchField value={text} onChangeText={setText} placeholder="Search name or @username" autoFocus accessibilityLabel="Search people" />
      </View>
      <FlatList
        data={people}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
        ListHeaderComponent={people.length > 0 ? <InboxSectionHeader title={typing ? "People" : "Suggested"} /> : null}
        renderItem={({ item }) => <InboxPersonRow person={item} username={usernameOf(item.id)} busy={opening === item.id} disabled={opening !== null} onPress={() => void start(item)} />}
        ListFooterComponent={pending && people.length > 0 ? <InboxNote loading /> : null}
        ListEmptyComponent={
          pending ? (
            <InboxNote loading />
          ) : typing ? (
            <View style={styles.empty}>
              <EmptyState icon="search-outline" title="No one found" body="Try a different spelling of their name or @username." />
            </View>
          ) : (
            <InboxNote text="Search for students by name or @username." />
          )
        }
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { paddingTop: space.sm },
  empty: { paddingTop: space.xl },
}));
