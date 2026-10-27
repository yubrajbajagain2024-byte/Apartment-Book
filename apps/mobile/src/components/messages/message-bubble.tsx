import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type ViewInstance } from "react-native";
import Reanimated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import {
  callOf,
  extractLinks,
  formatTimeOfDay,
  formatDayLabel,
  formatMessageTime,
  replyOf,
  sharedPostLabel,
  sharedPostOf,
  snapOf,
  type MessageAttachment,
  type MessageCall,
  type MessageReply,
  type ProfileSummary,
  type SharedPost,
} from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { CallRow } from "@/components/calls/call-row";
import { useReduceMotion } from "@/lib/accessibility";
import { openChatLink, sharedPostHref, type ChatMessage, type OutgoingFiles, type UploadStatus } from "@/lib/message-attachments";
import { entryForPost, measureOrigin, openViewer } from "@/lib/reel-viewer";
import { radius } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { AttachmentFileRow } from "./attachment-file-row";
import { AttachmentGrid, type GridMedia } from "./attachment-grid";
import { ReplyQuote, type ReplyContext } from "./reply-quote";
import { SwipeToReply } from "./swipe-to-reply";
import { SnapBubble } from "@/components/snap/snap-bubble";
import { VOICE_AVAILABLE } from "@/lib/voice";

// expo-audio is loaded only where this build has it (an older installed build shows voice messages as files).
const VoiceBubble = VOICE_AVAILABLE ? (require("./voice-bubble") as typeof import("./voice-bubble")).VoiceBubble : null;

/**
 * A sent photo or video as something drawable: a signed URL with the storage path as its cache key, or null while
 * signing; `missing` once signing came back without a link (the file was deleted, e.g. with its sender's account).
 */
export type MediaResolver = (attachment: MessageAttachment) => { uri: string | null; cacheKey?: string; missing?: boolean };

/** The text the website stores with a photo sent without words; the photo says it already. */
const WEBSITE_PHOTO_TEXT = "📷 Photo";

/**
 * A message's photos and videos in order: a photo sent from the website (image_url) first, then the attachments. A
 * message sent from this device keeps showing the files picked here (no download, no flicker once it is sent).
 */
