import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  extractLinks,
  formatDayLabel,
  formatMessageTime,
  sharedPostLabel,
  sharedPostOf,
  type MessageAttachment,
  type ProfileSummary,
  type SharedPost,
} from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { openChatLink, sharedPostHref, type ChatMessage, type OutgoingFiles, type UploadStatus } from "@/lib/message-attachments";
import { radius } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { AttachmentFileRow } from "./attachment-file-row";
import { AttachmentGrid, type GridMedia } from "./attachment-grid";

/** A sent photo or video as something drawable: a signed URL with the storage path as its cache key, or null while signing. */
export type MediaResolver = (attachment: MessageAttachment) => { uri: string | null; cacheKey?: string };

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
      if (item.kind === "file") continue;
      media.push({ key: item.id, kind: item.kind, uri: item.uri, width: item.width, height: item.height, duration: item.duration, status: m.pending || m.failed ? (outgoing.status[item.id] ?? "waiting") : undefined });
    }
    return media;
  }
  for (const a of m.attachments ?? []) {
    if (a.kind === "file") continue;
    const shown = resolve(a);
    media.push({ key: a.path, kind: a.kind, uri: shown.uri, cacheKey: shown.cacheKey, width: a.width, height: a.height, duration: a.duration });
  }
  return media;
}

type FileEntry = { key: string; attachment: MessageAttachment; status?: UploadStatus };

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

export type MessageRowProps = {
  message: ChatMessage;
  mine: boolean;
  isGroup: boolean;
  /** First message of its day: the day label goes above it. */
  showDay: boolean;
  /** First / last of a run of messages from the same person close together: rounder corners, the name, the avatar and the time. */
  firstInGroup: boolean;
  lastInGroup: boolean;
  /** Only on my newest message: sending, sent or delivered (seen shows as avatars instead). */
  receipt: "sending" | "sent" | "delivered" | "seen" | null;
  seenBy?: ProfileSummary[];
  /** Briefly lit after jumping here from search. */
  highlighted: boolean;
  mediaWidth: number;
  resolveMedia: MediaResolver;
  onOpenMedia: (message: ChatMessage, index: number) => void;
  onOpenFile: (attachment: MessageAttachment) => void;
  /** Long press (and a tap on a message that was not sent): retry, delete or report. */
  onActions: (message: ChatMessage) => void;
  onPressAvatar: (userId: string) => void;
};

