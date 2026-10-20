import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionSheetIOS, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { BUZZ_LIMITS, BUZZ_MENU_COPY, BUZZ_REPORT_REASONS, buzzErrorMessage, type Buzz, type BuzzReply, type BuzzReportReason } from "@apartment-book/shared";
import { Icon, type IconName } from "@/components/icon";
import { deleteOwn, hideAnon, hideThread, reportItem, shareBuzz, threadUrl } from "@/lib/buzz-actions";
import { alertWithHaptic, hapticSelect, hapticSuccess } from "@/lib/haptics";
import { BuzzSheet } from "./sheet";
import { P, PButton, R, T } from "./ui";

/*
 * An item's "…" menu (UniVerse's ItemMenu + OverflowMenu + ReportSheet): Hide this thread · Hide this anon in this thread
 * (replies) · Share · Report · Delete (your own). Never Block, never a profile, never a handle: blocking would let you
 * test who wrote what. On iOS it is the system's action sheet in its dark look; on Android a Buzz sheet. The report sheet
 * lists BUZZ_REPORT_REASONS, needs a note for "Something else", sends `reportBuzzItem` and then the item leaves your
 * lists. Each Buzz screen renders one BuzzActionsHost; its rows open menus through useBuzzItemMenu().
 */

type Item = Buzz | BuzzReply;

/** What the screen does once an item is gone for you: a thread screen goes back when its own root is hidden or deleted. */
export type MenuCallbacks = { onHidden?: () => void; onDeleted?: () => void };

type MenuOption = { label: string; icon: IconName | "mci:account-off-outline"; destructive?: boolean; onPress: () => void };

const Ctx = createContext<(item: Item, callbacks?: MenuCallbacks) => void>(() => {});

/** Opens an item's menu (inside a BuzzActionsHost). */
export function useBuzzItemMenu() {
  return useContext(Ctx);
}

const WEB_CLIPBOARD = Platform.OS === "web" ? (globalThis as { navigator?: { clipboard?: { writeText: (t: string) => Promise<void> } } }).navigator?.clipboard : undefined;

