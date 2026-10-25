import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ActivityIndicator, Alert, Keyboard, LayoutAnimation, Platform, Pressable, StyleSheet, Text, TextInput, View, type KeyboardEvent, type LayoutChangeEvent, type TextInputInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MESSAGE_ATTACHMENT_LIMITS, type MessageReply } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { GlassBackdrop, GlassIconButton } from "@/components/glass";
import { Icon } from "@/components/icon";
import { ProgressiveBlur } from "@/components/progressive-blur";
import { hapticTap, alertWithHaptic } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { ATTACHMENT_LIMIT_TEXT, captureMedia, pickDocuments, pickLibraryMedia, type PendingAttachment, type PickResult } from "@/lib/message-attachments";
import { auroraGradient } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";
import { AttachmentStrip } from "./attachment-strip";
import { ReplyQuote, type ReplyContext } from "./reply-quote";
import { VOICE_AVAILABLE } from "@/lib/voice";

// expo-audio is loaded only where this build has it.
const VoiceRecorder = VOICE_AVAILABLE ? (require("./voice-recorder") as typeof import("./voice-recorder")).VoiceRecorder : null;

const SHOW_EVENT = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
const HIDE_EVENT = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

/**
 * The bar's sizes: the "+" circle and the capsule are the system's 44pt touch target, the capsule fully rounded; the
 * microphone and Send inside it are 34pt circles, centred on its first line however tall the text grows.
 */
const BAR = 44;
const CAPSULE = BAR / 2;
const CONTROL = 34;
const CONTROL_INSET = (BAR - CONTROL) / 2;

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

/** What the person is about to answer, shown above the field until they send or dismiss it. */
export type ComposerReply = { reply: MessageReply; context: ReplyContext };

/**
 * The floating bar under a chat, with nothing solid behind it: the messages scroll under it, softened by a blur that
 * fades in towards the bottom edge. With the keyboard down it keeps the home-indicator space; with the keyboard up it
 * sits right on top of it. `onHeight` tells the chat how much of the list it covers.
 */
function FloatingBar({ onHeight, children }: { onHeight?: (height: number) => void; children: ReactNode }) {
  const styles = useStyles();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  const [height, setHeight] = useState(0);
  function measured(e: LayoutChangeEvent) {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h === height) return;
    setHeight(h);
    onHeight?.(h);
  }
  return (
    <View style={[styles.bar, { paddingBottom: keyboard ? 10 : Math.max(insets.bottom, 14) }]} onLayout={measured}>
      <ProgressiveBlur edge="bottom" height={height + 28} intensity={50} tint={isDark ? "dark" : "light"} />
      {children}
    </View>
  );
}

/** A see-through glass panel above the field: the reply being answered, or the files waiting to go. */
function GlassPanel({ children, style }: { children: ReactNode; style?: object }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  return (
    <View style={[styles.panel, { borderColor: colors.glassEdge }, style]}>
      <GlassBackdrop variant="float" radius={20} />
      {children}
    </View>
  );
}

/**
 * The message bar, laid out like the Messages app's: "+" in a glass circle on the left (photo or video, camera, file),
 * then a see-through glass capsule holding the growing field and, at its end, the microphone (a voice message records
 * in the bar, where the build can) or, once something is typed or picked, the blue Send. Picked files wait on a glass
 * panel above the capsule until they are sent with the message; a message being answered shows there too, with its
 * quote and an ✕. The bar floats over the chat and rises with the keyboard.
 */
