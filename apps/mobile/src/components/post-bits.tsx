import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { compactCount } from "@apartment-book/shared";
import { radius } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { Avatar } from "./avatar";
import { Icon, useBounceOn } from "@/components/icon";

/** The side gutter of every post: the header, the text, the photo's rounded frame and the rows under it keep to it. */
export const POST_GUTTER = 16;
/** The corner radius of a post's photo frame. */
export const POST_FRAME_RADIUS = 18;
const AVATAR = 42;

/**
 * The pieces every post in the app is built from, so posts, roommate posts and apartments look the same: the header
 * (photo, name, a grey "<where> · Oct 2" line and the ••• menu), the rounded frame around the photo or video, and the
 * row of heart, comment and share with their counts, the bookmark on the right. The words of a post sit between the
 * header and the frame, Facebook style (see ExpandableText).
 */
export function PostHeader({ name, avatarUrl, userId, verified, meta, onOpen, onMenu }: { name: string; avatarUrl: string | null | undefined; userId: string; verified: boolean; meta: string; onOpen: () => void; onMenu: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.header}>
      <Pressable onPress={onOpen} accessibilityLabel={`${name}'s profile`}>
        <Avatar name={name} url={avatarUrl} size={AVATAR} userId={userId} />
      </Pressable>
      {/* Labelled with the name alone: the verified icon would otherwise join the label and hide the name from assistive tech (and Maestro). */}
      <Pressable style={{ flex: 1, minWidth: 0 }} onPress={onOpen} accessibilityRole="button" accessibilityLabel={name}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {verified ? <Icon name="checkmark-circle" sf="checkmark.seal.fill" size={16} color={colors.brand} accessibilityLabel="Verified student" /> : null}
        </View>
        {meta ? (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </Pressable>
      <Pressable onPress={onMenu} hitSlop={10} accessibilityLabel="Post options" accessibilityRole="button" style={styles.dots}>
        <Icon name="ellipsis-horizontal" size={20} color={colors.muted} />
      </Pressable>
    </View>
  );
}

/** The rounded frame a post's photo or video sits in, inset from the screen edges; it clips whatever is laid over the picture too. */
export function PostFrame({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <View style={styles.frame}>{children}</View>;
}

/**
 * Heart, comment (left out when there is no `onComment`) and share with their counts, an optional chat pill (listings:
 * a chat with the owner), either right after share (`messageBeside`) or on the right, and the bookmark at the far right.
 */
export function PostActions({ liked, likes, comments, saved, onLike, onComment, onShare, onSave, message, messageBeside, tight }: { liked: boolean; likes: number; comments: number; saved: boolean; onLike: () => void; onComment?: () => void; onShare: () => void; onSave: () => void; message?: { label: string; onPress: () => void }; messageBeside?: boolean; tight?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  // The heart and the bookmark answer with the system's bounce as they fill (and only then).
  const likeBounce = useBounceOn(liked);
  const saveBounce = useBounceOn(saved);
  return (
    <View style={[styles.actions, tight && { paddingTop: 6 }]}>
      <Pressable onPress={onLike} hitSlop={6} style={styles.action} accessibilityRole="button" accessibilityLabel={liked ? "Unlike" : "Like"} accessibilityState={{ selected: liked }}>
        <Icon name={liked ? "heart" : "heart-outline"} size={26} color={liked ? colors.like : colors.text} bounce={likeBounce} />
        {likes > 0 ? <Text style={styles.count}>{compactCount(likes)}</Text> : null}
      </Pressable>
      {onComment ? (
        <Pressable onPress={onComment} hitSlop={6} style={styles.action} accessibilityRole="button" accessibilityLabel="Comment">
          <Icon name="chatbubble-outline" size={24} color={colors.text} />
          {comments > 0 ? <Text style={styles.count}>{compactCount(comments)}</Text> : null}
        </Pressable>
      ) : null}
      <Pressable onPress={onShare} hitSlop={6} style={styles.action} accessibilityRole="button" accessibilityLabel="Share">
        <Icon name="share-outline" size={24} color={colors.text} />
      </Pressable>
      {message && messageBeside ? <MessagePill message={message} beside /> : null}
      <View style={{ flex: 1 }} />
      {message && !messageBeside ? <MessagePill message={message} /> : null}
      <Pressable onPress={onSave} hitSlop={6} accessibilityRole="button" accessibilityLabel={saved ? "Unsave" : "Save"} accessibilityState={{ selected: saved }}>
        <Icon name={saved ? "bookmark" : "bookmark-outline"} size={24} color={saved ? colors.text : colors.muted} bounce={saveBounce} />
      </Pressable>
    </View>
  );
}

/** The chat pill: a small outlined capsule with the chat icon and its label. */
function MessagePill({ message, beside }: { message: { label: string; onPress: () => void }; beside?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable onPress={message.onPress} hitSlop={4} style={({ pressed }) => [styles.message, beside && styles.messageBeside, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={message.label}>
      <Icon name="chatbubble-ellipses-outline" size={16} color={colors.text} />
      <Text style={styles.messageText}>{message.label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: POST_GUTTER, paddingVertical: 10 },
  name: { fontSize: 16, fontWeight: "700", color: colors.text, flexShrink: 1 },
  meta: { fontSize: 13, color: colors.muted, marginTop: 1 },
  dots: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  frame: { marginHorizontal: POST_GUTTER, borderRadius: POST_FRAME_RADIUS, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.mediaBg },
  actions: { flexDirection: "row", alignItems: "center", gap: 22, paddingHorizontal: POST_GUTTER, paddingTop: 12, paddingBottom: 4 },
  action: { flexDirection: "row", alignItems: "center", gap: 6 },
  // Tabular figures: a count that changes (12 → 13) never shifts the icons beside it.
  count: { fontSize: 14, fontWeight: "600", color: colors.text, fontVariant: ["tabular-nums"] },
  message: { flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, marginRight: 14 },
  // Right after share, in the row's own spacing.
  messageBeside: { marginRight: 0 },
  messageText: { fontSize: 13, fontWeight: "700", color: colors.text },
}));

/** The text of a post, the same size on posts, roommate posts and apartments. */
export const POST_TEXT = { fontSize: 15, lineHeight: 21 } as const;
