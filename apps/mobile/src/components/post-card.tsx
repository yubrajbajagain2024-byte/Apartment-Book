import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { FeedMedia, PostEngagement, PostTargetType } from "@apartment-book/shared";
import { shortDate } from "@/lib/short-date";
import { makeStyles } from "@/lib/theme-provider";
import { ExpandableText } from "./expandable-text";
import { useListingActions } from "./listing-actions";
import { PhotoCarousel } from "./photo-carousel";
import { POST_GUTTER, POST_TEXT, PostActions, PostFrame, PostHeader } from "./post-bits";

export type PostCardProps = {
  targetType: PostTargetType;
  targetId: string;
  /** Web path, e.g. /roommates/abc, used for sharing and for opening the detail screen. */
  path: string;
  /** `badge`: a business listing ("Sponsored" / "Verified Partner"); the business is the poster and has no profile to open. */
  poster: { id: string; name: string; avatarUrl: string | null; verified: boolean; badge?: string | null };
  /** The business behind a portal listing: Message opens its inquiry chat with the whole team. */
  businessId?: string | null;
  subtitle?: string;
  /** Listings have a title; Home-feed posts do not. */
  title?: string;
  lead?: string;
  description?: string | null;
  media: FeedMedia[];
  createdAt: string;
  saved: boolean;
  engagement?: PostEngagement;
  /** Extra chips under the text. */
  details?: React.ReactNode;
  active?: boolean;
  /** How much of the description shows before "more…": three lines by default, 0 to hide it whole behind the fold (roommate posts). */
  descriptionLines?: number;
  /** What the chat pill reads: "Message" by default, "Inbox" on roommate posts. */
  messageLabel?: string;
  /** The chat pill right after share instead of at the right (roommate posts). */
  messageBeside?: boolean;
  /** Whether the row has the comment button (the thread stays on the post's own screen either way); roommate posts leave it out. */
  comments?: boolean;
};

/** Side padding for a feed's header (search, chips, composer): the posts keep their own gutter. */
export const FEED_HEADER_PADDING = 12;

/**
 * A roommate post in a feed, laid out like the posts on Home (see post-bits): header → title, price line and the
 * description folded to three lines ("more…" / "less") with its chips → the photos or video in a rounded frame → heart,
 * comment and share with their counts, the chat pill (not on your own post) and the bookmark. No card box: posts follow
 * each other on the screen with room between them. (Apartments have their own card: housing/housing-card.tsx.)
 */
export function PostCard(props: PostCardProps) {
  const { poster, title, lead, description, media, createdAt, path } = props;
  const styles = useStyles();
  const router = useRouter();
  const actions = useListingActions({ targetType: props.targetType, targetId: props.targetId, path, poster, businessId: props.businessId, title, lead, description, media, engagement: props.engagement, saved: props.saved });
  const { like, save, own, openDetail } = actions;
  const text = description?.trim() ?? "";
  // "1.2 mi from campus · San Marcos · Oct 2"
  const meta = [props.subtitle, shortDate(createdAt)].filter(Boolean).join(" · ");

  return (
    <View style={styles.post} accessibilityLabel={`Post: ${title ?? description?.slice(0, 40) ?? "post"}`}>
      <PostHeader name={poster.name} avatarUrl={poster.avatarUrl} userId={poster.id} verified={poster.verified} badge={poster.badge} meta={meta} onOpen={() => (poster.badge ? openDetail() : router.push({ pathname: "/profile/[id]", params: { id: poster.id } }))} onMenu={actions.menu} />

      {/* The words come before the picture, Facebook style; a tap on them opens the listing. */}
      <Pressable onPress={() => openDetail()} style={styles.body}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {lead ? <Text style={styles.lead}>{lead}</Text> : null}
        {text ? (
          <ExpandableText style={styles.description} lines={props.descriptionLines ?? 3}>
            {text}
          </ExpandableText>
        ) : null}
        {props.details ? <View style={styles.details}>{props.details}</View> : null}
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
  body: { paddingHorizontal: POST_GUTTER, paddingTop: 2, paddingBottom: 12, gap: 3 },
  // The title reads like a Home post's words: the same size and weight, nothing bold.
  title: { ...POST_TEXT, color: colors.text },
  lead: { fontSize: 14, fontWeight: "700", color: colors.brand },
  description: { ...POST_TEXT, color: colors.text },
  details: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 6 },
}));