export function Composer({
  value,
  onChangeText,
  items,
  onAddItems,
  onRemoveItem,
  onSend,
  onSendVoice,
  reply,
  onCancelReply,
  inputRef,
  onHeight,
  placeholder = "Message",
}: {
  value: string;
  onChangeText: (text: string) => void;
  items: PendingAttachment[];
  onAddItems: (items: PendingAttachment[]) => void;
  onRemoveItem: (id: string) => void;
  onSend: () => void;
  /** A voice message just recorded: sent at once. Without it there is no microphone. */
  onSendVoice?: (item: PendingAttachment) => void;
  reply?: ComposerReply | null;
  onCancelReply?: () => void;
  /** The field, so the chat can bring the keyboard up (a swipe to reply). */
  inputRef?: RefObject<TextInputInstance | null>;
  onHeight?: (height: number) => void;
  placeholder?: string;
}) {
  const { colors, isDark } = useAppTheme();
  const styles = useStyles();
  const show = useActionSheet();
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const remaining = MESSAGE_ATTACHMENT_LIMITS.maxItems - items.length;
  const canSend = value.trim().length > 0 || items.length > 0;
  const canRecord = Boolean(VoiceRecorder && onSendVoice) && !canSend;

  async function add(pick: () => Promise<PickResult>) {
    setBusy(true);
    try {
      const { items: picked, problems } = await pick();
      if (picked.length > 0) onAddItems(picked);
      if (problems.length > 0) Alert.alert(picked.length > 0 ? "Some files weren't added" : "Couldn't add that", problems.join("\n"));
    } catch (e) {
      alertWithHaptic("error", "Couldn't add that", errorText(e, "Please try again."));
    } finally {
      setBusy(false);
    }
  }

  function attach() {
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

  const panels = (
    <>
      {reply ? (
        <GlassPanel>
          <View style={styles.replyRow}>
            <ReplyQuote reply={reply.reply} context={reply.context} tone="composer" />
            <Pressable onPress={onCancelReply} hitSlop={10} accessibilityRole="button" accessibilityLabel="Stop replying" style={({ pressed }) => [styles.replyClose, pressed && { opacity: 0.6 }]}>
              <Icon name="close" size={15} color={colors.muted} weight="semibold" />
            </Pressable>
          </View>
        </GlassPanel>
      ) : null}
      {items.length > 0 ? (
        <GlassPanel style={styles.stripPanel}>
          <AttachmentStrip items={items} onRemove={onRemoveItem} />
        </GlassPanel>
      ) : null}
    </>
  );

  if (recording && VoiceRecorder && onSendVoice) {
    return (
      <FloatingBar onHeight={onHeight}>
        {panels}
        <VoiceRecorder
          onCancel={() => setRecording(false)}
          onSend={(item) => {
            setRecording(false);
            onSendVoice(item);
          }}
        />
      </FloatingBar>
    );
  }

  return (
    <FloatingBar onHeight={onHeight}>
      {panels}
      <View style={styles.row}>
        <GlassIconButton icon="add" label="Attach a photo, video or file" variant="float" size={BAR} iconSize={24} weight="medium" disabled={busy} onPress={attach}>
          {busy ? <ActivityIndicator color={colors.text} /> : undefined}
        </GlassIconButton>
        <View style={[styles.capsule, { borderColor: colors.glassEdge }]}>
          <GlassBackdrop variant="float" radius={CAPSULE} />
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            keyboardAppearance={isDark ? "dark" : "light"}
            multiline
            // The web's text area starts two rows tall; phones start at one line and grow.
            numberOfLines={Platform.OS === "web" ? 1 : undefined}
            maxLength={4000}
            style={styles.input}
            accessibilityLabel="Message"
          />
          {canRecord ? (
            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                hapticTap();
                setRecording(true);
              }}
              hitSlop={8}
              style={({ pressed }) => [styles.control, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="Record a voice message"
            >
              <Icon name="mic" size={22} color={colors.muted} weight="medium" />
            </Pressable>
          ) : (
            <Pressable
              onPress={onSend}
              disabled={!canSend}
              hitSlop={8}
              style={({ pressed }) => [styles.control, styles.send, { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135) }, !canSend && { opacity: 0.35 }, pressed && { transform: [{ scale: 0.92 }] }]}
              accessibilityRole="button"
              accessibilityLabel="Send"
              accessibilityState={{ disabled: !canSend }}
            >
              <Icon name="arrow-up" size={19} color={colors.onBrand} weight="bold" />
            </Pressable>
          )}
        </View>
      </View>
    </FloatingBar>
  );
}

/** In place of the message bar when this chat cannot take messages (someone is blocked). */
export function ComposerNotice({ title, body, action, onHeight }: { title: string; body?: string; action?: { label: string; onPress: () => void }; onHeight?: (height: number) => void }) {
  const styles = useStyles();
  return (
    <FloatingBar onHeight={onHeight}>
      <GlassPanel>
        <View style={styles.notice} accessibilityRole="summary">
          <Text style={styles.noticeTitle}>{title}</Text>
          {body ? <Text style={styles.noticeBody}>{body}</Text> : null}
          {action ? (
            <Pressable onPress={action.onPress} hitSlop={6} accessibilityRole="button" style={({ pressed }) => [styles.noticeButton, pressed && { opacity: 0.8 }]}>
              <Text style={styles.noticeButtonText}>{action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      </GlassPanel>
    </FloatingBar>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: { paddingHorizontal: 12, paddingTop: 8, gap: 10 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  panel: { borderRadius: 20, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  stripPanel: { paddingBottom: 8 },
  replyRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingLeft: 2, paddingRight: 6 },
  replyClose: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  capsule: { flex: 1, flexDirection: "row", alignItems: "flex-end", minHeight: BAR, borderRadius: CAPSULE, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  // One line of 17pt text sits centred in the 44pt capsule (11 + 22 + 11); it grows to about six lines, then scrolls.
  input: {
    flex: 1,
    minHeight: BAR,
    maxHeight: 154,
    paddingLeft: 17,
    paddingRight: 6,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 17,
    lineHeight: 22,
    color: colors.text,
    textAlignVertical: "center",
  },
  control: { width: CONTROL, height: CONTROL, borderRadius: CONTROL / 2, marginRight: CONTROL_INSET, marginBottom: CONTROL_INSET, alignItems: "center", justifyContent: "center" },
  send: {},
  notice: { alignItems: "center", gap: 4, paddingHorizontal: 24, paddingTop: 14, paddingBottom: 14 },
  noticeTitle: { fontSize: 15, fontWeight: "700", color: colors.text, textAlign: "center" },
  noticeBody: { fontSize: 13, color: colors.muted, textAlign: "center" },
  noticeButton: { marginTop: 8, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.input },
  noticeButtonText: { fontSize: 14, fontWeight: "700", color: colors.brand },
}));