/** One message in the chat: day label, avatar, shared post, photos and videos, files, words, time and receipts. */
export function MessageRow({
  message: m,
  mine,
  isGroup,
  showDay,
  firstInGroup,
  lastInGroup,
  receipt,
  seenBy,
  highlighted,
  mediaWidth,
  resolveMedia,
  onOpenMedia,
  onOpenFile,
  onActions,
  onPressAvatar,
}: MessageRowProps) {
  const colors = useColors();
  const styles = useStyles();
  const router = useRouter();
  const shared = sharedPostOf(m.shared_post);
  const media = messageMedia(m, resolveMedia);
  const files = messageFiles(m);
  const showText = Boolean(m.content) && !(m.image_url && m.content === WEBSITE_PHOTO_TEXT);
  const actions = m.pending ? undefined : () => onActions(m);
  const retry = m.failed ? () => onActions(m) : undefined;
  const sender = m.sender;
  // Runs of bubbles from one person hug each other, like X and Messenger: the inner corners are tighter.
  const corners = mine
    ? { borderTopRightRadius: firstInGroup ? 18 : 6, borderBottomRightRadius: lastInGroup ? 18 : 6 }
    : { borderTopLeftRadius: firstInGroup ? 18 : 6, borderBottomLeftRadius: lastInGroup ? 18 : 6 };
  const textColor = m.failed ? colors.dangerText : mine ? colors.onBrand : colors.text;

  return (
    <View>
      {showDay ? <Text style={styles.day}>{formatDayLabel(m.created_at)}</Text> : null}
      <Highlight active={highlighted}>
        <View style={[styles.line, mine && styles.lineMine, firstInGroup && !showDay && styles.groupStart]}>
          {!mine ? (
            <View style={styles.avatarSlot}>
              {lastInGroup && sender ? (
                <Pressable onPress={() => onPressAvatar(sender.id)} hitSlop={4} accessibilityRole="button" accessibilityLabel={`${sender.full_name}'s profile`}>
                  <Avatar name={sender.full_name} url={sender.avatar_url} size="sm" online={false} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <View style={[styles.stack, mine ? styles.stackMine : styles.stackTheirs]}>
            {!mine && isGroup && firstInGroup ? <Text style={styles.sender}>{sender?.full_name ?? "Unknown"}</Text> : null}
            {shared ? <SharedPostCard shared={shared} dimmed={Boolean(m.pending)} onLongPress={actions} /> : null}
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
            {showText ? (
              <Pressable onPress={retry} onLongPress={actions} delayLongPress={350} accessibilityHint={m.failed ? "Not sent. Tap for options." : undefined}>
                <View style={[styles.bubble, mine ? styles.mine : styles.theirs, corners, m.pending && styles.dim, m.failed && styles.failed]}>
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
            {lastInGroup || m.pending || m.failed ? (
              m.failed ? (
                <Text style={[styles.time, styles.failedTime]} onPress={retry} accessibilityRole="button">
                  Not sent · Tap to retry
                </Text>
              ) : (
                <Text style={styles.time}>{m.pending ? sendingLabel(m.outgoing) : formatMessageTime(m.created_at)}</Text>
              )
            ) : null}
          </View>
          {mine && receipt && receipt !== "seen" ? (
            <View style={styles.receipt} accessibilityLabel={receipt === "sending" ? "Sending" : receipt === "sent" ? "Sent" : "Delivered"}>
              {receipt === "sending" ? (
                <Ionicons name="ellipse-outline" size={13} color={colors.faint} />
              ) : receipt === "sent" ? (
                <Ionicons name="checkmark-circle-outline" size={14} color={colors.faint} />
              ) : (
                <Ionicons name="checkmark-circle" size={14} color={colors.faint} />
              )}
            </View>
          ) : null}
        </View>
      </Highlight>
      {seenBy && seenBy.length > 0 ? (
        <View style={styles.seen} accessibilityLabel={`Seen by ${seenBy.map((p) => p.full_name).join(", ")}`}>
          {seenBy.map((p) => (
            <Avatar key={p.id} name={p.full_name} url={p.avatar_url} size="xs" online={false} />
          ))}
        </View>
      ) : null}
    </View>
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

/** A shared post, reel or listing inside a chat: picture, who posted it, what it says, and "View post" to open it. */
function SharedPostCard({ shared, dimmed, onLongPress }: { shared: SharedPost; dimmed: boolean; onLongPress?: () => void }) {
  const styles = useStyles();
  const router = useRouter();
  const label = sharedPostLabel(shared);
  return (
    <Pressable
      onPress={() => router.push(sharedPostHref(shared))}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${shared.title ?? shared.caption ?? shared.author.name}`}
      style={({ pressed }) => [styles.card, dimmed && styles.dim, pressed && { opacity: 0.8 }]}
    >
      {shared.image_url ? <Image source={{ uri: shared.image_url }} style={styles.cardImage} contentFit="cover" transition={150} accessibilityLabel={shared.title ?? shared.caption ?? "Shared picture"} /> : null}
      <View style={styles.cardBody}>
        <View style={styles.cardAuthor}>
          <Avatar name={shared.author.name} url={shared.author.avatar_url} size="xs" online={false} />
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
          <Text style={styles.cardText} numberOfLines={2}>
            {shared.caption}
          </Text>
        ) : null}
        <Text style={styles.cardFooter}>{label}</Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  day: { textAlign: "center", fontSize: 11, color: colors.faint, marginTop: 14, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  line: { flexDirection: "row", alignItems: "flex-end", gap: 6, marginTop: 2 },
  lineMine: { flexDirection: "row-reverse" },
  groupStart: { marginTop: 10 },
  avatarSlot: { width: 32 },
  stack: { maxWidth: "78%", gap: 3 },
  stackMine: { alignItems: "flex-end" },
  stackTheirs: { alignItems: "flex-start" },
  sender: { fontSize: 11, color: colors.muted, marginLeft: 4 },
  bubble: { borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8 },
  mine: { backgroundColor: colors.brand },
  theirs: { backgroundColor: colors.input },
  dim: { opacity: 0.6 },
  failed: { backgroundColor: colors.dangerSoft },
  text: { fontSize: 15, lineHeight: 20 },
  link: { textDecorationLine: "underline" },
  time: { fontSize: 11, color: colors.faint, marginHorizontal: 4 },
  failedTime: { color: colors.red, fontWeight: "600" },
  receipt: { width: 16, alignItems: "center", marginBottom: 18 },
  seen: { flexDirection: "row", justifyContent: "flex-end", gap: 2, paddingRight: 2, marginTop: 2 },
  highlight: { position: "absolute", top: -3, bottom: -3, left: -8, right: -8, borderRadius: radius.md, backgroundColor: colors.brandSoft },
  card: { width: 240, maxWidth: "100%", borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card, overflow: "hidden" },
  // 4:5 would be 300pt tall at this width, so the picture is capped at 200 and cropped.
  cardImage: { width: "100%", height: 200, backgroundColor: colors.input },
  cardBody: { padding: 10, gap: 4 },
  cardAuthor: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardName: { fontSize: 13, fontWeight: "600", color: colors.text, flexShrink: 1 },
  cardTitle: { fontSize: 14, fontWeight: "600", lineHeight: 19, color: colors.text },
  cardText: { fontSize: 14, lineHeight: 19, color: colors.text },
  cardFooter: { fontSize: 13, fontWeight: "600", color: colors.brand, marginTop: 2 },
}));
