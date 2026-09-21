import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { BUZZ_TOPICS, compactCount, deleteBuzz, labelFor, listingMedia, muteBuzzAuthor, reportContent, REPORT_REASONS, shortAge, voteBuzz, type BuzzPost, type BuzzTopic, type FeedMedia, type ReportReason } from "@apartment-book/shared";
import { useActionSheet, type SheetOption } from "@/components/action-sheet";
import { PhotoCarousel } from "@/components/photo-carousel";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { colors, radius } from "@/lib/theme";

/*
 * Buzz looks like Reddit, but it is anonymous. Where Reddit shows a community, Buzz shows the topic;
 * where Reddit shows a username, Buzz shows the alias ("Student 48213"). There is deliberately no real
 * name, no photo, no profile link and no "Message" button anywhere in here: the app never receives who wrote what.
 */

/** Lets the thread and create screens tell the Buzz list what changed, so it does not show stale rows. Carries thread data only, never people. */
export type BuzzEvent = { type: "patch"; post: BuzzPost } | { type: "vote"; id: string; vote: Vote } | { type: "remove"; id: string } | { type: "reload" };
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

export function repliesLabel(count: number): string {
  return count === 1 ? "1 reply" : `${count} replies`;
}

/** Side padding of every Buzz row, like Reddit. */
export const BUZZ_GUTTER = 16;
const UP_COLOR = colors.brand;
const DOWN_COLOR = "#6a5cff";

/* ---------- small pieces ---------- */

/** Small pill for "You" and "OP". */
export function BuzzTag({ label, tone = "blue" }: { label: string; tone?: "blue" | "green" }) {
  return (
    <View style={[styles.tag, { backgroundColor: tone === "green" ? "#e6f6ea" : colors.brandSoft }]}>
      <Text style={{ fontSize: 10, fontWeight: "800", color: tone === "green" ? "#1f7a37" : colors.brand }}>{label}</Text>
    </View>
  );
}

const TOPIC_LOOK: Record<BuzzTopic, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  thoughts: { icon: "bulb", color: "#f59e0b" },
  experience: { icon: "sparkles", color: "#8b5cf6" },
  advice: { icon: "compass", color: "#22a06b" },
  question: { icon: "help", color: "#1877f2" },
  housing: { icon: "home", color: "#f97316" },
  campus: { icon: "school", color: "#0ea5a4" },
  rant: { icon: "flame", color: "#e41e3f" },
  other: { icon: "chatbubbles", color: "#65676b" },
};

/** The round coloured icon that stands where Reddit shows a community icon. */
export function TopicIcon({ topic, size = 24 }: { topic: BuzzTopic; size?: number }) {
  const look = TOPIC_LOOK[topic] ?? TOPIC_LOOK.other;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: look.color, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={look.icon} size={Math.round(size * 0.58)} color="#fff" />
    </View>
  );
}

const AVATAR_COLORS: [string, string][] = [
  ["#dbeafe", "#3b6fd4"],
  ["#dcfce7", "#2f8f57"],
  ["#fef3c7", "#b7791f"],
  ["#fce7f3", "#c2518d"],
  ["#ede9fe", "#7457d6"],
  ["#ffedd5", "#d2691e"],
  ["#cffafe", "#1f8a99"],
  ["#fee2e2", "#cc4b4b"],
];

/** An anonymous avatar: the colour comes from the alias text only, so it says nothing about the real person. */
export function AnonAvatar({ alias, size = 28 }: { alias: string; size?: number }) {
  let hash = 0;
  for (let i = 0; i < alias.length; i++) hash = (hash * 31 + alias.charCodeAt(i)) >>> 0;
  const [bg, fg] = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name="person" size={Math.round(size * 0.56)} color={fg} />
    </View>
  );
}

/* ---------- voting ---------- */

export type Vote = { score: number; myVote: -1 | 0 | 1 };

/**
 * Votes on their way to the server, by "thread:<id>" or "reply:<id>". The same thread or reply can be on screen twice
 * (a feed row and its thread screen, or a reply that was folded away and came back), and each copy has its own
 * useVote. Chaining them here means there is never more than one vote request per target at a time.
 * Each entry resolves to what the server last confirmed, or null when nothing is known.
 */
