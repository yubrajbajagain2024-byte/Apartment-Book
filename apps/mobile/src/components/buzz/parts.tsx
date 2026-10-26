import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import {
  BUZZ_FEED_COPY,
  BUZZ_STATUS_CHIPS,
  buzzPlaceholder,
  buzzPollCaption,
  buzzReplyCountLabel,
  compactCount,
  type Buzz,
  type BuzzAlias,
  type BuzzItemStatus,
  type BuzzPoll,
  type BuzzReply,
} from "@apartment-book/shared";
import { Icon, useBounceOn } from "@/components/icon";
import { useReduceMotion } from "@/lib/accessibility";
import { buzzTime, openGuidelines, shareBuzz, voteOnBuzz, voteOnPoll } from "@/lib/buzz-actions";
import { buzzState, useBuzzState } from "@/lib/buzz-store";
import { Badge, OpBadge, P, PIconButton, R, T, withAlpha, type BadgeTone } from "./ui";

/*
 * Buzz item building blocks (UniVerse's features/buzz/parts.tsx): the alias header, the text and its placeholders, the
 * folds, the vote cluster, the poll, the support link and the author-only status chip. Nothing in here ever renders a
 * photo of a person, a name, a handle or a link to a profile.
 */

type Item = Buzz | BuzzReply;

/* ───────────────────────────── alias ───────────────────────────── */

const AVATAR = { sm: 28, md: 36 } as const;

/**
 * An alias's mark: its emoji in a dashed ring of its colour over a 16% tint of it. Never an image and never pressable,
 * so an anonymous surface can never be handed a person.
 */
export const AliasAvatar = memo(function AliasAvatar({ alias, size = "sm" }: { alias: BuzzAlias; size?: keyof typeof AVATAR }) {
  const px = AVATAR[size];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: px, height: px, borderRadius: px / 2, borderWidth: 1.5, borderStyle: "dashed", borderColor: alias.color, backgroundColor: withAlpha(alias.color, 0.16), alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ fontSize: Math.round(px * 0.5), lineHeight: Math.round(px * 0.62) }} allowFontScaling={false}>
        {alias.emoji}
      </Text>
    </View>
  );
});

/** "You · Anon Key", OP, "· Sep 28", then the row's trailing pieces (a campus badge, the status chip, the "…"). */
export function AliasLine({ alias, isMine, isOp, createdAt, trailing, size = "sm" }: { alias: BuzzAlias; isMine: boolean; isOp?: boolean; createdAt: number; trailing?: ReactNode; size?: "sm" | "md" }) {
  const when = buzzTime(createdAt);
  const label = `${isMine ? "You, " : ""}${alias.label}${isOp ? ", original poster" : ""}, ${when}`;
  return (
    <View style={styles.aliasRow}>
      <AliasAvatar alias={alias} size={size} />
      <View style={styles.aliasText} accessible accessibilityLabel={label}>
        <Text style={[T.labelSm, styles.shrink, { color: P.ink }, size === "md" && styles.aliasMd]} numberOfLines={1}>
          {isMine ? <Text style={{ color: P.accentInk }}>You</Text> : null}
          {isMine ? <Text style={{ color: P.ink4 }}> · </Text> : null}
          {alias.label}
        </Text>
        {isOp ? <OpBadge /> : null}
        <Text style={{ color: P.ink4 }}>·</Text>
        <Text style={[T.caption, { color: P.ink3 }]} numberOfLines={1}>
          {when}
        </Text>
      </View>
      {trailing}
    </View>
  );
}

/* ───────────────────────────── text ───────────────────────────── */

/** Lines a feed card shows before "Show more". */
const CLAMP_LINES = 6;

/**
 * The words of an item, or its placeholder ("[removed by moderators]") when other viewers may not read them. Clamped,
 * it shows six lines and a "Show more" that opens the rest in place (a hidden copy counts the lines, so the toggle only
 * appears when there really is more).
 */
