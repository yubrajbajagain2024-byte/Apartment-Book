import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { BUZZ_TOPICS, deleteBuzz, labelFor, listingMedia, muteBuzzAuthor, reportContent, REPORT_REASONS, timeAgo, voteBuzz, type BuzzPost, type ReportReason } from "@apartment-book/shared";
import { useActionSheet, type SheetOption } from "@/components/action-sheet";
import { PhotoCarousel } from "@/components/photo-carousel";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { colors, radius } from "@/lib/theme";

export type BuzzCardProps = {
  post: BuzzPost;
  /** Thread screen: show the whole body and do not navigate when tapped. */
  full?: boolean;
  /** Pause the video when the card is not on screen. */
  active?: boolean;
  /** The score or my vote changed: keep the parent's list in sync. */
  onChange?: (post: BuzzPost) => void;
  /** I deleted my own thread. */
  onRemoved?: (id: string) => void;
  /** I hid this person: the parent should reload so all their threads disappear. */
  onMuted?: () => void;
};

/** Lets the thread and create screens tell the Buzz list what changed, so it does not show stale cards. Carries thread data only, never people. */
export type BuzzEvent = { type: "patch"; post: BuzzPost } | { type: "remove"; id: string } | { type: "reload" };
const listeners = new Set<(e: BuzzEvent) => void>();
export function onBuzzEvent(listener: (e: BuzzEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function emitBuzzEvent(e: BuzzEvent) {
  listeners.forEach((l) => l(e));
}

/** Small pill for the topic, "You" and "OP". (Badge from ui.tsx pins itself to the top of a row; this one centres.) */
export function BuzzTag({ label, tone = "blue" }: { label: string; tone?: "blue" | "green" }) {
  return (
    <View style={[styles.tag, { backgroundColor: tone === "green" ? "#e6f6ea" : colors.brandSoft }]}>
      <Text style={{ fontSize: 11, fontWeight: "700", color: tone === "green" ? "#1f7a37" : colors.brand }}>{label}</Text>
    </View>
  );
}

type Vote = { score: number; myVote: -1 | 0 | 1 };

export function repliesLabel(count: number): string {
  return count === 1 ? "1 reply" : `${count} replies`;
}

/**
 * Reddit-style anonymous thread. There is deliberately no avatar, no profile link and no
 * "Message" button here: nobody can find out who wrote a Buzz thread, and the app never receives it.
 */
export function BuzzCard({ post, full = false, active = true, onChange, onRemoved, onMuted }: BuzzCardProps) {
  const router = useRouter();
  const show = useActionSheet();
  const { user } = useSession();
  const [vote, setVote] = useState<Vote>({ score: post.score, myVote: post.myVote });
  // What the card shows, what the server last confirmed, and the newest tap still waiting to be sent.
  const shown = useRef<Vote>(vote);
  const confirmed = useRef<Vote>(vote);
  const wanted = useRef<Vote["myVote"] | null>(null);
  const sending = useRef(false);
  const display = (v: Vote) => {
    shown.current = v;
    setVote(v);
  };
  const needLogin = () => router.push("/(auth)/login");
  const media = listingMedia(post.images, post.imageMeta, post.videos);
  const body = post.body.trim();

  // The parent reloaded the list: take its numbers (unless a vote is on its way).
  useEffect(() => {
    if (sending.current) return;
    confirmed.current = { score: post.score, myVote: post.myVote };
    display(confirmed.current);
  }, [post.id, post.score, post.myVote]);

  const open = () => {
    if (!full) router.push({ pathname: "/buzz/[id]", params: { id: post.id } });
  };

  /** Votes go to the server one at a time, so quick taps can never arrive out of order. Only the latest tap is sent next. */
  async function cast(direction: 1 | -1) {
    if (!user) return needLogin();
    const current = shown.current;
    const next = (current.myVote === direction ? 0 : direction) as Vote["myVote"];
    display({ score: current.score - current.myVote + next, myVote: next });
    wanted.current = next;
    if (sending.current) return;
    sending.current = true;
    try {
      while (wanted.current !== null) {
        const value = wanted.current;
        wanted.current = null;
        if (value === confirmed.current.myVote) continue;
        confirmed.current = await voteBuzz(supabase, post.id, value);
      }
      display(confirmed.current);
      onChange?.({ ...post, score: confirmed.current.score, myVote: confirmed.current.myVote });
    } catch (e) {
      wanted.current = null;
      display(confirmed.current);
      Alert.alert("Vote not saved", errorText(e));
    } finally {
      sending.current = false;
    }
  }

  function report() {
    if (!user) return needLogin();
    show(
      REPORT_REASONS.map((r) => ({
        label: r.label,
        onPress: async () => {
          await reportContent(supabase, user.id, { targetType: "buzz", targetId: post.id, reason: r.value as ReportReason }).catch(() => {});
          Alert.alert("Thanks", "Our team will review this post.");
        },
      })),
      "Why are you reporting this post?",
    );
  }

  function hideAuthor() {
    if (!user) return needLogin();
    Alert.alert("Hide this thread?", "You will no longer see this thread. Whoever posted it will not be told, and you will still not know who they are.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Hide",
        style: "destructive",
        onPress: () => {
          muteBuzzAuthor(supabase, { postId: post.id }).then(
            () => onMuted?.(),
            (e) => Alert.alert("Could not hide", errorText(e)),
          );
        },
      },
    ]);
  }

  function remove() {
    Alert.alert("Delete this post?", "The post and all its replies will be removed. This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteBuzz(supabase, post.id).then(
            () => onRemoved?.(post.id),
            (e) => Alert.alert("Could not delete", errorText(e)),
          );
        },
      },
    ]);
  }

  function menu() {
    const url = `${SITE_URL}/buzz/${post.id}`;
    const options: SheetOption[] = [{ label: "Share", icon: "share-outline", onPress: () => void Share.share({ message: `${post.title} · ${url}`, url }) }];
    if (post.isMine) {
      options.push({ label: "Delete", icon: "trash-outline", destructive: true, onPress: remove });
    } else {
      options.push({ label: "Hide this thread", icon: "eye-off-outline", onPress: hideAuthor });
      options.push({ label: "Report", icon: "flag-outline", destructive: true, onPress: report });
    }
    show(options);
  }

  const up = vote.myVote === 1;
  const down = vote.myVote === -1;

  return (
    <View style={styles.card} accessibilityLabel={`Anonymous post: ${post.title}`}>
      <View style={styles.row}>
        <View style={styles.votes}>
          <Pressable onPress={() => void cast(1)} hitSlop={6} style={[styles.arrow, up && { backgroundColor: colors.brandSoft }]} accessibilityRole="button" accessibilityLabel="Upvote" accessibilityState={{ selected: up }}>
            <Ionicons name={up ? "arrow-up-circle" : "arrow-up"} size={up ? 24 : 20} color={up ? colors.brand : colors.muted} />
          </Pressable>
          <Text style={[styles.score, up && { color: colors.brand }, down && { color: colors.red }]} accessibilityLabel={`Score ${vote.score}`}>
            {formatScore(vote.score)}
          </Text>
          <Pressable onPress={() => void cast(-1)} hitSlop={6} style={[styles.arrow, down && { backgroundColor: "#fdecec" }]} accessibilityRole="button" accessibilityLabel="Downvote" accessibilityState={{ selected: down }}>
            <Ionicons name={down ? "arrow-down-circle" : "arrow-down"} size={down ? 24 : 20} color={down ? colors.red : colors.muted} />
          </Pressable>
        </View>

        <Pressable onPress={open} disabled={full} style={styles.main}>
          <View style={styles.metaRow}>
            <BuzzTag label={labelFor(BUZZ_TOPICS, post.topic)} />
            <Text style={styles.meta} numberOfLines={1}>
              {post.alias} · {timeAgo(post.createdAt)}
            </Text>
            {post.isMine ? <BuzzTag label="You" tone="green" /> : null}
          </View>
          <Text style={[styles.title, full && { fontSize: 19 }]}>{post.title}</Text>
          {body ? (
            <Text style={styles.body} numberOfLines={full ? undefined : 4} selectable={full}>
              {body}
            </Text>
          ) : null}
        </Pressable>
      </View>

      {media.length > 0 ? <PhotoCarousel media={media} aspect={4 / 3} onPress={full ? undefined : open} active={active} videoLabel={null} /> : null}

      <View style={styles.footer}>
        <Pressable onPress={open} disabled={full} style={styles.replies} accessibilityRole="button" accessibilityLabel={`${repliesLabel(post.commentCount)}. Open the thread`}>
          <Ionicons name="chatbubble-outline" size={16} color={colors.muted} />
          <Text style={styles.footerText}>{repliesLabel(post.commentCount)}</Text>
        </Pressable>
        <Pressable onPress={menu} hitSlop={8} style={styles.dots} accessibilityRole="button" accessibilityLabel="Post options">
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

function formatScore(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return String(n);
  return `${(n / 1000).toFixed(abs < 10000 ? 1 : 0)}k`;
}

const styles = StyleSheet.create({
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: "hidden" },
  row: { flexDirection: "row", gap: 8, paddingTop: 12, paddingRight: 12, paddingBottom: 10, paddingLeft: 6 },
  votes: { width: 40, alignItems: "center", gap: 2 },
  arrow: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  score: { fontSize: 14, fontWeight: "800", color: colors.text },
  main: { flex: 1, minWidth: 0, gap: 5 },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  meta: { fontSize: 12, color: colors.muted, flexShrink: 1 },
  title: { fontSize: 17, fontWeight: "700", color: colors.text, lineHeight: 22 },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 14, paddingRight: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  replies: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingRight: 12 },
  footerText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  dots: { width: 36, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16 },
});