const votesInFlight = new Map<string, Promise<Vote | null>>();

/**
 * Optimistic voting for a thread or a reply. Votes go to the server one at a time, so quick taps can never
 * arrive out of order: only the latest tap is sent next, and the server's answer always wins in the end.
 * `onConfirmed` gets only the vote: the parent must merge it into its newest data (a functional update), never into a captured copy.
 */
export function useVote(kind: "thread" | "reply", id: string, initial: Vote, send: (value: Vote["myVote"]) => Promise<Vote>, onConfirmed?: (vote: Vote) => void) {
  const router = useRouter();
  const { user } = useSession();
  const key = `${kind}:${id}`;
  const [vote, setVote] = useState<Vote>({ score: initial.score, myVote: initial.myVote });
  // What is shown, what the server last confirmed, and the newest tap still waiting to be sent.
  const shown = useRef<Vote>(vote);
  const confirmed = useRef<Vote>(vote);
  const wanted = useRef<Vote["myVote"] | null>(null);
  const sending = useRef(false);
  // Always call the parent's newest callback, not the one from the render when the tap happened.
  const notify = useRef(onConfirmed);
  notify.current = onConfirmed;
  const display = (v: Vote) => {
    shown.current = v;
    setVote(v);
  };

  // The parent reloaded: take its numbers (unless a vote is on its way).
  useEffect(() => {
    if (sending.current) return;
    confirmed.current = { score: initial.score, myVote: initial.myVote };
    display(confirmed.current);
  }, [id, initial.score, initial.myVote]);

  async function cast(direction: 1 | -1) {
    if (!user) return router.push("/(auth)/login");
    const current = shown.current;
    // Tapping the arrow that is already lit clears the vote.
    const next = (current.myVote === direction ? 0 : direction) as Vote["myVote"];
    display({ score: current.score - current.myVote + next, myVote: next });
    wanted.current = next;
    if (sending.current) return;
    sending.current = true;
    // True once the server has told us something the parent does not know yet.
    let fresh = false;
    const earlier = votesInFlight.get(key);
    const run = (async () => {
      if (earlier) {
        // Another copy of this row is still sending: wait for it, and start from what the server told it.
        const before = await earlier;
        if (before) {
          confirmed.current = before;
          fresh = true;
        }
      }
      while (wanted.current !== null) {
        const value = wanted.current;
        wanted.current = null;
        if (value === confirmed.current.myVote) continue;
        confirmed.current = await send(value);
        fresh = true;
      }
    })();
    const tracked = run.then(
      () => confirmed.current,
      () => (fresh ? confirmed.current : null),
    );
    votesInFlight.set(key, tracked);
    try {
      await run;
      display(confirmed.current);
      if (fresh) notify.current?.(confirmed.current);
    } catch (e) {
      wanted.current = null;
      display(confirmed.current);
      // An earlier tap may have been saved before this one failed: the parent still needs those numbers.
      if (fresh) notify.current?.(confirmed.current);
      Alert.alert("Vote not saved", errorText(e));
    } finally {
      sending.current = false;
      if (votesInFlight.get(key) === tracked) votesInFlight.delete(key);
    }
  }

  return { vote, cast };
}