export function BuzzText({ text, status, clamp, large }: { text: string; status: BuzzItemStatus; clamp?: boolean; large?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [folds, setFolds] = useState(false);
  const placeholder = buzzPlaceholder({ text, status });
  if (placeholder) return <Text style={[T.body, styles.placeholder]}>{placeholder}</Text>;
  const style = [large ? T.bodyLg : T.body, { color: P.ink }];
  // Short words cannot need the fold: skip the measuring copy for them.
  const measure = Boolean(clamp) && (text.length > 180 || (text.match(/\n/g)?.length ?? 0) >= CLAMP_LINES - 1);
  return (
    <View>
      <Text style={style} numberOfLines={clamp && !expanded ? CLAMP_LINES : undefined}>
        {text}
      </Text>
      {measure ? (
        <Text style={[style, styles.measure]} onTextLayout={(e) => setFolds(e.nativeEvent.lines.length > CLAMP_LINES)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
          {text}
        </Text>
      ) : null}
      {measure && folds ? (
        <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8} accessibilityRole="button" accessibilityState={{ expanded }} style={styles.more}>
          <Text style={[T.labelSm, { color: P.accentInk }]}>{expanded ? BUZZ_FEED_COPY.showLess : BUZZ_FEED_COPY.showMore}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A root's optional headline and its words (the words are left out when a titled buzz has none). */
export function BuzzContent({ buzz, clamp, large }: { buzz: Buzz; clamp?: boolean; large?: boolean }) {
  return (
    <View style={styles.content}>
      {buzz.title ? (
        <Text style={[large ? T.title3 : T.headline, { color: P.ink }]} accessibilityRole="header">
          {buzz.title}
        </Text>
      ) : null}
      {buzz.text || !buzz.title ? <BuzzText text={buzz.text} status={buzz.status} clamp={clamp} large={large} /> : null}
    </View>
  );
}

/* ───────────────────────────── folds ───────────────────────────── */

/**
 * A community-collapsed item (or a reply from an anon you hid in this thread), folded to one line: "Hidden by the
 * community · Tap to view". Opened, it stays open for the session.
 */
export function CollapsedFold({ id, reason, children }: { id: string; reason: "community" | "anon"; children: ReactNode }) {
  const revealed = useBuzzState(useCallback((s) => s.revealed[id] === true, [id]));
  if (revealed) return <>{children}</>;
  const label = reason === "community" ? BUZZ_FEED_COPY.collapsedCommunity : BUZZ_FEED_COPY.collapsedAnon;
  return (
    <Pressable onPress={() => buzzState.reveal(id)} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={BUZZ_FEED_COPY.tapToView} style={({ pressed }) => [styles.fold, pressed && { opacity: 0.8 }]}>
      <Icon name="eye-off-outline" size={16} color={P.ink3} />
      <Text style={[T.footnote, styles.flex, { color: P.ink3 }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[T.footnote, { color: P.accentInk }]}>{BUZZ_FEED_COPY.tapToView}</Text>
    </Pressable>
  );
}

/* ───────────────────────────── votes ───────────────────────────── */

/**
 * Up, the score, down in one pill. Optimistic (the arrow lights at once, a failure puts back the server's numbers), tap
 * the lit arrow again to take the vote back. Your own items and items under review are not voted on: the arrows dim.
 * Up is lime, down coral.
 */
export function VoteCluster({ item, size = "sm" }: { item: Item; size?: "sm" | "md" }) {
  const up = item.myVote === 1;
  const down = item.myVote === -1;
  const disabled = item.isMine || item.status !== "active";
  const upBounce = useBounceOn(up);
  const downBounce = useBounceOn(down);
  const height = size === "sm" ? 36 : 44;
  const upColor = up ? P.accentInk : P.ink3;
  const downColor = down ? P.down : P.ink3;
  // Screen readers hear what is voted on: "Upvote" on a buzz, "Upvote reply" on a reply.
  const noun = item.kind === "reply" ? " reply" : "";
  return (
    <View style={[styles.votes, { height }]} accessibilityRole="toolbar" accessibilityLabel="Votes">
      <Pressable
        onPress={() => voteOnBuzz(item.id, 1)}
        disabled={disabled}
        hitSlop={{ top: 6, bottom: 6, left: 6 }}
        accessibilityRole="button"
        accessibilityLabel={up ? `Remove upvote${noun}` : `Upvote${noun}`}
        accessibilityState={{ selected: up, disabled }}
        style={[styles.arrow, styles.arrowLeft, disabled && styles.dim]}
      >
        <Icon name="arrow-up" sf={up ? "arrowshape.up.fill" : "arrowshape.up"} size={20} weight="medium" bounce={upBounce} color={upColor} fallback={<MaterialCommunityIcons name={up ? "arrow-up-bold" : "arrow-up-bold-outline"} size={21} color={upColor} />} />
      </Pressable>
      <Text style={[T.labelSm, styles.score, { color: up ? P.accentInk : down ? P.down : P.ink2 }]} accessibilityLabel={`Score ${item.score}`}>
        {compactCount(item.score)}
      </Text>
      <Pressable
        onPress={() => voteOnBuzz(item.id, -1)}
        disabled={disabled}
        hitSlop={{ top: 6, bottom: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel={down ? `Remove downvote${noun}` : `Downvote${noun}`}
        accessibilityState={{ selected: down, disabled }}
        style={[styles.arrow, styles.arrowRight, disabled && styles.dim]}
      >
        <Icon name="arrow-down" sf={down ? "arrowshape.down.fill" : "arrowshape.down"} size={20} weight="medium" bounce={downBounce} color={downColor} fallback={<MaterialCommunityIcons name={down ? "arrow-down-bold" : "arrow-down-bold-outline"} size={21} color={downColor} />} />
      </Pressable>
    </View>
  );
}

/* ───────────────────────────── poll ───────────────────────────── */

/**
 * A poll: tap an option to vote (once, no changing it). Results stay hidden until you have voted, it has closed, or it
 * is your own; then each option fills to its share, yours in lime. The caption under it: "Vote to see results · 3d
 * left", "25 votes · 5h left", "Poll closed · 25 votes".
 */
export function PollView({ threadId, poll, isMine, disabled }: { threadId: string; poll: BuzzPoll; isMine: boolean; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const canVote = !poll.closed && !isMine && poll.myChoice === null && !disabled;
  const vote = (optionId: string) => {
    if (busy) return;
    setBusy(true);
    void voteOnPoll(threadId, optionId).finally(() => setBusy(false));
  };
  const caption = buzzPollCaption(poll);
  return (
    <View style={styles.poll} accessibilityLabel="Poll">
      {poll.options.map((o) => {
        const chosen = poll.myChoice === o.id;
        const pct = o.pct ?? 0;
        const row = (
          <>
            {poll.resultsVisible ? <PollBar pct={pct} chosen={chosen} /> : null}
            <Text style={[T.body, styles.flex, { color: chosen ? P.accentInk : P.ink }]} numberOfLines={2}>
              {o.text}
            </Text>
            {poll.resultsVisible ? <Text style={[T.labelSm, styles.pct]}>{pct}%</Text> : null}
          </>
        );
        return canVote ? (
          <Pressable
            key={o.id}
            onPress={() => vote(o.id)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Vote: ${o.text}`}
            accessibilityState={{ disabled: busy }}
            style={({ pressed }) => [styles.option, styles.optionOpen, pressed && { borderColor: P.accentLine }, busy && styles.dim]}
          >
            {row}
          </Pressable>
        ) : (
          <View key={o.id} style={[styles.option, chosen && styles.optionChosen]} accessible accessibilityLabel={poll.resultsVisible ? `${o.text}, ${pct} percent${chosen ? ", your vote" : ""}` : o.text}>
            {row}
          </View>
        );
      })}
      <Text style={[T.caption, { color: P.ink3 }]}>{caption}</Text>
    </View>
  );
}

/** An option's share, growing in from the left once the results show (still under Reduce Motion). */
function PollBar({ pct, chosen }: { pct: number; chosen: boolean }) {
  const reduce = useReduceMotion();
  const [width, setWidth] = useState(0);
  const grow = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    grow.value = reduce ? 1 : withTiming(1, { duration: 300 });
  }, [reduce, grow]);
  const bar = useAnimatedStyle(() => ({ width: (width * Math.max(0, Math.min(100, pct)) * grow.value) / 100 }));
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Reanimated.View style={[styles.bar, { backgroundColor: chosen ? P.accentSoft : P.surface3 }, bar]} />
    </View>
  );
}

/* ───────────────────────────── support, status, footer bits ───────────────────────────── */

/** "Support resources": the item's words touched on self-harm; the guidelines' support section opens. */
export function SupportLink() {
  return (
    <Pressable onPress={() => openGuidelines("self-harm")} accessibilityRole="link" accessibilityLabel={BUZZ_FEED_COPY.supportLink} accessibilityHint="Opens the support resources in the Community Guidelines" style={({ pressed }) => [styles.support, pressed && { opacity: 0.8 }]}>
      <MaterialCommunityIcons name="hand-heart-outline" size={15} color={P.accentInk} />
      <Text style={[T.caption, { color: P.accentInk }]}>{BUZZ_FEED_COPY.supportLink}</Text>
    </Pressable>
  );
}

const STATUS_TONE: Partial<Record<BuzzItemStatus, BadgeTone>> = { held: "warning", hidden: "warning", removed: "danger" };

/** The author-only chip on your own held / hidden / removed items. Nothing for active or deleted ones. */
export function StatusChip({ status }: { status: BuzzItemStatus }) {
  const label = BUZZ_STATUS_CHIPS[status];
  if (!label) return null;
  return <Badge label={label} tone={STATUS_TONE[status] ?? "neutral"} />;
}

/** "5 replies" in the card's footer: opens the thread. */
export function ReplyCountButton({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${count} ${buzzReplyCountLabel(count)}`} accessibilityHint="Opens the thread" style={({ pressed }) => [styles.replies, pressed && { backgroundColor: P.surface2 }]}>
      <Text style={[T.labelSm, { color: P.ink2 }]}>{compactCount(count)}</Text>
      <Text style={[T.footnote, { color: P.ink3 }]}>{buzzReplyCountLabel(count)}</Text>
    </Pressable>
  );
}

/** Share: the thread's link through the system sheet. Only for active roots. */
export function ShareButton({ buzz }: { buzz: Buzz }) {
  if (buzz.status !== "active") return null;
  return <PIconButton icon="share-outline" label="Share" onPress={() => shareBuzz(buzz)} size={40} iconSize={20} color={P.ink2} />;
}

/** The "…" that opens an item's menu. */
export function MoreButton({ onPress }: { onPress: () => void }) {
  return <PIconButton icon="ellipsis-horizontal" label="More options" onPress={onPress} size={36} iconSize={20} color={P.ink3} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  aliasRow: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  aliasText: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  aliasMd: { fontSize: 15 },
  placeholder: { color: P.ink4, fontStyle: "italic" },
  measure: { position: "absolute", top: 0, left: 0, right: 0, opacity: 0 },
  more: { alignSelf: "flex-start", marginTop: 4, paddingVertical: 2 },
  content: { gap: 6 },
  fold: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: R.md, borderCurve: "continuous", backgroundColor: P.surface2 },
  votes: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", borderRadius: R.pill, backgroundColor: P.surface2 },
  arrow: { height: "100%", minWidth: 44, alignItems: "center", justifyContent: "center" },
  arrowLeft: { paddingLeft: 4 },
  arrowRight: { paddingRight: 4 },
  score: { minWidth: 24, textAlign: "center", fontVariant: ["tabular-nums"] },
  dim: { opacity: 0.45 },
  poll: { gap: 6 },
  option: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: R.md, borderCurve: "continuous", overflow: "hidden", backgroundColor: P.surface2 },
  optionOpen: { borderWidth: 1, borderColor: P.line },
  optionChosen: { borderWidth: 1, borderColor: P.accentLine },
  bar: { position: "absolute", top: 0, bottom: 0, left: 0, borderRadius: R.md },
  pct: { color: P.ink2, fontVariant: ["tabular-nums"] },
  support: { alignSelf: "flex-start", minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: R.pill, backgroundColor: P.accentSoft },
  replies: { height: 36, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, borderRadius: R.pill },
});
