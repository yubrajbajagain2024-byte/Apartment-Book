import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type GestureResponderHandlers,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listFriends, sendSharedPost, type FeedMedia, type ProfileSummary, type SharedPost } from "@apartment-book/shared";
import { hapticSuccess, hapticTap } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { radius } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";
import { Avatar } from "./avatar";

/** Besides the snapshot, the sheet needs the website link for "Share to…" and, optionally, the words that go before it. */
export type ShareOptions = { url: string; label?: string };
type ShareRequest = { shared: SharedPost; options: ShareOptions; seq: number };
type ShareSheetApi = {
  /** Opens the sheet over whatever is on screen. Selection, note and search start empty every time. */
  open: (shared: SharedPost, options: ShareOptions) => void;
  close: () => void;
};

const Ctx = createContext<ShareSheetApi>({ open: () => {}, close: () => {} });

/** The first picture a card shows, or the still of its first video: what a shared listing looks like in the chat. */
export function firstImageOf(media: FeedMedia[]): string | null {
  for (const m of media) {
    if (m.type === "photo") return m.url;
    if (m.type === "video" && m.poster) return m.poster;
  }
  return null;
}

/**
 * Instagram's share sheet, mounted once in the root layout: `useShareSheet().open(sharedPost, { url })` from any Share
 * button. Friends (people you follow who follow you back) show as a grid; pick some, add a note, Send, and each one gets a
 * direct message carrying the post as a card. "Share to…" at the bottom is the system share sheet, as before.
 */
export function ShareSheetProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ShareRequest | null>(null);
  const seq = useRef(0);
  const open = useCallback((shared: SharedPost, options: ShareOptions) => setRequest({ shared, options, seq: ++seq.current }), []);
  /** Given an opening's seq, closes the sheet only while that opening is still the one showing: a late close never shuts the next. */
  const close = useCallback((only?: number) => setRequest((r) => (only === undefined || r?.seq === only ? null : r)), []);
  const value = useMemo<ShareSheetApi>(() => ({ open, close: () => close() }), [open, close]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <ShareSheet request={request} onClose={close} />
    </Ctx.Provider>
  );
}

export function useShareSheet(): ShareSheetApi {
  return useContext(Ctx);
}

function ShareSheet({ request, onClose }: { request: ShareRequest | null; onClose: (seq?: number) => void }) {
  const styles = useStyles();
  const drag = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  // Keep showing the last request while the sheet slides away, so it does not go blank mid-animation.
  const [shown, setShown] = useState<ShareRequest | null>(request);
  const open = request !== null;
  /** Something to do once the sheet is gone: iOS will not present a new screen while this modal is still dismissing. */
  const afterDismiss = useRef<(() => void) | null>(null);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (request) setShown(request);
  }, [request]);
  useEffect(() => {
    if (open) drag.setValue(0);
  }, [open, drag]);
  useEffect(() => () => void (fallback.current && clearTimeout(fallback.current)), []);

  const runAfterDismiss = useCallback(() => {
    const fn = afterDismiss.current;
    afterDismiss.current = null;
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = null;
    fn?.();
  }, []);

  /** Close, then navigate: straight away on Android, after the dismissal on iOS (onDismiss, or a timer if it never fires). */
  const closeThen = useCallback(
    (fn: () => void) => {
      onClose();
      if (Platform.OS !== "ios") return fn();
      afterDismiss.current = fn;
      fallback.current = setTimeout(runAfterDismiss, 600);
    },
    [onClose, runAfterDismiss],
  );

  // Pull the handle down to close, like every other sheet on the phone.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > 90 || g.vy > 1.2) closeRef.current();
          else Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        },
        onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start(),
      }),
    [drag],
  );

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => onClose()} onDismiss={runAfterDismiss} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.root}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => onClose()} accessibilityRole="button" accessibilityLabel="Close share sheet" />
          <Animated.View style={[styles.sheet, { transform: [{ translateY: drag }] }]}>
            {shown ? <SheetBody key={shown.seq} shared={shown.shared} options={shown.options} panHandlers={pan.panHandlers} onClose={() => onClose(shown.seq)} closeThen={closeThen} /> : null}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type SendStatus = "idle" | "sending" | "sent";

