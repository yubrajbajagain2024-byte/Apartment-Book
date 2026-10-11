import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Keyboard, LayoutAnimation, Platform, Pressable, StyleSheet, Text, TextInput, View, type KeyboardEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MESSAGE_ATTACHMENT_LIMITS } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { hapticTap } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { ATTACHMENT_LIMIT_TEXT, captureMedia, pickDocuments, pickLibraryMedia, type PendingAttachment, type PickResult } from "@/lib/message-attachments";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";
import { AttachmentStrip } from "./attachment-strip";

const SHOW_EVENT = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
const HIDE_EVENT = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

/** Animate the next layout change along with the keyboard (iPhone tells how long it takes). */
function followKeyboard(e: KeyboardEvent) {
  if (Platform.OS !== "ios" || !e.duration) return;
  LayoutAnimation.configureNext({ duration: e.duration, update: { duration: e.duration, type: LayoutAnimation.Types.keyboard } });
}

/** True while the keyboard is up (from the moment it starts to slide in on iPhone). */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());
  const current = useRef(visible);
  useEffect(() => {
    // iPhone repeats "will show" when the keyboard only changes height (suggestions bar, emoji): act on real changes only.
    const update = (next: boolean) => (e: KeyboardEvent) => {
      if (current.current === next) return;
      current.current = next;
      followKeyboard(e);
      setVisible(next);
    };
    const show = Keyboard.addListener(SHOW_EVENT, update(true));
    const hide = Keyboard.addListener(HIDE_EVENT, update(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/**
 * The bar under a chat. The home-indicator space is kept only while the keyboard is down; with the keyboard up the
 * bar sits right on top of it.
 */
function BottomBar({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  return <View style={[styles.bar, { paddingBottom: keyboard ? 8 : Math.max(insets.bottom, 8) }]}>{children}</View>;
}

/**
 * X-style message bar: attach (photo or video, camera, file) on the left, the growing "Message" field, and Send. Picked
 * files wait in a strip above the field until they are sent with the message.
 */
export function Composer({
  value,
  onChangeText,
  items,
  onAddItems,
  onRemoveItem,
  onSend,
  placeholder = "Message",
}: {
  value: string;
  onChangeText: (text: string) => void;
  items: PendingAttachment[];
  onAddItems: (items: PendingAttachment[]) => void;
  onRemoveItem: (id: string) => void;
  onSend: () => void;
  placeholder?: string;
}) {
  const { colors, isDark } = useAppTheme();
  const styles = useStyles();
  const show = useActionSheet();
  const [busy, setBusy] = useState(false);
  const remaining = MESSAGE_ATTACHMENT_LIMITS.maxItems - items.length;
  const canSend = value.trim().length > 0 || items.length > 0;

  async function add(pick: () => Promise<PickResult>) {
    setBusy(true);
    try {
      const { items: picked, problems } = await pick();
      if (picked.length > 0) onAddItems(picked);
      if (problems.length > 0) Alert.alert(picked.length > 0 ? "Some files weren't added" : "Couldn't add that", problems.join("\n"));
    } catch (e) {
      Alert.alert("Couldn't add that", errorText(e, "Please try again."));
    } finally {
      setBusy(false);
    }
  }

  function attach() {
    hapticTap();
    if (remaining <= 0) {
      Alert.alert("That's the limit", ATTACHMENT_LIMIT_TEXT);
      return;
    }
    show([
      { label: "Photo or video", icon: "images-outline", onPress: () => void add(() => pickLibraryMedia(remaining)) },
      { label: "Camera", icon: "camera-outline", onPress: () => void add(captureMedia) },
      { label: "File", icon: "document-outline", onPress: () => void add(() => pickDocuments(remaining)) },
    ]);
  }

  return (
    <BottomBar>
      {items.length > 0 ? <AttachmentStrip items={items} onRemove={onRemoveItem} /> : null}
      <View style={styles.row}>
        <Pressable onPress={attach} disabled={busy} hitSlop={6} style={styles.attach} accessibilityRole="button" accessibilityLabel="Attach a photo, video or file">
          {busy ? <ActivityIndicator color={colors.brand} /> : <Ionicons name="add-circle" size={32} color={colors.brand} />}
        </Pressable>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          keyboardAppearance={isDark ? "dark" : "light"}
          multiline
          // The web's text area starts two rows tall; phones start at one line and grow.
          numberOfLines={Platform.OS === "web" ? 1 : undefined}
          maxLength={4000}
          style={styles.input}
          accessibilityLabel="Message"
        />
        <Pressable onPress={onSend} disabled={!canSend} hitSlop={6} style={[styles.send, !canSend && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: !canSend }}>
          <Ionicons name="send" size={17} color={colors.onBrand} />
        </Pressable>
      </View>
    </BottomBar>
  );
}

/** In place of the message bar when this chat cannot take messages (someone is blocked). */
export function ComposerNotice({ title, body, action }: { title: string; body?: string; action?: { label: string; onPress: () => void } }) {
  const styles = useStyles();
  return (
    <BottomBar>
      <View style={styles.notice} accessibilityRole="summary">
        <Text style={styles.noticeTitle}>{title}</Text>
        {body ? <Text style={styles.noticeBody}>{body}</Text> : null}
        {action ? (
          <Pressable onPress={action.onPress} hitSlop={6} accessibilityRole="button" style={({ pressed }) => [styles.noticeButton, pressed && { opacity: 0.8 }]}>
            <Text style={styles.noticeButtonText}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </BottomBar>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bar },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 10, paddingTop: 8 },
  attach: { width: 36, height: 40, alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: colors.input,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    lineHeight: 20,
    color: colors.text,
    textAlignVertical: "center",
  },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  notice: { alignItems: "center", gap: 4, paddingHorizontal: 24, paddingTop: 14, paddingBottom: 6 },
  noticeTitle: { fontSize: 15, fontWeight: "700", color: colors.text, textAlign: "center" },
  noticeBody: { fontSize: 13, color: colors.muted, textAlign: "center" },
  noticeButton: { marginTop: 8, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.input },
  noticeButtonText: { fontSize: 14, fontWeight: "700", color: colors.brand },
}));
