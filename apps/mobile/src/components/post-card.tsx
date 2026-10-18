import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { APP_NAME, getOrCreateDirectConversation, reportContent, sharedPostFromListing, type FeedMedia, type PostEngagement, type ReportReason, type PostTargetType, type SharedPost, REPORT_REASONS } from "@apartment-book/shared";
import { useSession } from "@/lib/session";
import { shortDate } from "@/lib/short-date";
import { SITE_URL, supabase } from "@/lib/supabase";
import { space, type } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-provider";
import { useActionSheet } from "./action-sheet";
import { useLike, useSave } from "./engagement";
import { ExpandableText } from "./expandable-text";
import { PhotoCarousel } from "./photo-carousel";
import { POST_GUTTER, POST_TEXT, PostActions, PostFrame, PostHeader } from "./post-bits";
import { firstImageOf, useShareSheet } from "./share-sheet";

export type PostCardProps = {
  targetType: PostTargetType;
  targetId: string;
  /** Web path, e.g. /roommates/abc, used for sharing and for opening the detail screen. */
  path: string;
  poster: { id: string; name: string; avatarUrl: string | null; verified: boolean };
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
 * An apartment or roommate post in a feed, laid out like the posts on Home (see post-bits): header → the price line in
 * the serif, the title under it, and the description folded to three lines ("more…" / "less") with its chips → the photos or video in a rounded frame →
 * heart, comment and share with their counts, the chat pill (not on your own listing) and the bookmark. No card box: posts follow each other on the screen with room between them.
 */
export function PostCard(props: PostCardProps) {
  const { poster, title, lead, description, media, createdAt, path } = props;
  const styles = useStyles();
  const router = useRouter();
  const show = useActionSheet();
  const shareSheet = useShareSheet();
  const { user } = useSession();
  const needLogin = () => router.push("/(auth)/login");
  const like = useLike(props.targetType, props.targetId, props.engagement, user?.id ?? null, needLogin);
  const save = useSave(props.targetType, props.targetId, props.saved, user?.id ?? null, needLogin);
  const text = description?.trim() ?? "";
  const own = user?.id === poster.id;
  // "1.2 mi from campus · San Marcos · Oct 2"
  const meta = [props.subtitle, shortDate(createdAt)].filter(Boolean).join(" · ");

  const openDetail = (focusComments = false) => router.push({ pathname: path as never, params: focusComments ? { comment: "1" } : {} } as never);

  async function message() {
    if (!user) return needLogin();
    if (own) return router.push("/messages");
    try {
      const id = await getOrCreateDirectConversation(supabase, poster.id);
      router.push({ pathname: "/messages/[id]", params: { id, prefill: title ? `Hi ${poster.name.split(" ")[0]}! I saw your post "${title}" and I'd like to chat.` : `Hi ${poster.name.split(" ")[0]}! I saw your post and I'd like to chat.`, ...(props.targetType === "post" ? {} : { targetType: props.targetType, targetId: props.targetId }) } });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not open the chat");
    }
  }

  /** The friends sheet, with the card's title, price line (or description) and first picture; its "Share to…" row is the system share as before. */
  function share() {
    const author = { id: poster.id, name: poster.name, avatar_url: poster.avatarUrl };
    const imageUrl = firstImageOf(media);
    const caption = lead || text || null;
    const shared: SharedPost =
      props.targetType === "post"
        ? { target_type: "post", target_id: props.targetId, kind: "post", path, title: null, caption, image_url: imageUrl, author }
        : sharedPostFromListing({ targetType: props.targetType, targetId: props.targetId, title: title ?? poster.name, caption, imageUrl, author });
    shareSheet.open(shared, { url: `${SITE_URL}${path}`, label: title ?? APP_NAME });
  }

  function report() {
    if (!user) return needLogin();
    show(
      REPORT_REASONS.map((r) => ({
        label: r.label,
        onPress: async () => {
          await reportContent(supabase, user.id, { targetType: props.targetType, targetId: props.targetId, reason: r.value as ReportReason }).catch(() => {});
          alert("Thanks. Our team will review this post.");
        },
      })),
      "Why are you reporting this post?",
    );
  }

  function menu() {
    show([
      { label: save.saved ? "Unsave post" : "Save post", icon: save.saved ? "bookmark" : "bookmark-outline", onPress: () => void save.toggle() },
      { label: "Share post", icon: "share-outline", onPress: share },
      ...(own ? [] : [{ label: "Report post", icon: "flag-outline" as const, destructive: true, onPress: report }]),
    ]);
  }

  return (
    <View style={styles.post} accessibilityLabel={`Post: ${title ?? description?.slice(0, 40) ?? "post"}`}>
      <PostHeader name={poster.name} avatarUrl={poster.avatarUrl} userId={poster.id} verified={poster.verified} meta={meta} onOpen={() => router.push({ pathname: "/profile/[id]", params: { id: poster.id } })} onMenu={menu} />

      {/* The words come before the picture, Facebook style, price first like the detail screens; a tap on them opens the listing. */}
      <Pressable onPress={() => openDetail()} style={styles.body}>
        {lead ? <Text style={styles.lead}>{lead}</Text> : null}
        {title ? <Text style={styles.title}>{title}</Text> : null}
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
      <PostActions liked={like.liked} likes={like.likes} comments={props.engagement?.comments ?? 0} saved={save.saved} onLike={() => void like.toggle()} onComment={props.comments === false ? undefined : () => openDetail(true)} onShare={share} onSave={() => void save.toggle()} message={own ? undefined : { label: props.messageLabel ?? "Message", onPress: () => void message() }} messageBeside={props.messageBeside} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Posts follow each other on the screen with room between them, the same rhythm as the Home posts.
  post: { width: "100%", backgroundColor: colors.bg, paddingTop: space.xs, paddingBottom: 20 },
  body: { paddingHorizontal: POST_GUTTER, paddingTop: 2, paddingBottom: space.md, gap: 3 },
  // Listings read price first: the price (or lead) line is the card's one serif, the title a sans subheading under it.
  lead: { ...type.headline, color: colors.text },
  title: { ...type.subheading, color: colors.text },
  description: { ...POST_TEXT, color: colors.text },
  details: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, marginTop: 6 },
}));
