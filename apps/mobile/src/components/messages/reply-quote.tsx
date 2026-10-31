import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { replyKindLabel, replyText, type MessageReply, type MessageReplyKind } from "@apartment-book/shared";
import { Icon, type IconName } from "@/components/icon";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** What the chat knows about the message a quote points at: who wrote it, and its first picture when it is on screen. */
export type ReplyContext = { name: string; thumbnail?: string | null; thumbnailKey?: string };

const ICONS: Partial<Record<MessageReplyKind, IconName>> = {
  photo: "image-outline",
  video: "videocam-outline",
  voice: "mic-outline",
  file: "document-outline",
  snap: "camera-outline",
  post: "image-outline",
  reel: "film-outline",
  listing: "home-outline",
  story: "aperture-outline",
};

/**
 * The message a reply answers, quoted in a small block: who wrote it, its words (or what it was: "Photo", "Voice
 * message", …, with a matching icon) and its first picture when the chat has it on screen. Above a bubble it sits
 * tucked behind the reply, Messenger style, and a tap jumps to the original; above the message bar it is what the
 * person is about to answer, with the accent bar in the brand colour.
 */
export function ReplyQuote({
  reply,
  context,
  tone,
  onPress,
  style,
}: {
  reply: MessageReply;
  context: ReplyContext;
  /** "mine" and "theirs" are the quote above a bubble on that side; "composer" the one above the message bar. */
  tone: "mine" | "theirs" | "composer";
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const colors = useColors();
  const icon = reply.text ? null : ICONS[reply.kind];
  const text = replyText(reply);
  const label = `Replying to ${context.name}: ${reply.text ?? replyKindLabel(reply.kind)}`;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      accessibilityHint={onPress ? "Shows the message it answers" : undefined}
      style={({ pressed }) => [styles.quote, tone === "composer" ? styles.composer : styles.inChat, pressed && onPress && { opacity: 0.7 }, style]}
    >
      <View style={[styles.accent, { backgroundColor: tone === "composer" ? colors.brand : colors.faint }]} />
      <View style={styles.body}>
        <Text style={[styles.name, tone === "composer" && { color: colors.brand }]} numberOfLines={1}>
          {tone === "composer" ? `Replying to ${context.name}` : context.name}
        </Text>
        <View style={styles.line}>
          {icon ? <Icon name={icon} size={13} color={colors.muted} /> : null}
          <Text style={styles.text} numberOfLines={tone === "composer" ? 1 : 2}>
            {text}
          </Text>
        </View>
      </View>
      {context.thumbnail ? <Image source={{ uri: context.thumbnail, cacheKey: context.thumbnailKey }} style={styles.thumb} contentFit="cover" transition={100} accessibilityIgnoresInvertColors /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  quote: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderCurve: "continuous", overflow: "hidden", maxWidth: "100%" },
  // Behind a bubble: a soft panel, the words a touch quieter, its bottom tucked under the reply.
  inChat: { backgroundColor: colors.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingVertical: 6, paddingRight: 10, paddingBottom: 12, marginBottom: -8 },
  composer: { flex: 1, paddingVertical: 6, paddingRight: 10 },
  accent: { alignSelf: "stretch", width: 3, borderRadius: 1.5, marginLeft: 6 },
  body: { flexShrink: 1, gap: 1 },
  name: { fontSize: 12, fontWeight: "600", color: colors.muted },
  line: { flexDirection: "row", alignItems: "center", gap: 4 },
  text: { flexShrink: 1, fontSize: 14, lineHeight: 18, color: colors.muted },
  thumb: { width: 36, height: 36, borderRadius: 8, borderCurve: "continuous", backgroundColor: colors.skeleton },
}));