/** One opening of the sheet: remounted (fresh search, selection and note) each time it opens. */
function SheetBody({ shared, options, panHandlers, onClose, closeThen }: { shared: SharedPost; options: ShareOptions; panHandlers: GestureResponderHandlers; onClose: () => void; closeThen: (fn: () => void) => void }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useSession();
  const { width } = useWindowDimensions();
  const [q, setQ] = useState("");
  const [friends, setFriends] = useState<ProfileSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Who gets it, by id. A Map so names survive a search that no longer lists them. */
  const [picked, setPicked] = useState<Map<string, ProfileSummary>>(new Map());
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<SendStatus>("idle");
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** False once this opening is gone (closed, or replaced by the next): a send that finishes later must leave it alone. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const userId = user?.id ?? null;
  // Friends load as soon as the sheet opens; typing waits 250ms for the next letter before asking again.
  useEffect(() => {
    if (!userId) return;
    let stale = false;
    const t = setTimeout(() => {
      setSearching(true);
      setError(null);
      listFriends(supabase, q)
        .then((rows) => {
          if (stale) return;
          setFriends(rows);
          setError(null);
        })
        .catch((e) => {
          if (!stale) setError(errorText(e, "Could not load your friends."));
        })
        .finally(() => {
          if (!stale) setSearching(false);
        });
    }, q ? 250 : 0);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, userId, attempt]);

  // Three tiles per row on a phone (390pt), more on a tablet.
  const columns = Math.max(3, Math.floor((width - 24) / 118));
  const busy = status !== "idle";

  function toggle(p: ProfileSummary) {
    if (busy) return;
    hapticTap();
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, p);
      return next;
    });
  }

  async function send() {
    if (!user || picked.size === 0 || busy) return;
    const recipients = [...picked.values()];
    setStatus("sending");
    try {
      const { failed } = await sendSharedPost(supabase, { senderId: user.id, recipientIds: recipients.map((p) => p.id), sharedPost: shared, note: note.trim() });
      // Closed while it was sending: no timer, alert or state for a sheet that is gone.
      if (!alive.current) return;
      if (failed.length > 0) {
        // The ones who did not get it stay picked, so Send again reaches just them.
        const missed = recipients.filter((p) => failed.includes(p.id));
        setPicked(new Map(missed.map((p) => [p.id, p])));
        setStatus("idle");
        Alert.alert(`Could not send to ${missed.map((p) => p.full_name).join(", ")}`, "Check your connection and try again.");
        return;
      }
      hapticSuccess();
      setStatus("sent");
      closeTimer.current = setTimeout(onClose, 900);
    } catch (e) {
      if (!alive.current) return;
      setStatus("idle");
      Alert.alert("Could not send", errorText(e));
    }
  }

  /** The system share sheet, as the Share buttons opened before: the link with a line of words in front of it. */
  async function shareTo() {
    const label = options.label ?? shared.title ?? (shared.caption ? shared.caption.slice(0, 80) : `${shared.author.name} on Apartment Book`);
    try {
      const result = await Share.share({ message: `${label} · ${options.url}`, url: options.url });
      if (alive.current && result.action === Share.sharedAction) onClose();
    } catch {
      // The system sheet was closed or is not available here; ours stays open.
    }
  }

  const sendLabel = status === "sending" ? "Sending…" : status === "sent" ? "Sent" : "Send";
  const names = [...picked.values()].map((p) => p.full_name);
  const toLine = names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;

  let body: ReactNode;
  if (!user) {
    body = (
      <Pressable onPress={() => closeThen(() => router.push("/(auth)/login"))} accessibilityRole="button" accessibilityLabel="Log in to share with friends" style={({ pressed }) => [styles.empty, pressed && { opacity: 0.7 }]}>
        <Ionicons name="person-circle-outline" size={44} color={colors.faint} />
        <Text style={styles.loginText}>Log in to share with friends</Text>
        <Text style={styles.emptyBody}>Posts you share land in a chat with each friend.</Text>
      </Pressable>
    );
  } else if (error && !friends) {
    body = (
      <View style={styles.empty}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={() => setAttempt((n) => n + 1)} accessibilityRole="button" accessibilityLabel="Retry" style={styles.ghostButton}>
          <Text style={styles.ghostButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  } else if (!friends) {
    body = (
      <View style={styles.empty}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  } else if (friends.length === 0 && !q.trim()) {
    body = (
      <View style={styles.empty}>
        <Ionicons name="people-outline" size={44} color={colors.faint} />
        <Text style={styles.emptyTitle}>Friends you follow back show up here.</Text>
        <Pressable onPress={() => closeThen(() => router.push("/search"))} accessibilityRole="button" accessibilityLabel="Find people" style={styles.ghostButton}>
          <Text style={styles.ghostButtonText}>Find people</Text>
        </Pressable>
      </View>
    );
  } else if (friends.length === 0) {
    body = (
      <View style={styles.empty}>
        <Text style={styles.emptyBody}>No friends match “{q.trim()}”.</Text>
      </View>
    );
  } else {
    body = (
      <View style={styles.grid}>
        {friends.map((p) => {
          const selected = picked.has(p.id);
          return (
            <Pressable
              key={p.id}
              onPress={() => toggle(p)}
              accessibilityRole="button"
              accessibilityLabel={p.full_name}
              accessibilityState={{ selected }}
              style={({ pressed }) => [styles.tile, { width: `${100 / columns}%` }, pressed && { opacity: 0.7 }]}
            >
              <View>
                <Avatar name={p.full_name} url={p.avatar_url} size={64} userId={p.id} ringColor={colors.elevated} />
                {selected ? (
                  <View style={styles.check}>
                    <Ionicons name="checkmark" size={14} color={colors.onBrand} />
                  </View>
                ) : null}
              </View>
              <Text style={[styles.tileName, selected && { color: colors.brand }]} numberOfLines={2}>
                {p.full_name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <>
      <View {...panHandlers} style={styles.header}>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">
          Share
        </Text>
        <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={20} color={colors.text} />
        </Pressable>
      </View>
      {user ? (
        <View style={styles.search}>
          <Ionicons name="search-outline" size={18} color={colors.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search friends"
            placeholderTextColor={colors.faint}
            keyboardAppearance={isDark ? "dark" : "light"}
            accessibilityLabel="Search friends"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            editable={!busy}
            style={styles.searchInput}
          />
          {searching && friends ? <ActivityIndicator size="small" color={colors.muted} /> : null}
        </View>
      ) : null}
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list}>
        {/* A search that failed once a list was showing: that list stays, with the error and Retry above it. */}
        {user && error && friends ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{error}</Text>
            <Pressable onPress={() => setAttempt((n) => n + 1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Retry" style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
              <Text style={styles.bannerRetry}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {body}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {user && picked.size > 0 ? (
          <View style={styles.composer}>
            <Text style={styles.to} numberOfLines={1}>
              To {toLine}
            </Text>
            <View style={styles.composerRow}>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Write a message…"
                placeholderTextColor={colors.faint}
                keyboardAppearance={isDark ? "dark" : "light"}
                accessibilityLabel="Write a message"
                maxLength={500}
                multiline
                editable={!busy}
                style={styles.note}
              />
              <Pressable
                onPress={() => void send()}
                disabled={busy || picked.size === 0}
                accessibilityRole="button"
                accessibilityLabel={sendLabel}
                accessibilityState={{ disabled: busy || picked.size === 0 }}
                style={({ pressed }) => [styles.send, status === "sent" && { backgroundColor: colors.successFill }, pressed && !busy && { opacity: 0.85 }]}
              >
                {status === "sending" ? <ActivityIndicator size="small" color={colors.onBrand} /> : status === "sent" ? <Ionicons name="checkmark" size={16} color={colors.onBrand} /> : null}
                <Text style={styles.sendText}>{sendLabel}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        <Pressable onPress={() => void shareTo()} disabled={busy} accessibilityRole="button" accessibilityLabel="Share to…" style={({ pressed }) => [styles.secondary, pressed && { backgroundColor: colors.input }]}>
          <View style={styles.secondaryIcon}>
            <Ionicons name="share-outline" size={20} color={colors.text} />
          </View>
          <Text style={styles.secondaryText}>Share to…</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.faint} />
        </Pressable>
      </View>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.backdrop },
  sheet: { height: "72%", backgroundColor: colors.elevated, borderTopLeftRadius: radius.lg + 4, borderTopRightRadius: radius.lg + 4, overflow: "hidden" },
  header: { alignItems: "center", paddingTop: 8, paddingBottom: 10, paddingHorizontal: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 10 },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  close: { position: "absolute", right: 12, top: 16, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginTop: 12, paddingHorizontal: 12, height: 40, borderRadius: radius.md, backgroundColor: colors.input },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0 },
  list: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, flexGrow: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  tile: { alignItems: "center", paddingVertical: 8, paddingHorizontal: 4, gap: 6 },
  // The ring is the sheet's own colour, cutting the tick out of the photo.
  check: { position: "absolute", right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, borderWidth: 2, borderColor: colors.elevated, alignItems: "center", justifyContent: "center" },
  tileName: { fontSize: 12, lineHeight: 15, color: colors.text, textAlign: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 32, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.text, textAlign: "center" },
  emptyBody: { fontSize: 14, color: colors.muted, textAlign: "center" },
  loginText: { fontSize: 16, fontWeight: "700", color: colors.brand, textAlign: "center" },
  errorText: { fontSize: 14, color: colors.red, textAlign: "center" },
  // The look of ErrorBanner in components/ui.
  banner: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  bannerText: { flex: 1, fontSize: 14, color: colors.dangerText },
  bannerRetry: { fontSize: 14, fontWeight: "700", color: colors.dangerText },
  ghostButton: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.brandSoft },
  ghostButtonText: { fontSize: 14, fontWeight: "700", color: colors.brand },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: 12, paddingTop: 8, backgroundColor: colors.elevated },
  composer: { gap: 6, paddingBottom: 8 },
  to: { fontSize: 12, color: colors.muted, marginLeft: 2 },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  note: { flex: 1, minHeight: 40, maxHeight: 96, backgroundColor: colors.input, borderRadius: 20, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, fontSize: 15, color: colors.text },
  send: { minWidth: 84, height: 40, borderRadius: 20, paddingHorizontal: 16, backgroundColor: colors.brand, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  sendText: { color: colors.onBrand, fontSize: 15, fontWeight: "700" },
  secondary: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderRadius: radius.md },
  secondaryIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  secondaryText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.text },
}));
