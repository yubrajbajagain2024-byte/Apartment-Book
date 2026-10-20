import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, SectionList, Text, TextInput, View } from "react-native";
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { SNAP_LIMITS, listSnapRecipients, type SnapRecipient } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { Sheet, SheetFooter, SheetHeader } from "@/components/sheet";
import { useReduceMotion } from "@/lib/accessibility";
import { hapticSelect } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { auroraGradient, motion, radius } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

export type SnapSendStatus = "idle" | "sending" | "sent";

type Section = { key: string; title: string | null; data: SnapRecipient[] };

/** Names compared without case or accents: "jose" finds José. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** "To Maya", "To Maya and Leo", "To Maya, Leo and 3 more". */
function toLine(names: string[]): string {
  if (names.length <= 2) return `To ${names.join(" and ")}`;
  return `To ${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/**
 * Send To, over the Snap: everyone it can go to (the people you chat with, the most recent first, then your friends A to
 * Z), a search over them, and once someone is picked a bar that rises with who it goes to and the round send button.
 * The screen behind uploads and sends; the bar shows how far along that is, then the paper plane flies off and a tick
 * lands. A fresh list each time it opens.
 */
export function SnapSendSheet({
  visible,
  onClose,
  onDismiss,
  onSend,
  status,
  progress,
}: {
  visible: boolean;
  onClose: () => void;
  /** Once the sheet is fully gone. */
  onDismiss?: () => void;
  onSend: (people: SnapRecipient[]) => void;
  status: SnapSendStatus;
  /** 0 to 1: how much of the file has gone up while sending. */
  progress: number;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} onDismiss={onDismiss} closeLabel="Close Send To" height="88%" keyboard>
      <SendToBody onClose={onClose} onSend={onSend} status={status} progress={progress} />
    </Sheet>
  );
}

function SendToBody({ onClose, onSend, status, progress }: { onClose: () => void; onSend: (people: SnapRecipient[]) => void; status: SnapSendStatus; progress: number }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const [everyone, setEveryone] = useState<SnapRecipient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [q, setQ] = useState("");
  /** Who gets it, by id, in the order they were picked. */
  const [picked, setPicked] = useState<Map<string, SnapRecipient>>(new Map());
  const busy = status !== "idle";

  // Everyone at once (at most 500): the search below is instant and needs no round trip.
  useEffect(() => {
    let stale = false;
    setError(null);
    listSnapRecipients(supabase).then(
      (rows) => {
        if (!stale) setEveryone(rows);
      },
      (e) => {
        if (!stale) setError(errorText(e, "Couldn't load your friends and chats."));
      },
    );
    return () => {
      stale = true;
    };
  }, [attempt]);

  const sections = useMemo<Section[]>(() => {
    if (!everyone) return [];
    const needle = fold(q.trim());
    if (needle) {
      const hits = everyone.filter((p) => fold(p.full_name).includes(needle));
      return hits.length > 0 ? [{ key: "results", title: null, data: hits }] : [];
    }
    const recent = everyone.filter((p) => p.lastMessageAt);
    const friends = everyone.filter((p) => !p.lastMessageAt);
    const out: Section[] = [];
    if (recent.length > 0) out.push({ key: "recent", title: "Recent chats", data: recent });
    if (friends.length > 0) out.push({ key: "friends", title: "Friends", data: friends });
    return out;
  }, [everyone, q]);

  function toggle(person: SnapRecipient) {
    if (busy) return;
    if (!picked.has(person.id) && picked.size >= SNAP_LIMITS.maxRecipients) {
      Alert.alert("That's everyone for this Snap", `A Snap can go to up to ${SNAP_LIMITS.maxRecipients} people at a time.`);
      return;
    }
    hapticSelect();
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(person.id)) next.delete(person.id);
      else next.set(person.id, person);
      return next;
    });
  }

  const names = [...picked.values()].map((p) => p.full_name.split(" ")[0] || p.full_name);
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const progressLine = status === "sent" ? "Sent" : status === "sending" ? (progress < 1 ? `Sending… ${percent}%` : "Sending…") : "Opens once, then it's gone";

  let body;
  if (error && !everyone) {
    body = (
      <View style={styles.empty}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={() => setAttempt((n) => n + 1)} accessibilityRole="button" accessibilityLabel="Retry" style={({ pressed }) => [styles.ghostButton, pressed && { opacity: 0.7 }]}>
          <Text style={styles.ghostButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  } else if (!everyone) {
    body = (
      <View style={styles.empty}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  } else if (everyone.length === 0) {
    body = (
      <View style={styles.empty}>
        <Icon name="people-outline" size={44} color={colors.faint} />
        <Text style={styles.emptyTitle}>No one to send it to yet</Text>
        <Text style={styles.emptyBody}>Friends who follow you back and people you chat with show up here.</Text>
      </View>
    );
  } else {
    body = (
      <SectionList
        sections={sections}
        keyExtractor={(p) => p.id}
        extraData={picked}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => (section.title ? <Text style={styles.section}>{section.title}</Text> : null)}
        renderItem={({ item }) => <RecipientRow person={item} selected={picked.has(item.id)} disabled={busy} onPress={() => toggle(item)} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyBody}>No one matches “{q.trim()}”.</Text>
          </View>
        }
      />
    );
  }

  return (
    <>
      <SheetHeader title="Send To" onClose={onClose} closeLabel="Close Send To" />
      <View style={styles.search}>
        <Icon name="search-outline" size={18} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search friends and chats"
          placeholderTextColor={colors.faint}
          keyboardAppearance={isDark ? "dark" : "light"}
          accessibilityLabel="Search friends and chats"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          editable={!busy}
          style={styles.searchInput}
        />
      </View>
      <View style={{ flex: 1 }}>{body}</View>
      <SheetFooter style={styles.footer}>
        {picked.size > 0 ? (
          <Animated.View entering={reduceMotion ? undefined : FadeInDown.springify().damping(18).stiffness(240)} style={styles.sendRow}>
            <View style={styles.sendWords}>
              <Text style={styles.to} numberOfLines={1}>
                {toLine(names)}
              </Text>
              <Text style={[styles.progress, status === "sent" && { color: colors.successText }]} numberOfLines={1}>
                {progressLine}
              </Text>
            </View>
            <SendButton status={status} disabled={busy} onPress={() => onSend([...picked.values()])} />
          </Animated.View>
        ) : (
          <Text style={styles.hint}>Pick who gets it. Each of them can view it once.</Text>
        )}
      </SheetFooter>
    </>
  );
}

/** One person: photo, name, why they are here, and the round mark that fills in with the Aurora when picked. */
function RecipientRow({ person, selected, disabled, onPress }: { person: SnapRecipient; selected: boolean; disabled: boolean; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={person.full_name}
      accessibilityHint={person.isFriend ? "Friend" : "In your chats"}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.input }]}
    >
      <Avatar name={person.full_name} url={person.avatar_url} size={44} userId={person.id} ringColor={colors.elevated} />
      <View style={styles.rowWords}>
        <Text style={styles.name} numberOfLines={1}>
          {person.full_name}
        </Text>
        <Text style={styles.why} numberOfLines={1}>
          {person.isFriend ? "Friend" : "In your chats"}
        </Text>
      </View>
      <PickMark selected={selected} />
    </Pressable>
  );
}

/** An empty ring; picked, the Aurora disc with a tick pops in. Unpicking it empties at once: only what turns on moves. */
function PickMark({ selected }: { selected: boolean }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const pop = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    if (!selected) pop.value = 0;
    else pop.value = reduceMotion ? 1 : withSequence(withTiming(0.55, { duration: 0 }), withSpring(1, motion.snappy));
  }, [selected, reduceMotion, pop]);
  const disc = useAnimatedStyle(() => ({ opacity: pop.value > 0 ? 1 : 0, transform: [{ scale: pop.value }] }));
  return (
    <View style={[styles.ring, selected && { borderColor: "transparent" }]}>
      <Animated.View style={[styles.disc, { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135) }, disc]}>
        <Icon name="checkmark" size={14} color={colors.onBrand} weight="bold" />
      </Animated.View>
    </View>
  );
}

/** The round send button: the paper plane on the Aurora; while sending a spinner; sent, the plane flies off and a tick lands on green. */
function SendButton({ status, disabled, onPress }: { status: SnapSendStatus; disabled: boolean; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const fly = useSharedValue(0);
  const tick = useSharedValue(0);
  useEffect(() => {
    if (status === "sent") {
      fly.value = reduceMotion ? 1 : withTiming(1, { duration: 300, easing: Easing.in(Easing.cubic) });
      tick.value = reduceMotion ? 1 : withDelay(150, withSpring(1, motion.snappy));
    } else {
      fly.value = 0;
      tick.value = 0;
    }
  }, [status, reduceMotion, fly, tick]);
  const plane = useAnimatedStyle(() => ({
    opacity: 1 - fly.value,
    transform: [{ translateX: fly.value * 24 }, { translateY: -fly.value * 24 }, { rotate: `${-fly.value * 14}deg` }],
  }));
  const check = useAnimatedStyle(() => ({ opacity: tick.value, transform: [{ scale: 0.3 + tick.value * 0.7 }] }));
  const sent = status === "sent";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={sent ? "Sent" : status === "sending" ? "Sending" : "Send"}
      accessibilityState={{ disabled, busy: status === "sending" }}
      style={({ pressed }) => [
        styles.send,
        sent ? { backgroundColor: colors.successFill } : { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135) },
        pressed && !disabled && styles.sendPressed,
      ]}
    >
      {status === "sending" ? (
        <ActivityIndicator color={colors.onBrand} />
      ) : (
        <Animated.View style={[styles.sendIcon, plane]}>
          <Icon name="send" size={21} color={colors.onBrand} />
        </Animated.View>
      )}
      <Animated.View style={[styles.sendIcon, check]} pointerEvents="none">
        <Icon name="checkmark" size={24} color={colors.onBrand} weight="bold" />
      </Animated.View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  search: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginTop: 12, marginBottom: 4, paddingHorizontal: 12, height: 40, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.input },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0 },
  list: { paddingBottom: 12, flexGrow: 1 },
  section: { fontSize: 13, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 14, marginBottom: 4, marginHorizontal: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  rowWords: { flex: 1, gap: 1 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  why: { fontSize: 13, color: colors.muted },
  ring: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  disc: { position: "absolute", top: -2, left: -2, width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 32, paddingHorizontal: 28 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.text, textAlign: "center" },
  emptyBody: { fontSize: 14, lineHeight: 19, color: colors.muted, textAlign: "center" },
  errorText: { fontSize: 14, color: colors.red, textAlign: "center" },
  ghostButton: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.brandSoft },
  ghostButtonText: { fontSize: 14, fontWeight: "700", color: colors.brand },
  footer: { paddingHorizontal: 16, paddingTop: 10 },
  hint: { fontSize: 13, color: colors.muted, textAlign: "center", paddingVertical: 8 },
  sendRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sendWords: { flex: 1, gap: 2 },
  to: { fontSize: 16, fontWeight: "700", color: colors.text },
  progress: { fontSize: 13, color: colors.muted, fontVariant: ["tabular-nums"] },
  send: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  sendPressed: { transform: [{ scale: 0.94 }], opacity: 0.9 },
  sendIcon: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
}));