/** Reddit's vote pill: [up] score | [down]. `bare` drops the outline (used on replies). */
export function VotePill({ vote, onVote, bare = false, labels = ["Upvote", "Downvote"] }: { vote: Vote; onVote: (direction: 1 | -1) => void; bare?: boolean; labels?: [string, string] }) {
  const up = vote.myVote === 1;
  const down = vote.myVote === -1;
  const filled = !bare && (up || down);
  const ink = filled ? "#fff" : colors.text;
  return (
    <View style={[bare ? styles.votesBare : styles.pill, !bare && { paddingHorizontal: 0, gap: 0 }, filled && { backgroundColor: up ? UP_COLOR : DOWN_COLOR, borderColor: up ? UP_COLOR : DOWN_COLOR }]}>
      <Pressable onPress={() => onVote(1)} hitSlop={bare ? 8 : { top: 8, bottom: 8, left: 8 }} style={bare ? styles.arrowBare : styles.arrowLeft} accessibilityRole="button" accessibilityLabel={labels[0]} accessibilityState={{ selected: up }}>
        <MaterialCommunityIcons name={up ? "arrow-up-bold" : "arrow-up-bold-outline"} size={20} color={filled ? "#fff" : up ? UP_COLOR : bare ? colors.muted : colors.text} />
      </Pressable>
      <Text style={[styles.pillText, { color: bare ? (up ? UP_COLOR : down ? DOWN_COLOR : colors.muted) : ink, minWidth: 14, textAlign: "center" }]} accessibilityLabel={`Score ${vote.score}`}>
        {compactCount(vote.score)}
      </Text>
      {bare ? null : <View style={[styles.pillDivider, filled && { backgroundColor: "rgba(255,255,255,0.45)" }]} />}
      <Pressable onPress={() => onVote(-1)} hitSlop={bare ? 8 : { top: 8, bottom: 8, right: 8 }} style={bare ? styles.arrowBare : styles.arrowRight} accessibilityRole="button" accessibilityLabel={labels[1]} accessibilityState={{ selected: down }}>
        <MaterialCommunityIcons name={down ? "arrow-down-bold" : "arrow-down-bold-outline"} size={20} color={filled ? "#fff" : down ? DOWN_COLOR : bare ? colors.muted : colors.text} />
      </Pressable>
    </View>
  );
}

/* ---------- a thread's menu (share, hide, report, delete) ---------- */

type PostHandlers = {
  /** I deleted my own thread. */
  onRemoved?: (id: string) => void;
  /** I hid this thread: the parent should reload (or leave). */
  onMuted?: () => void;
};

export function useBuzzMenu(post: BuzzPost | null, { onRemoved, onMuted }: PostHandlers) {
  const router = useRouter();
  const show = useActionSheet();
  const { user } = useSession();
  const needLogin = () => router.push("/(auth)/login");

  function share() {
    if (!post) return;
    const url = `${SITE_URL}/buzz/${post.id}`;
    void Share.share({ message: `${post.title} · ${url}`, url });
  }

  function report() {
    if (!post) return;
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

  function hideThread() {
    if (!post) return;
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
    if (!post) return;
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
    if (!post) return;
    const options: SheetOption[] = [{ label: "Share", icon: "share-outline", onPress: share }];
    if (post.isMine) {
      options.push({ label: "Delete", icon: "trash-outline", destructive: true, onPress: remove });
    } else {
      options.push({ label: "Hide this thread", icon: "eye-off-outline", onPress: hideThread });
      options.push({ label: "Report", icon: "flag-outline", destructive: true, onPress: report });
    }
    show(options);
  }

  return { menu, share };
}

/** The action row under a thread: vote pill, replies pill, and the share pill pushed to the right. */
function PillRow({ post, onVote, onReplies, repliesHint, onShare }: { post: BuzzPost; onVote?: (vote: Vote) => void; onReplies: () => void; repliesHint: string; onShare: () => void }) {
  const { vote, cast } = useVote("thread", post.id, post, (value) => voteBuzz(supabase, post.id, value), onVote);
  return (
    <View style={styles.pills}>
      <VotePill vote={vote} onVote={(d) => void cast(d)} />
      <Pressable onPress={onReplies} style={styles.pill} accessibilityRole="button" accessibilityLabel={`${repliesLabel(post.commentCount)}. ${repliesHint}`}>
        <MaterialCommunityIcons name="comment-outline" size={18} color={colors.text} />
        <Text style={styles.pillText}>{compactCount(post.commentCount)}</Text>
      </Pressable>
      <View style={{ flex: 1 }} />
      <Pressable onPress={onShare} style={styles.pill} accessibilityRole="button" accessibilityLabel="Share">
        <MaterialCommunityIcons name="share-outline" size={20} color={colors.text} />
      </Pressable>
    </View>
  );
}

function Thumb({ media }: { media: FeedMedia[] }) {
  const first = media[0];
  if (!first) return null;
  const uri = first.type === "photo" ? first.url : first.poster;
  return (
    <View style={styles.thumb}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}
      {first.type === "video" ? (
        <View style={styles.play}>
          <Ionicons name="play" size={12} color="#fff" style={{ marginLeft: 1 }} />
        </View>
      ) : media.length > 1 ? (
        <View style={styles.count}>
          <Ionicons name="images" size={10} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{media.length}</Text>
        </View>
      ) : null}
    </View>
  );
}

