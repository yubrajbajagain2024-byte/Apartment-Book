import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { BUZZ_MINE_COPY, buzzHeadline, compactCount, type Buzz, type BuzzReply, type BuzzTopReply } from "@apartment-book/shared";
import { Icon } from "@/components/icon";
import { useBuzzItem, useBuzzState } from "@/lib/buzz-store";
import { useBuzzItemMenu } from "./item-menu";
import { BuzzMediaView } from "./media";
import { AliasAvatar, AliasLine, BuzzContent, BuzzTags, BuzzText, CollapsedFold, MoreButton, PollView, PromptLine, ReplyCountButton, ShareButton, StatusChip, SupportLink, VoteCluster } from "./parts";
import { Badge, OpBadge, P, R, Skeleton, T } from "./ui";

/*
 * The feed card (UniVerse's BuzzCard, design §7.2): a raised Phosphor card with the alias line, the headline and words
 * (six lines, Show more), photos or a video, a poll, the support link, "Top reply" (the thread's most upvoted reply,
 * two lines, opening the thread at it), and the vote pill, the reply count and share. A day's prompt thread has "✦ Daily
 * prompt" where the alias would be and counts answers. Under the alias line, the category its author picked ("📚 Classes")
 * and, on an answer posted as its own buzz, "Daily prompt · See all answers" to that day's thread. A community-collapsed
 * card folds to one line. Your own held / hidden / removed cards carry their status chip. Never a photo of a person,
 * never a name or a handle.
 */

/** The thread, opened at one of its replies when `replyId` is given (it unfolds to it and lights it up a moment). */
export function openThread(router: ReturnType<typeof useRouter>, threadId: string, replyId?: string) {
  router.push({ pathname: "/buzz/[id]", params: replyId ? { id: threadId, reply: replyId } : { id: threadId } });
}

export const BuzzCard = memo(function BuzzCard({ buzz, linkToThread = true }: { buzz: Buzz; linkToThread?: boolean }) {
  const router = useRouter();
  const openMenu = useBuzzItemMenu();
  const open = useCallback(() => openThread(router, buzz.threadId), [router, buzz.threadId]);
  const revealed = useBuzzState(useCallback((s) => s.revealed[buzz.id] === true, [buzz.id]));
  if (buzz.collapsed && !buzz.isMine && !revealed) {
    return (
      <View style={[styles.card, styles.folded]}>
        <CollapsedFold id={buzz.id} reason="community">
          {null}
        </CollapsedFold>
      </View>
    );
  }
  const hasWords = Boolean(buzz.text || buzz.title);
  const trailing = (
    <View style={styles.trailing}>
      {buzz.campusShortName ? <Badge label={buzz.campusShortName} /> : null}
      {buzz.isMine ? <StatusChip status={buzz.status} /> : null}
      <MoreButton onPress={() => openMenu(buzz)} />
    </View>
  );
  return (
    <View style={styles.card}>
      {buzz.isPromptThread ? <PromptLine createdAt={buzz.createdAt} trailing={trailing} /> : <AliasLine alias={buzz.alias} isMine={buzz.isMine} createdAt={buzz.createdAt} trailing={trailing} />}
      <BuzzTags buzz={buzz} onOpenPrompt={(id) => openThread(router, id)} />
      {linkToThread && hasWords ? (
        <Pressable onPress={open} accessibilityRole="button" accessibilityHint="Opens the thread" style={({ pressed }) => pressed && styles.pressed}>
          <BuzzContent buzz={buzz} clamp />
        </Pressable>
      ) : (
        <BuzzContent buzz={buzz} clamp={linkToThread} />
      )}
      <BuzzMediaView buzz={buzz} />
      {buzz.poll ? <PollView threadId={buzz.threadId} poll={buzz.poll} isMine={buzz.isMine} disabled={buzz.status !== "active"} /> : null}
      {buzz.supportLink ? <SupportLink /> : null}
      {linkToThread && buzz.topReply ? <TopReply reply={buzz.topReply} onPress={() => openThread(router, buzz.threadId, buzz.topReply?.id)} /> : null}
      <View style={styles.footer}>
        <VoteCluster item={buzz} />
        <ReplyCountButton count={buzz.replyCount} onPress={open} answers={buzz.isPromptThread === true} />
        <View style={styles.flex} />
        <ShareButton buzz={buzz} />
      </View>
    </View>
  );
});

/**
 * "Top reply" under the buzz: a bar in the anon's colour, "Top reply · ▲ 18", who (their thread alias, OP, or you) and
 * the first two lines of the words. A tap opens the thread at that reply.
 */
