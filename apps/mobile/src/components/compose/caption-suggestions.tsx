import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { captionParts } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { findPeople, type PersonPick } from "@/lib/people-lookup";
import { supabase } from "@/lib/supabase";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/** The word being typed when it is a #tag or an @mention: what the caption's suggestions are for. */
export type CaptionToken = { kind: "#" | "@"; query: string; start: number; end: number };

/** The #word or @word that ends at the cursor, if that is what is being typed. */
export function tokenAt(text: string, cursor: number): CaptionToken | null {
  const before = text.slice(0, cursor);
  const m = /(^|\s)([#@])([\p{L}\p{M}\p{N}_.]{0,40})$/u.exec(before);
  if (!m) return null;
  const start = cursor - m[2].length - m[3].length;
  return { kind: m[2] as "#" | "@", query: m[3], start, end: cursor };
}


/** Hashtags in use on recent posts, most used first: read once per app run. */
let trending: Promise<{ tag: string; count: number }[]> | null = null;
function trendingTags(): Promise<{ tag: string; count: number }[]> {
  if (!trending) {
    trending = Promise.resolve(supabase.from("feed_posts").select("body").order("created_at", { ascending: false }).limit(300)).then(({ data }) => {
      const counts = new Map<string, { tag: string; count: number }>();
      for (const row of (data ?? []) as { body: string | null }[]) {
        for (const part of captionParts(row.body ?? "")) {
          if (!part.tag) continue;
          const key = part.text.toLowerCase();
          const entry = counts.get(key) ?? { tag: part.text, count: 0 };
          entry.count += 1;
          counts.set(key, entry);
        }
      }
      return [...counts.values()].sort((a, b) => b.count - a.count);
    });
    trending.catch(() => {
      trending = null;
    });
  }
  return trending;
}

/**
 * What the caption offers while a #tag or an @mention is being typed, in place of the settings under it (TikTok's
 * way): tags already in use on UniBuzz (and the one being typed, new), or people to mention, friends first. Picking
 * one finishes the word.
 */
export function CaptionSuggestions({ token, me, onPick }: { token: CaptionToken; me: string | null; onPick: (text: string) => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const [tags, setTags] = useState<{ tag: string; count: number }[] | null>(null);
  const [found, setFound] = useState<PersonPick[] | null>(null);

  useEffect(() => {
    if (token.kind !== "#") return;
    let active = true;
    trendingTags()
      .then((all) => active && setTags(all))
      .catch(() => active && setTags([]));
    return () => {
      active = false;
    };
  }, [token.kind]);

  useEffect(() => {
    if (token.kind !== "@") return;
    let active = true;
    const t = setTimeout(() => {
      findPeople(token.query, 12)
        .then((list) => active && setFound(list.filter((p) => p.id !== me && p.username)))
        .catch(() => active && setFound([]));
    }, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [token.kind, token.query, me]);

  if (token.kind === "#") {
    const q = token.query.toLowerCase();
    const matches = (tags ?? []).filter((t) => t.tag.slice(1).toLowerCase().startsWith(q)).slice(0, 8);
    const typed = token.query ? `#${token.query}` : null;
    const showTyped = typed && !matches.some((m) => m.tag.toLowerCase() === typed.toLowerCase());
    return (
      <View style={styles.list} accessibilityLabel="Hashtag suggestions">
        {showTyped ? <Row icon="#" title={typed} hint="New hashtag" onPress={() => onPick(typed)} /> : null}
        {tags === null ? <ActivityIndicator style={{ marginVertical: 14 }} color={colors.muted} /> : null}
        {matches.map((m) => (
          <Row key={m.tag} icon="#" title={m.tag} hint={m.count === 1 ? "1 post" : `${m.count} posts`} onPress={() => onPick(m.tag)} />
        ))}
        {tags !== null && matches.length === 0 && !showTyped ? <Text style={styles.empty}>Type a word to make a hashtag</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.list} accessibilityLabel="People to mention">
      {found === null ? <ActivityIndicator style={{ marginVertical: 14 }} color={colors.muted} /> : null}
      {found?.map((p) => (
        <Pressable key={p.id} onPress={() => onPick(`@${p.username}`)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.input }]} accessibilityRole="button" accessibilityLabel={`Mention ${p.full_name}`}>
          <Avatar name={p.full_name} url={p.avatar_url} size="sm" online={false} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {p.full_name}
            </Text>
            <Text style={styles.hint} numberOfLines={1}>
              @{p.username}
            </Text>
          </View>
        </Pressable>
      ))}
      {found !== null && found.length === 0 ? <Text style={styles.empty}>{token.query ? "No one by that name" : "Type a name to mention someone"}</Text> : null}
    </View>
  );
}

function Row({ icon, title, hint, onPress }: { icon: string; title: string; hint: string; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.input }]} accessibilityRole="button" accessibilityLabel={`${title}, ${hint}`}>
      <View style={styles.tagIcon}>
        <Text style={styles.tagIconText}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Icon name="add" size={18} color={colors.faint} />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 9 },
  tagIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.input },
  tagIconText: { fontSize: 17, fontWeight: "700", color: colors.text },
  title: { fontSize: 15, fontWeight: "600", color: colors.text },
  hint: { fontSize: 13, color: colors.muted, marginTop: 1 },
  empty: { fontSize: 14, color: colors.muted, textAlign: "center", paddingVertical: 16 },
}));