/* ---------- feed row ---------- */

export type BuzzCardProps = PostHandlers & {
  post: BuzzPost;
  /** The server confirmed my vote: merge it into the parent's newest list (only the score and my vote, nothing else). */
  onVote?: (vote: Vote) => void;
};

/** One thread in the Buzz feed: a flat, full-width Reddit row (the list draws the hairline between rows). */
export function BuzzCard({ post, onVote, onRemoved, onMuted }: BuzzCardProps) {
  const router = useRouter();
  const { menu, share } = useBuzzMenu(post, { onRemoved, onMuted });
  const media = listingMedia(post.images, post.imageMeta, post.videos);
  const body = post.body.trim();
  const open = () => router.push({ pathname: "/buzz/[id]", params: { id: post.id } });

  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <Pressable onPress={open} style={styles.headMain} accessible={false}>
          <TopicIcon topic={post.topic} />
          <Text style={styles.topic} numberOfLines={1}>
            {labelFor(BUZZ_TOPICS, post.topic)}
          </Text>
          <Text style={styles.age}>{shortAge(post.createdAt)}</Text>
          {post.isMine ? <Text style={styles.you}>You</Text> : null}
        </Pressable>
        <Pressable onPress={menu} hitSlop={10} style={styles.dots} accessibilityRole="button" accessibilityLabel="Post options">
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.muted} />
        </Pressable>
      </View>

      <Pressable onPress={open} style={styles.main} accessibilityRole="button" accessibilityLabel={`Anonymous post: ${post.title}`}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={styles.title}>{post.title}</Text>
          {body ? (
            <Text style={styles.preview} numberOfLines={3}>
              {body}
            </Text>
          ) : null}
        </View>
        <Thumb media={media} />
      </Pressable>

      <PillRow post={post} onVote={onVote} onReplies={open} repliesHint="Open the thread" onShare={share} />
    </View>
  );
}

/** A search result, in Reddit's compact style: topic and age, the title, then "12 upvotes · 7 comments". No pills. */
export function BuzzSearchRow({ post }: { post: BuzzPost }) {
  const router = useRouter();
  const media = listingMedia(post.images, post.imageMeta, post.videos);
  const votes = `${compactCount(post.score)} ${post.score === 1 ? "upvote" : "upvotes"}`;
  const comments = `${compactCount(post.commentCount)} ${post.commentCount === 1 ? "comment" : "comments"}`;
  return (
    <Pressable onPress={() => router.push({ pathname: "/buzz/[id]", params: { id: post.id } })} style={({ pressed }) => [styles.searchRow, pressed && { backgroundColor: colors.bg }]} accessibilityRole="button" accessibilityLabel={`Anonymous post: ${post.title}. ${votes}, ${comments}. Open the thread`}>
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <View style={styles.headMain}>
          <TopicIcon topic={post.topic} size={20} />
          <Text style={[styles.topic, { color: colors.muted }]} numberOfLines={1}>
            {labelFor(BUZZ_TOPICS, post.topic)}
          </Text>
          <Text style={styles.age}>• {shortAge(post.createdAt)}</Text>
          {post.isMine ? <Text style={styles.you}>You</Text> : null}
        </View>
        <Text style={styles.searchTitle} numberOfLines={3}>
          {post.title}
        </Text>
        <Text style={styles.searchMeta}>
          {votes} · {comments}
        </Text>
      </View>
      <Thumb media={media} />
    </Pressable>
  );
}

/* ---------- the thread screen's post block ---------- */