function TopReply({ reply, onPress }: { reply: BuzzTopReply; onPress: () => void }) {
  const who = `${reply.isMine ? "You, " : ""}${reply.alias.label}${reply.isOp ? ", original poster" : ""}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Top reply, ${reply.score} points. ${who}: ${reply.text}`}
      accessibilityHint="Opens the thread at this reply"
      style={({ pressed }) => [styles.top, pressed && styles.pressed]}
    >
      <View style={[styles.topBar, { backgroundColor: reply.alias.color }]} />
      <View style={styles.topBody}>
        <View style={styles.topHead}>
          <Icon name="chatbubble" size={12} color={P.accentInk} />
          <Text style={[T.overline, { color: P.accentInk }]}>Top reply</Text>
          <Icon name="arrow-up" size={12} color={P.ink3} />
          <Text style={[T.caption, { color: P.ink3, fontVariant: ["tabular-nums"] }]}>{compactCount(reply.score)}</Text>
        </View>
        <View style={styles.topWho}>
          <AliasAvatar alias={reply.alias} size="xs" />
          <Text style={[T.labelSm, styles.shrink, { color: P.ink }]} numberOfLines={1}>
            {reply.isMine ? <Text style={{ color: P.accentInk }}>You · </Text> : null}
            {reply.alias.label}
          </Text>
          {reply.isOp ? <OpBadge /> : null}
        </View>
        <Text style={[T.body, { color: P.ink2 }]} numberOfLines={2}>
          {reply.text}
        </Text>
      </View>
    </Pressable>
  );
}

/** A card for the buzz with this id, as the item store holds it (a vote anywhere redraws only this card). */
export const BuzzCardById = memo(function BuzzCardById({ id }: { id: string }) {
  const buzz = useBuzzItem<Buzz>(id);
  if (!buzz || buzz.kind !== "buzz") return null;
  return <BuzzCard buzz={buzz} />;
});

export function BuzzCardSkeleton() {
  return (
    <View style={styles.card} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.skeletonHead}>
        <Skeleton w={28} h={28} circle />
        <Skeleton w={110} h={14} />
        <Skeleton w={28} h={12} />
      </View>
      <View style={{ gap: 8 }}>
        <Skeleton w="100%" h={14} />
        <Skeleton w="92%" h={14} />
        <Skeleton w="60%" h={14} />
      </View>
      <View style={styles.skeletonHead}>
        <Skeleton w={104} h={36} radius={R.pill} />
        <Skeleton w={64} h={20} />
      </View>
    </View>
  );
}

/** One of your replies in My buzzes: what it replied in, then the reply itself with its votes. */
export const MyReplyCard = memo(function MyReplyCard({ id, snippet }: { id: string; snippet: string }) {
  const router = useRouter();
  const reply = useBuzzItem<BuzzReply>(id);
  if (!reply || reply.kind !== "reply") return null;
  return (
    <View style={styles.card} accessibilityLabel="Your reply">
      <Pressable onPress={() => openThread(router, reply.threadId)} accessibilityRole="button" accessibilityLabel={`${BUZZ_MINE_COPY.replyingIn}: ${snippet || BUZZ_MINE_COPY.threadUnavailable}`} accessibilityHint="Opens the thread" style={({ pressed }) => [styles.replyingIn, pressed && styles.pressed]}>
        <Text style={[T.caption, { color: P.ink3 }]}>{BUZZ_MINE_COPY.replyingIn}</Text>
        <Text style={[T.footnote, { color: P.ink2 }]} numberOfLines={2}>
          {snippet ? buzzHeadline({ title: "", text: snippet }, 160) : BUZZ_MINE_COPY.threadUnavailable}
        </Text>
      </Pressable>
      <AliasLine alias={reply.alias} isMine={reply.isMine} isOp={reply.isOp} createdAt={reply.createdAt} trailing={<StatusChip status={reply.status} />} />
      <BuzzText text={reply.text} status={reply.status} clamp />
      <View style={styles.footer}>
        <VoteCluster item={reply} />
      </View>
    </View>
  );
});

export const CARD_GAP = 12;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: 12, padding: 16, borderRadius: R.lg, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: P.line, backgroundColor: P.surface1 },
  folded: { padding: 8 },
  trailing: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0, marginRight: -8 },
  pressed: { opacity: 0.85 },
  shrink: { flexShrink: 1 },
  top: { flexDirection: "row", gap: 10, padding: 12, borderRadius: R.md, borderCurve: "continuous", backgroundColor: P.surface2 },
  topBar: { width: 3, borderRadius: 1.5, opacity: 0.7 },
  topBody: { flex: 1, minWidth: 0, gap: 6 },
  topHead: { flexDirection: "row", alignItems: "center", gap: 5 },
  topWho: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  footer: { flexDirection: "row", alignItems: "center", gap: 4 },
  skeletonHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  replyingIn: { gap: 2 },
});