export function messageMedia(m: ChatMessage, resolve: MediaResolver): GridMedia[] {
  const media: GridMedia[] = [];
  if (m.image_url && /^https:\/\//i.test(m.image_url)) media.push({ key: `photo:${m.id}`, kind: "image", uri: m.image_url });
  const outgoing = m.outgoing;
  if (outgoing) {
    for (const item of outgoing.items) {
      if (item.kind !== "image" && item.kind !== "video") continue;
      media.push({ key: item.id, kind: item.kind, uri: item.uri, width: item.width, height: item.height, duration: item.duration, status: m.pending || m.failed ? (outgoing.status[item.id] ?? "waiting") : undefined });
    }
    return media;
  }
  for (const a of m.attachments ?? []) {
    if (a.kind !== "image" && a.kind !== "video") continue;
    const shown = resolve(a);
    media.push({ key: a.path, kind: a.kind, uri: shown.uri, cacheKey: shown.cacheKey, width: a.width, height: a.height, duration: a.duration, missing: shown.missing });
  }
  return media;
}

type FileEntry = { key: string; attachment: MessageAttachment; status?: UploadStatus };

type VoiceEntry = { key: string; uri: string | null; duration: number | null | undefined; attachment: MessageAttachment | null };

/** A message's voice messages: the recording on this device while it sends, then the sent file through its signed link. */
function messageVoices(m: ChatMessage, resolve: MediaResolver): VoiceEntry[] {
  const outgoing = m.outgoing;
  if (outgoing) {
    return outgoing.items.filter((item) => item.kind === "audio").map((item) => ({ key: item.id, uri: item.uri, duration: item.duration, attachment: outgoing.uploaded[item.id] ?? null }));
  }
  return (m.attachments ?? []).filter((a) => a.kind === "audio").map((a) => ({ key: a.path, uri: resolve(a).uri, duration: a.duration, attachment: a }));
}

/** A message's other files (PDFs, documents, …), with their upload state while sending. */
function messageFiles(m: ChatMessage): FileEntry[] {
  const outgoing = m.outgoing;
  if (outgoing) {
    return outgoing.items
      .filter((item) => item.kind === "file")
      .map((item) => ({
        key: item.id,
        attachment: outgoing.uploaded[item.id] ?? { kind: "file", path: "", name: item.name, size: item.size, mime: item.mime },
        status: m.pending || m.failed ? (outgoing.status[item.id] ?? "waiting") : undefined,
      }));
  }
  return (m.attachments ?? []).filter((a) => a.kind === "file").map((a) => ({ key: a.path, attachment: a }));
}

/** "Uploading 2 of 5…" while the files go up, then "Sending…". */
function sendingLabel(outgoing: OutgoingFiles | undefined): string {
  if (!outgoing || outgoing.items.length === 0) return "Sending…";
  const total = outgoing.items.length;
  const done = outgoing.items.filter((item) => outgoing.status[item.id] === "done").length;
  if (done >= total) return "Sending…";
  return total > 1 ? `Uploading ${done + 1} of ${total}…` : "Uploading…";
}

// An http(s) address up to the next space; extractLinks() then trims what ends a sentence, as the database does.
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"`]+/gi;

/** The text split into plain runs and links. */
function linkParts(text: string): { text: string; url?: string }[] {
  const parts: { text: string; url?: string }[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const start = match.index ?? 0;
    const url = extractLinks(match[0])[0];
    if (!url || !match[0].startsWith(url) || start < last) continue;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: url, url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** How a new message comes in: it rises from the bar and settles, on a spring that never overshoots. */
const ARRIVE = FadeInDown.springify().damping(24).stiffness(300).mass(0.8);

export type MessageRowProps = {
  message: ChatMessage;
  mine: boolean;
  isGroup: boolean;
  /** First message of its day, or the first after half an hour's quiet: the day and time label goes above it. */
  stamp: boolean;
  /** First / last of a run of messages from the same person close together: the name above the first. */
  firstInGroup: boolean;
  lastInGroup: boolean;
  /** Only on my newest message: "Sending…", "Sent" or "Delivered" under it ("Seen" shows under the last message read instead). */
  receipt: "sending" | "sent" | "delivered" | "seen" | null;
  /** The people whose reading stopped at this message: "Seen" with their small photos goes under it. */
  seenBy?: ProfileSummary[];
  /** Tapped, so its exact time shows under it until it, or another message, is tapped again. */
  revealed: boolean;
  /** Briefly lit after jumping here from search or from a reply's quote. */
  highlighted: boolean;
  /** Arrived (or was sent) while the chat was open: it rises in. */
  appear: boolean;
  mediaWidth: number;
  resolveMedia: MediaResolver;
  /** Who wrote the message a quote points at, and its picture when it is on screen. */
  resolveReply: (reply: MessageReply) => ReplyContext;
  onOpenMedia: (message: ChatMessage, index: number) => void;
  onOpenFile: (attachment: MessageAttachment) => void;
  /** A Snap from someone else, tapped while it is new: its one view. */
  onOpenSnap?: (message: ChatMessage) => void;
  /** A tap on the activity line under a Snap: everything that happened to it. */
  onSnapActivity?: (message: ChatMessage) => void;
  /** A tap on a call's row: call back, or join the call if it is still going on. */
  onCall?: (call: MessageCall) => void;
  /** Long press (and a tap on a message that was not sent): retry, delete or report. */
  onActions: (message: ChatMessage) => void;
  /** A swipe to the right on the message. */
  onReply: (message: ChatMessage) => void;
  /** A tap on the words: shows (or hides) the message's exact time. */
  onReveal: (message: ChatMessage) => void;
  /** A tap on a reply's quote: show the message it answers. */
  onJumpTo: (messageId: string) => void;
  /** A tap on a sender's name in a group. */
  onPressSender: (userId: string) => void;
};

/**
 * One message in the chat, laid out like the Messages app's: a centred stamp ("Today 14:05") above the first message of
 * a day and above any message that comes after half an hour's quiet, in a group the sender's name above a run of
 * theirs, the quote of what it answers, a shared post, photos and videos, files, a Snap, a call, a voice message, and the words
 * in a blue (mine) or grey bubble. Nothing under a bubble by default, as in Instagram: a tap on the words shows the
 * message's exact time there (a hold shows it in the menu), my newest message says where it stands ("Sent",
 * "Delivered"), and "Seen" with the readers' small photos sits under the last message they read. Every time is the
 * phone's own. No photos beside the bubbles: the chat's header says who you are talking to. A swipe to the right
 * answers it.
 */
export function MessageRow({
  message: m,
  mine,
  isGroup,
  stamp,
  firstInGroup,
  receipt,
  seenBy,
  revealed,
  highlighted,
  appear,
  mediaWidth,
  resolveMedia,
  resolveReply,
  onOpenMedia,
  onOpenFile,
  onOpenSnap,
  onSnapActivity,
  onCall,
  onActions,
  onReply,
  onReveal,
  onJumpTo,
  onPressSender,
}: MessageRowProps) {
  const colors = useColors();
  const styles = useStyles();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const shared = sharedPostOf(m.shared_post);
  const snap = snapOf(m.snap);
  const call = callOf(m.call);
  const reply = replyOf(m.reply_to);
  const media = messageMedia(m, resolveMedia);
  const files = messageFiles(m);
  const voices = messageVoices(m, resolveMedia);
  const showText = Boolean(m.content) && !(m.image_url && m.content === WEBSITE_PHOTO_TEXT);
  const actions = m.pending ? undefined : () => onActions(m);
  const retry = m.failed ? () => onActions(m) : undefined;
  const sender = m.sender;
  const textColor = m.failed ? colors.dangerText : mine ? colors.onBrand : colors.text;
  const receiptLabel = receipt === "sending" ? sendingLabel(m.outgoing) : receipt === "sent" ? "Sent" : receipt === "delivered" ? "Delivered" : null;
  // Under the bubble: while sending, how far it is; tapped, its exact time; my newest message, where it stands; or nothing.
  // The time is never bold; only the receipt word ("Sent", "Delivered") is.
  const time = !m.failed && !m.pending && revealed ? formatMessageTime(m.created_at) : null;
  const status = m.failed ? null : m.pending ? sendingLabel(m.outgoing) : receiptLabel;
  const footer = time || status;
  const reveal = !m.pending && !m.failed ? () => onReveal(m) : undefined;

  return (
    <Reanimated.View entering={appear && !reduceMotion ? ARRIVE : undefined}>
      {stamp ? (
        <Text style={styles.day} accessibilityRole="header">
          {formatDayLabel(m.created_at)} {formatTimeOfDay(m.created_at)}
        </Text>
      ) : null}
      <Highlight active={highlighted}>
        <View style={[styles.line, mine && styles.lineMine, firstInGroup && !stamp && styles.groupStart]}>
          <SwipeToReply enabled={!m.pending && !m.failed} onReply={() => onReply(m)} style={[styles.stack, mine ? styles.stackMine : styles.stackTheirs]}>
            {!mine && isGroup && firstInGroup ? (
              <Text style={styles.sender} numberOfLines={1} onPress={sender ? () => onPressSender(sender.id) : undefined} accessibilityRole={sender ? "button" : undefined}>
                {sender?.full_name ?? "Unknown"}
              </Text>
            ) : null}
            {reply ? <ReplyQuote reply={reply} context={resolveReply(reply)} tone={mine ? "mine" : "theirs"} onPress={() => onJumpTo(reply.id)} style={styles.quote} /> : null}
            {shared ? <SharedPostBubble shared={shared} width={mediaWidth} dimmed={Boolean(m.pending)} onLongPress={actions} /> : null}
            {media.length > 0 ? <AttachmentGrid media={media} width={mediaWidth} onOpen={(i) => onOpenMedia(m, i)} onLongPress={actions} /> : null}
            {files.map((f) => (
              <AttachmentFileRow
                key={f.key}
                attachment={f.attachment}
                status={f.status}
                onPress={f.attachment.path ? () => onOpenFile(f.attachment) : retry}
                onLongPress={actions}
                style={{ width: mediaWidth }}
              />
            ))}
            {call ? <CallRow call={call} mine={mine} width={mediaWidth} onPress={onCall ? () => onCall(call) : undefined} onLongPress={actions} /> : null}
            {snap ? <SnapBubble snap={snap} mine={mine} width={mediaWidth} dimmed={Boolean(m.pending)} onOpen={onOpenSnap ? () => onOpenSnap(m) : undefined} onActivity={onSnapActivity ? () => onSnapActivity(m) : undefined} onLongPress={actions} /> : null}
            {voices.map((v) =>
              VoiceBubble ? (
                <VoiceBubble key={v.key} uri={v.uri} cacheKey={v.key} duration={v.duration} mine={mine} dimmed={Boolean(m.pending)} onLongPress={actions} />
              ) : v.attachment ? (
                <AttachmentFileRow key={v.key} attachment={v.attachment} onPress={() => onOpenFile(v.attachment as MessageAttachment)} onLongPress={actions} style={{ width: mediaWidth }} />
              ) : null,
            )}
            {showText ? (
              <Pressable onPress={retry ?? reveal} onLongPress={actions} delayLongPress={350} accessibilityHint={m.failed ? "Not sent. Tap for options." : reveal ? "Shows when it was sent" : undefined}>
                <View style={[styles.bubble, mine ? styles.mine : styles.theirs, m.pending && styles.dim, m.failed && styles.failed]}>
                  <Text style={[styles.text, { color: textColor }]} selectable={false}>
                    {linkParts(m.content).map((part, i) =>
                      part.url ? (
                        <Text key={i} style={[styles.link, { color: mine && !m.failed ? colors.onBrand : colors.brand }]} onPress={() => openChatLink(part.url as string, router, colors.brand)} accessibilityRole="link">
                          {part.text}
                        </Text>
                      ) : (
                        part.text
                      ),
                    )}
                  </Text>
                </View>
              </Pressable>
            ) : null}
            {m.failed ? (
              <Text style={[styles.footer, styles.failedFooter]} onPress={retry} accessibilityRole="button">
                Not sent · Tap to retry
              </Text>
            ) : footer ? (
              <Reanimated.View entering={revealed && !reduceMotion ? FadeIn.duration(160) : undefined}>
                <Text style={styles.footer} accessibilityLabel={[time, status].filter(Boolean).join(", ")}>
                  {time}
                  {time && status ? " · " : null}
                  {status ? <Text style={!m.pending ? styles.receipt : undefined}>{status}</Text> : null}
                </Text>
              </Reanimated.View>
            ) : null}
          </SwipeToReply>
        </View>
      </Highlight>
      {seenBy && seenBy.length > 0 ? (
        <View style={styles.seen} accessibilityLabel={`Seen by ${seenBy.map((p) => p.full_name).join(", ")}`}>
          <Text style={styles.seenText}>Seen</Text>
          {seenBy.map((p) => (
            <Avatar key={p.id} name={p.full_name} url={p.avatar_url} size={16} online={false} />
          ))}
        </View>
      ) : null}
    </Reanimated.View>
  );
}

/** A soft wash behind a message that fades away: where a search result or a "jump to" landed. */
function Highlight({ active, children }: { active: boolean; children: ReactNode }) {
  const styles = useStyles();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    opacity.setValue(1);
    Animated.timing(opacity, { toValue: 0, duration: 1200, delay: 500, useNativeDriver: true }).start();
  }, [active, opacity]);
  return (
    <View>
      <Animated.View style={[styles.highlight, { opacity, pointerEvents: "none" }]} />
      {children}
    </View>
  );
}

/** The corner of a photo bubble (a sent photo's, a shared post's, a Snap's). */
const PHOTO_RADIUS = 18;

/**
 * A shared post, reel or listing inside a chat, as a sent photo would be: its picture fills a large rounded bubble at
 * the chat's photo width (4:5 for a post or a listing, taller for a reel), with who posted it and its words on a soft
 * shade along the bottom and nothing else (what it is, the screen reader still hears). One without a picture is a card
 * of its words. A tap opens it: a post or reel with a picture full screen in the viewer (the Reels feed follows it), a
 * words-only post its own screen, a listing its detail screen.
 */
function SharedPostBubble({ shared, width, dimmed, onLongPress }: { shared: SharedPost; width: number; dimmed: boolean; onLongPress?: () => void }) {
  const styles = useStyles();
  const router = useRouter();
  const label = sharedPostLabel(shared);
  const line = shared.title ?? shared.caption;
  /** The picture, measured when it is tapped so the viewer can zoom open from it. */
  const picture = useRef<ViewInstance>(null);
  const open = () => {
    if (shared.target_type === "post" && shared.image_url) void measureOrigin(picture.current, PHOTO_RADIUS).then((origin) => openViewer(router, { entries: [entryForPost(shared.target_id, shared.image_url)], index: 0, then: "reels", origin }));
    else router.push(sharedPostHref(shared));
  };
  if (!shared.image_url) {
    return (
      <Pressable
        onPress={open}
        onLongPress={onLongPress}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${line ?? shared.author.name}`}
        style={({ pressed }) => [styles.card, dimmed && styles.dim, pressed && { opacity: 0.8 }]}
      >
        <View style={styles.cardAuthor}>
          <Avatar name={shared.author.name} url={shared.author.avatar_url} size="xs" online={false} anonymous={!shared.author.id && shared.target_type !== "post"} />
          <Text style={styles.cardName} numberOfLines={1}>
            {shared.author.name}
          </Text>
        </View>
        {shared.title ? (
          <Text style={styles.cardTitle} numberOfLines={2}>
            {shared.title}
          </Text>
        ) : null}
        {shared.caption ? (
          <Text style={styles.cardText} numberOfLines={3}>
            {shared.caption}
          </Text>
        ) : null}
        <Text style={styles.cardFooter}>{label}</Text>
      </Pressable>
    );
  }
  const height = Math.round(width / (shared.kind === "reel" ? 0.65 : 0.8));
  return (
    <Pressable
      onPress={open}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${line ?? shared.author.name}`}
      style={({ pressed }) => [styles.photo, { width, height }, dimmed && styles.dim, pressed && { opacity: 0.85 }]}
    >
      <View ref={picture} collapsable={false} style={StyleSheet.absoluteFill}>
        <Image source={{ uri: shared.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityLabel={line ?? "Shared picture"} />
      </View>
      <View style={styles.shade} pointerEvents="none">
        <View style={styles.shadeRow}>
          <Avatar name={shared.author.name} url={shared.author.avatar_url} size={22} online={false} anonymous={!shared.author.id && shared.target_type !== "post"} />
          <Text style={styles.shadeName} numberOfLines={1}>
            {shared.author.name}
          </Text>
        </View>
        {line ? (
          <Text style={styles.shadeLine} numberOfLines={1}>
            {line}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  day: { textAlign: "center", fontSize: 11, lineHeight: 14, color: colors.faint, marginTop: 18, marginBottom: 8 },
  line: { flexDirection: "row", marginTop: 2 },
  lineMine: { flexDirection: "row-reverse" },
  groupStart: { marginTop: 12 },
  stack: { maxWidth: "76%", gap: 2 },
  stackMine: { alignItems: "flex-end" },
  stackTheirs: { alignItems: "flex-start" },
  sender: { fontSize: 12, lineHeight: 16, color: colors.muted, marginLeft: 12, marginBottom: 1 },
  quote: { marginHorizontal: 6 },
  bubble: { borderRadius: 18, borderCurve: "continuous", paddingHorizontal: 14, paddingVertical: 8 },
  mine: { backgroundColor: colors.brand },
  theirs: { backgroundColor: colors.input },
  dim: { opacity: 0.6 },
  failed: { backgroundColor: colors.dangerSoft },
  text: { fontSize: 17, lineHeight: 22 },
  link: { textDecorationLine: "underline" },
  footer: { fontSize: 11, lineHeight: 14, color: colors.faint, marginHorizontal: 6, marginTop: 2 },
  receipt: { fontWeight: "600" },
  failedFooter: { color: colors.red, fontWeight: "600" },
  seen: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3, paddingRight: 4, marginTop: 3 },
  seenText: { fontSize: 11, lineHeight: 14, fontWeight: "600", color: colors.faint, marginRight: 2 },
  highlight: { position: "absolute", top: -3, bottom: -3, left: -8, right: -8, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.brandSoft },
  // A shared post with a picture: the photo bubble, with the shade along its bottom carrying the words.
  photo: { borderRadius: PHOTO_RADIUS, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.mediaBg },
  shade: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 40, paddingBottom: 11, gap: 5, experimental_backgroundImage: `linear-gradient(to top, ${colors.mediaPill} 0%, ${colors.mediaScrim} 50%, transparent 100%)` },
  shadeRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  shadeName: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.onMedia, textShadowColor: colors.mediaTextShadow, textShadowRadius: 4 },
  shadeLine: { fontSize: 13, lineHeight: 17, color: colors.onMediaMuted, textShadowColor: colors.mediaTextShadow, textShadowRadius: 4 },
  // A shared post without a picture: a card of its words.
  card: { width: 240, maxWidth: "100%", padding: 12, gap: 4, borderRadius: PHOTO_RADIUS, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card, overflow: "hidden" },
  cardAuthor: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardName: { fontSize: 13, fontWeight: "600", color: colors.text, flexShrink: 1 },
  cardTitle: { fontSize: 15, fontWeight: "600", lineHeight: 20, color: colors.text },
  cardText: { fontSize: 15, lineHeight: 20, color: colors.text },
  cardFooter: { fontSize: 13, fontWeight: "600", color: colors.brand, marginTop: 2 },
}));