/** The post at the top of the thread screen. Media runs edge to edge; text keeps the gutter. `active` is false while the block is off screen, so its video pauses. */
export function BuzzPostBlock({ post, onVote, onReply, active = true }: { post: BuzzPost; onVote?: (vote: Vote) => void; onReply: () => void; active?: boolean }) {
  const { share } = useBuzzMenu(post, {});
  const media = listingMedia(post.images, post.imageMeta, post.videos);
  const body = post.body.trim();
  const first = media[0];
  // Show the first photo or video in its own shape, within sensible limits.
  const natural = first?.width && first?.height ? first.width / first.height : 4 / 3;
  const aspect = Math.min(16 / 9, Math.max(4 / 5, natural));

  return (
    <View style={styles.block}>
      <View style={styles.blockHead}>
        <TopicIcon topic={post.topic} size={34} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.blockTopic} numberOfLines={1}>
            {labelFor(BUZZ_TOPICS, post.topic)}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={styles.blockAlias} numberOfLines={1}>
              {post.alias}
            </Text>
            <Text style={styles.blockAge}>• {shortAge(post.createdAt)}</Text>
            <BuzzTag label="OP" />
            {post.isMine ? <BuzzTag label="You" tone="green" /> : null}
          </View>
        </View>
      </View>
      <Text style={styles.blockTitle} selectable>
        {post.title}
      </Text>
      {body ? (
        <Text style={styles.blockBody} selectable>
          {body}
        </Text>
      ) : null}
      {media.length > 0 ? (
        <View style={{ marginTop: 12 }}>
          <PhotoCarousel media={media} aspect={aspect} videoLabel={null} active={active} />
        </View>
      ) : null}
      <PillRow post={post} onVote={onVote} onReplies={onReply} repliesHint="Write a reply" onShare={share} />
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill },

  row: { backgroundColor: colors.card, paddingTop: 10, paddingBottom: 10 },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: BUZZ_GUTTER, gap: 8 },
  headMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  topic: { fontSize: 13, fontWeight: "700", color: colors.text, flexShrink: 1 },
  age: { fontSize: 13, color: colors.muted },
  you: { fontSize: 12, fontWeight: "700", color: "#1f7a37" },
  dots: { width: 32, height: 28, alignItems: "flex-end", justifyContent: "center" },
  main: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: BUZZ_GUTTER, paddingTop: 6 },
  title: { fontSize: 17, fontWeight: "700", color: colors.text, lineHeight: 22 },
  preview: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  thumb: { width: 96, height: 72, borderRadius: 12, overflow: "hidden", backgroundColor: colors.input },
  play: { position: "absolute", left: 6, bottom: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center" },
  count: { position: "absolute", right: 6, bottom: 6, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },

  pills: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: BUZZ_GUTTER, paddingTop: 12 },
  pill: { height: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  pillText: { fontSize: 13, fontWeight: "700", color: colors.text },
  pillDivider: { width: 1, height: 16, backgroundColor: colors.border, marginLeft: 10 },
  arrowLeft: { height: 32, paddingLeft: 10, paddingRight: 6, alignItems: "center", justifyContent: "center" },
  arrowRight: { height: 32, paddingLeft: 8, paddingRight: 10, alignItems: "center", justifyContent: "center" },
  votesBare: { flexDirection: "row", alignItems: "center", gap: 4 },
  arrowBare: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },

  searchRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: colors.card, paddingHorizontal: BUZZ_GUTTER, paddingVertical: 12 },
  searchTitle: { fontSize: 16, color: colors.text, lineHeight: 21 },
  searchMeta: { fontSize: 13, color: colors.muted },

  block: { backgroundColor: colors.card, paddingTop: 8, paddingBottom: 12 },
  blockHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: BUZZ_GUTTER },
  blockTopic: { fontSize: 13, fontWeight: "700", color: colors.muted },
  blockAlias: { fontSize: 13, color: colors.brand, flexShrink: 1 },
  blockAge: { fontSize: 13, color: colors.muted },
  blockTitle: { fontSize: 21, fontWeight: "700", color: colors.text, lineHeight: 27, paddingHorizontal: BUZZ_GUTTER, paddingTop: 10 },
  blockBody: { fontSize: 16, color: colors.text, lineHeight: 23, paddingHorizontal: BUZZ_GUTTER, paddingTop: 8 },
});