export function BuzzActionsHost({ children }: { children: ReactNode }) {
  const [report, setReport] = useState<{ item: Item; callbacks?: MenuCallbacks } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [menu, setMenu] = useState<MenuOption[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);

  const open = useCallback((item: Item, callbacks?: MenuCallbacks) => {
    const isRoot = item.kind === "buzz";
    const options: MenuOption[] = [];
    if (!item.isMine) {
      options.push({ label: BUZZ_MENU_COPY.hideThread, icon: "eye-off-outline", onPress: () => void hideThread(item.threadId).then((ok) => ok && callbacks?.onHidden?.()) });
    }
    if (!isRoot && !item.isMine) {
      options.push({ label: BUZZ_MENU_COPY.hideAnon, icon: "mci:account-off-outline", onPress: () => void hideAnon(item) });
    }
    if (isRoot && item.status === "active") {
      options.push({ label: BUZZ_MENU_COPY.share, icon: "share-outline", onPress: () => shareBuzz(item) });
      if (WEB_CLIPBOARD) options.push({ label: BUZZ_MENU_COPY.copyLink, icon: "link-outline", onPress: () => void WEB_CLIPBOARD.writeText(threadUrl(item.threadId)).catch(() => {}) });
    }
    if (!item.isMine && item.status !== "deleted") {
      options.push({
        label: BUZZ_MENU_COPY.report,
        icon: "flag-outline",
        onPress: () => {
          setReport({ item, callbacks });
          setReportOpen(true);
        },
      });
    }
    if (item.isMine && item.status !== "deleted") {
      options.push({
        label: BUZZ_MENU_COPY.delete,
        icon: "trash-outline",
        destructive: true,
        onPress: () =>
          alertWithHaptic(
            "warning",
            isRoot ? "Delete this buzz?" : "Delete this reply?",
            isRoot ? "It leaves Buzz for everyone. Replies under it stay hidden with it. This can't be undone." : "It shows as [deleted] where it has replies under it. This can't be undone.",
            [
              { text: "Cancel", style: "cancel" },
              { text: BUZZ_MENU_COPY.delete, style: "destructive", onPress: () => void deleteOwn(item).then((ok) => ok && callbacks?.onDeleted?.()) },
            ],
            { userInterfaceStyle: "dark" },
          ),
      });
    }
    if (options.length === 0) return;
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...options.map((o) => o.label), "Cancel"],
          cancelButtonIndex: options.length,
          destructiveButtonIndex: options.map((o, i) => (o.destructive ? i : -1)).filter((i) => i >= 0),
          userInterfaceStyle: "dark",
        },
        (i) => options[i]?.onPress(),
      );
      return;
    }
    setMenu(options);
    setMenuOpen(true);
  }, []);

  return (
    <Ctx.Provider value={open}>
      {children}
      {menu ? (
        <BuzzSheet
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          onDismiss={() => {
            setMenu(null);
            // An option that opens a sheet of its own (Report) waits until this one is gone.
            const act = pendingAction.current;
            pendingAction.current = null;
            act?.();
          }}
          closeLabel="Close menu"
        >
          <View style={styles.group}>
            {menu.map((o, i) => (
              <Pressable
                key={o.label}
                onPress={() => {
                  pendingAction.current = o.onPress;
                  setMenuOpen(false);
                }}
                accessibilityRole="menuitem"
                style={({ pressed }) => [styles.menuRow, i > 0 && styles.divider, pressed && { backgroundColor: P.surface4 }]}
              >
                {o.icon === "mci:account-off-outline" ? <MaterialCommunityIcons name="account-off-outline" size={21} color={P.ink2} /> : <Icon name={o.icon} size={21} color={o.destructive ? P.danger : P.ink2} />}
                <Text style={[T.body, { color: o.destructive ? P.danger : P.ink }]}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
          <PButton title="Cancel" variant="secondary" size="lg" fullWidth onPress={() => setMenuOpen(false)} style={{ marginTop: 12 }} />
        </BuzzSheet>
      ) : null}
      {report ? (
        <ReportSheet
          visible={reportOpen}
          item={report.item}
          onClose={() => setReportOpen(false)}
          onDismiss={(sent) => {
            const cb = report.callbacks;
            setReport(null);
            if (sent) cb?.onHidden?.();
          }}
        />
      ) : null}
    </Ctx.Provider>
  );
}

/** At least this much of a note for "Something else" (UniVerse's MIN_OTHER_NOTE). */
const MIN_OTHER_NOTE = 10;

/** Reason → optional note (required for "Something else") → "Report sent". Reports are anonymous; no Block on Buzz. */
function ReportSheet({ visible, item, onClose, onDismiss }: { visible: boolean; item: Item; onClose: () => void; onDismiss: (sent: boolean) => void }) {
  const [reason, setReason] = useState<BuzzReportReason | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const def = useMemo(() => BUZZ_REPORT_REASONS.find((r) => r.id === reason) ?? null, [reason]);
  const needsNote = def?.noteRequired === true;
  const noteTooShort = needsNote && note.trim().length < MIN_OTHER_NOTE;
  const canSend = reason !== null && !noteTooShort && !sending;

  const send = async () => {
    if (!reason || !canSend) return;
    setSending(true);
    setError(null);
    try {
      await reportItem(item, reason, note.trim() ? note.trim().slice(0, BUZZ_LIMITS.reportNote) : null);
      hapticSuccess();
      setDone(true);
    } catch (e) {
      setError(buzzErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <BuzzSheet visible={visible} onClose={onClose} onDismiss={() => onDismiss(true)} title="Report sent" closeLabel="Done">
        <View style={styles.sent}>
          <View style={styles.sentIcon}>
            <Icon name="shield-checkmark-outline" size={28} color={P.success} />
          </View>
          <Text style={[T.body, styles.center, { color: P.ink2 }]}>Thanks. Our safety team will take a look. You won't see this again.</Text>
          <PButton title="Done" size="lg" fullWidth onPress={onClose} />
        </View>
      </BuzzSheet>
    );
  }

  return (
    <BuzzSheet
      visible={visible}
      onClose={onClose}
      onDismiss={() => onDismiss(false)}
      title="Report"
      description="What's wrong with this? Reports are anonymous."
      keyboard
      footer={
        <View style={{ gap: 8 }}>
          {error ? <Text style={[T.footnote, { color: P.danger }]}>{error}</Text> : null}
          <PButton title="Send report" icon="flag-outline" size="lg" fullWidth disabled={!canSend} loading={sending} onPress={() => void send()} />
        </View>
      }
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
        <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel="Reason">
          {BUZZ_REPORT_REASONS.map((r, i) => {
            const on = reason === r.id;
            return (
              <Pressable
                key={r.id}
                onPress={() => {
                  hapticSelect();
                  setReason(r.id);
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={r.label}
                style={({ pressed }) => [styles.reason, i > 0 && styles.divider, on && { backgroundColor: P.accentSoft }, pressed && !on && { backgroundColor: P.surface4 }]}
              >
                <View style={[styles.radio, on && styles.radioOn]}>{on ? <Icon name="checkmark" size={12} weight="bold" color={P.onAccent} /> : null}</View>
                <Text style={[T.body, styles.flex, { color: on ? P.ink : P.ink2 }]}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {reason ? (
          <View style={styles.noteBox}>
            <Text style={[T.labelSm, { color: P.ink2 }]}>{needsNote ? "Tell us more" : "Anything else? (optional)"}</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={needsNote ? "What happened? At least 10 characters." : "Add context for the safety team"}
              placeholderTextColor={P.ink4}
              keyboardAppearance="dark"
              multiline
              maxLength={BUZZ_LIMITS.reportNote}
              style={[T.body, styles.note]}
              accessibilityLabel={needsNote ? "Tell us more" : "Anything else"}
            />
            {needsNote && note.length > 0 && noteTooShort ? <Text style={[T.caption, { color: P.warning }]}>A few more words help us act on this.</Text> : null}
          </View>
        ) : null}
      </ScrollView>
    </BuzzSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: "center" },
  group: { overflow: "hidden", borderRadius: R.lg, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: P.line, backgroundColor: P.surface3 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.lineSubtle },
  menuRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 18 },
  reason: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: P.lineStrong, alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: P.accent, backgroundColor: P.accent },
  noteBox: { gap: 6, paddingTop: 14 },
  note: { minHeight: 76, maxHeight: 140, color: P.ink, backgroundColor: P.surface3, borderRadius: R.md, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: P.line, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, textAlignVertical: "top" },
  sent: { alignItems: "center", gap: 14, paddingTop: 6 },
  sentIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: P.successSoft, alignItems: "center", justifyContent: "center" },
});
