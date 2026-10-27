import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { MAX_POST_VIEWERS } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { Sheet, SheetFooter, SheetHeader } from "@/components/sheet";
import { Button } from "@/components/ui";
import type { ComposeViewer } from "@/lib/compose-store";
import { hapticSelect } from "@/lib/haptics";
import { findPeople, type PersonPick } from "@/lib/people-lookup";
import { auroraGradient, radius } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/**
 * "Selected people": choosing exactly who sees a post. Your friends are listed first; type a name to find anyone on
 * UniBuzz. The ones picked line up at the top (tap one to take it out), up to MAX_POST_VIEWERS; Done keeps the choice.
 * Only the author and each person picked ever know who was picked (the database shows nobody the list but its author).
 */
export function PeopleSheet({ visible, value, me, onClose, onDone }: { visible: boolean; value: ComposeViewer[]; me: string | null; onClose: () => void; onDone: (people: ComposeViewer[]) => void }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const [picked, setPicked] = useState<ComposeViewer[]>(value);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<PersonPick[] | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPicked(value);
    setText("");
    setQuery("");
    // Reopened with the choice as it stands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setFound(null);
    findPeople(query, 40)
      .then((list) => active && setFound(list.filter((p) => p.id !== me)))
      .catch(() => active && setFound([]));
    return () => {
      active = false;
    };
  }, [visible, query, me]);

  const chosen = new Set(picked.map((p) => p.id));
  const full = picked.length >= MAX_POST_VIEWERS;
  const toggle = (p: PersonPick) => {
    if (chosen.has(p.id)) {
      hapticSelect();
      setPicked(picked.filter((x) => x.id !== p.id));
      return;
    }
    if (full) return;
    hapticSelect();
    setPicked([...picked, p]);
  };

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel="Close choosing people" height="88%" keyboard>
      <SheetHeader title="Selected people" />
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Icon name="search" size={17} color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Search by name or username"
            placeholderTextColor={colors.faint}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            keyboardAppearance={isDark ? "dark" : "light"}
            accessibilityLabel="Search people"
            style={styles.input}
          />
        </View>
      </View>
      {picked.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {picked.map((p) => (
            <Pressable key={p.id} onPress={() => toggle(p)} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`Remove ${p.full_name}`}>
              <Avatar name={p.full_name} url={p.avatar_url} size="xs" online={false} />
              <Text style={styles.chipText} numberOfLines={1}>
                {p.full_name.split(" ")[0]}
              </Text>
              <Icon name="close" size={12} weight="bold" color={colors.muted} />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <Text style={styles.section}>{query ? "People" : "Your friends"}</Text>
      <View style={{ flex: 1 }}>
        {found === null ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.muted} />
        ) : found.length === 0 ? (
          <Text style={styles.empty}>{query ? "No one by that name." : "No friends yet. Search for someone by name."}</Text>
        ) : (
          <FlatList
            data={found}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const on = chosen.has(item.id);
              return (
                <Pressable
                  onPress={() => toggle(item)}
                  disabled={!on && full}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.input }, !on && full && { opacity: 0.45 }]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: !on && full }}
                  accessibilityLabel={item.full_name}
                >
                  <Avatar name={item.full_name} url={item.avatar_url} size="sm" online={false} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.full_name}
                    </Text>
                    {item.username ? (
                      <Text style={styles.handle} numberOfLines={1}>
                        @{item.username}
                      </Text>
                    ) : null}
                  </View>
                  <View style={[styles.check, on && { borderColor: "transparent", backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135) }]}>
                    {on ? <Icon name="checkmark" size={14} weight="bold" color={colors.onBrand} /> : null}
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </View>
      <SheetFooter>
        {full ? <Text style={[styles.empty, { paddingVertical: 0, paddingBottom: 8 }]}>That's the most: {MAX_POST_VIEWERS} people.</Text> : null}
        <Button title={picked.length > 0 ? `Done (${picked.length})` : "Done"} size="large" disabled={picked.length === 0} onPress={() => onDone(picked)} />
      </SheetFooter>
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  searchRow: { paddingHorizontal: 16, paddingTop: 10 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 42, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.input },
  input: { flex: 1, fontSize: 16, color: colors.text, height: 42 },
  chips: { gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 4, paddingRight: 10, height: 32, borderRadius: radius.pill, backgroundColor: colors.input, maxWidth: 160 },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.text, flexShrink: 1 },
  section: { fontSize: 13, fontWeight: "600", color: colors.muted, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  empty: { fontSize: 14, color: colors.muted, textAlign: "center", paddingVertical: 24, paddingHorizontal: 24 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 9 },
  name: { fontSize: 15, fontWeight: "600", color: colors.text },
  handle: { fontSize: 13, color: colors.muted, marginTop: 1 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.faint, alignItems: "center", justifyContent: "center" },
}));
