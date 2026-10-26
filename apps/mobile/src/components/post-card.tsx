import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { FeedMedia, PostEngagement, PostTargetType } from "@apartment-book/shared";
import { shortDate } from "@/lib/short-date";
import { makeStyles } from "@/lib/theme-provider";
import { useListingActions } from "./listing-actions";
import { PhotoCarousel } from "./photo-carousel";
import { POST_GUTTER, PostActions, PostFrame, PostHeader } from "./post-bits";

export type PostCardProps = {
  targetType: PostTargetType;
  targetId: string;
  /** Web path, e.g. /roommates/abc, used for sharing and for opening the detail screen. */
  path: string;
  /** `badge`: a business listing ("Sponsored" / "Verified Partner"); the business is the poster and has no profile to open. */
  poster: { id: string; name: string; avatarUrl: string | null; verified: boolean; badge?: string | null };
  /** The business behind a portal listing: Message opens its inquiry chat with the whole team. */
  businessId?: string | null;
  /** Under the poster's name, before the age: what kind of post it is ("Has a Room"), or an item's price. */
  subtitle?: string;
  /** Listings have a title; Home-feed posts do not. */
  title?: string;
  /** A short line for the share card (the price, the budget): not shown on the post itself. */
  lead?: string;
  description?: string | null;
  media: FeedMedia[];
  createdAt: string;
  saved: boolean;
  engagement?: PostEngagement;
  active?: boolean;
  /** What the chat pill reads: "Message" by default, "Inbox" on roommate posts. */
  messageLabel?: string;
  /** The chat pill right after share instead of at the right (roommate posts). */
  messageBeside?: boolean;
  /** Whether the row has the comment button (the thread stays on the post's own screen either way); roommate posts leave it out. */
  comments?: boolean;
};

/** Side padding for a feed's header (search, chips, composer): the posts keep their own gutter. */
export const FEED_HEADER_PADDING = 12;

/** How much of the description a feed shows, as a Buzz post does: three lines, then "…" (the rest is on the post's page). */
const PREVIEW_LINES = 3;

/**
 * A roommate post or a Marketplace item in a feed, captioned the way a Buzz post is: the header (the poster, what kind of
 * post it is or the price, and its age) → the title in bold and the start of the description, muted, three lines at most
 * → the photos or video in a rounded frame → heart, comment and share with their counts, the chat pill (not on your own
 * post) and the bookmark. Nothing else: the budget, the place, the dates and the details are on the post's own page. No
 * card box: posts follow each other on the screen with room between them. (Apartments have their own card:
 * housing/housing-card.tsx.)
 */
export function PostCard(props: PostCardProps) {
  const { poster, title, lead, description, media, createdAt, path } = props;
  // "Has a Room · 2d", "$65 · 3h"
  const styles = useStyles();
  const router = useRouter();
  const actions = useListingActions({ targetType: props.targetType, targetId: props.targetId, path, poster, businessId: props.businessId, title, lead, description, media, engagement: props.engagement, saved: props.saved });
  const { like, save, own, openDetail } = actions;
  const text = description?.trim() ?? "";
  const meta = [props.subtitle, shortDate(createdAt)].filter(Boolean).join(" · ");

  return (
    <View style={styles.post} accessibilityLabel={`Post: ${title ?? description?.slice(0, 40) ?? "post"}`}>
      <PostHeader name={poster.name} avatarUrl={poster.avatarUrl} userId={poster.id} verified={poster.verified} badge={poster.badge} meta={meta} onOpen={() => (poster.badge ? openDetail() : router.push({ pathname: "/profile/[id]", params: { id: poster.id } }))} onMenu={actions.menu} />

      {/* The words come before the picture, as on a Buzz post; a tap on them opens the listing. */}
      <Pressable onPress={() => openDetail()} style={styles.body}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {text ? (
          <Text style={styles.description} numberOfLines={PREVIEW_LINES}>
            {text}
          </Text>
        ) : null}
      </Pressable>

      {media.length > 0 ? (
        <PostFrame>
          {/* The "Video tour" pill is for apartments: a roommate post's video is just a video. */}
          <PhotoCarousel media={media} onPress={() => openDetail()} active={props.active} videoLabel={props.targetType === "apartment" ? undefined : null} />
        </PostFrame>
      ) : null}

      {/* The chat pill is for reaching the owner: your own listing has none. */}
      <PostActions liked={like.liked} likes={like.likes} comments={props.engagement?.comments ?? 0} saved={save.saved} onLike={() => void like.toggle()} onComment={props.comments === false ? undefined : () => openDetail(true)} onShare={actions.share} onSave={() => void save.toggle()} message={own ? undefined : { label: props.messageLabel ?? "Message", onPress: () => void actions.message() }} messageBeside={props.messageBeside} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  post: { width: "100%", backgroundColor: colors.bg, paddingTop: 4, paddingBottom: 18 },
  // Buzz's caption: the bold title over the muted start of the words (see buzz-card.tsx).
  body: { paddingHorizontal: POST_GUTTER, paddingTop: 6, paddingBottom: 12, gap: 4 },
  title: { fontSize: 17, fontWeight: "700", lineHeight: 22, color: colors.text },
  description: { fontSize: 14, lineHeight: 20, color: colors.muted },
}));
