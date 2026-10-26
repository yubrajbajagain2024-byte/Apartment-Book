import { useRouter } from "expo-router";
import { APP_NAME, getOrCreateDirectConversation, inquiryPrefill, recordContact, REPORT_REASONS, reportContent, sharedPostFromListing, startListingConversation, type FeedMedia, type PostEngagement, type PostTargetType, type ReportReason, type SharedPost } from "@apartment-book/shared";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { useActionSheet } from "./action-sheet";
import { useLike, useSave } from "./engagement";
import { firstImageOf, useShareSheet } from "./share-sheet";

export type ListingActionsInput = {
  targetType: PostTargetType;
  targetId: string;
  /** Web path, e.g. /apartments/abc: the detail screen it opens and the link it shares. */
  path: string;
  poster: { id: string; name: string; avatarUrl: string | null };
  /** The business behind a portal listing: the chat is its inquiry chat with the whole team. */
  businessId?: string | null;
  title?: string;
  /** The price line (or another short line) the share card carries. */
  lead?: string;
  description?: string | null;
  media: FeedMedia[];
  engagement?: PostEngagement;
  saved: boolean;
};

/**
 * Everything a post in a feed can do, the same on every card: like and save (optimistic, with the sign-in prompt), open
 * the post (on its comments if asked), the chat with whoever posted it (the business's inquiry chat for a portal listing,
 * your own Inbox on your own listing), the friends share sheet, and reporting.
 */
export function useListingActions(p: ListingActionsInput) {
  const router = useRouter();
  const show = useActionSheet();
  const shareSheet = useShareSheet();
  const { user } = useSession();
  const needLogin = () => router.push("/(auth)/login");
  const like = useLike(p.targetType, p.targetId, p.engagement, user?.id ?? null, needLogin);
  const save = useSave(p.targetType, p.targetId, p.saved, user?.id ?? null, needLogin);
  const own = user?.id === p.poster.id;
  const text = p.description?.trim() ?? "";

  const openDetail = (focusComments = false) => router.push({ pathname: p.path as never, params: focusComments ? { comment: "1" } : {} } as never);

  async function message() {
    if (!user) return needLogin();
    if (own) return router.push("/messages");
    try {
      const business = p.businessId && p.targetType === "apartment" ? p.businessId : null;
      const id = business ? await startListingConversation(supabase, { targetType: "apartment", targetId: p.targetId, posterId: p.poster.id, businessId: business }) : await getOrCreateDirectConversation(supabase, p.poster.id);
      // Counted on the listing's own numbers (its owner's "messages"); a feed post has none.
      if (p.targetType !== "post") recordContact(supabase, p.targetType, p.targetId).catch(() => {});
      const first = p.poster.name.split(" ")[0];
      const prefill = business && p.title ? inquiryPrefill(p.poster.name, p.title) : p.title ? `Hi ${first}! I saw your post "${p.title}" and I'd like to chat.` : `Hi ${first}! I saw your post and I'd like to chat.`;
      router.push({ pathname: "/messages/[id]", params: { id, prefill, ...(p.targetType === "post" ? {} : { targetType: p.targetType, targetId: p.targetId }) } });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not open the chat");
    }
  }

  /** The friends sheet, with the card's title, price line (or description) and first picture; its "Share to…" row is the system share. */
  function share() {
    const author = { id: p.poster.id, name: p.poster.name, avatar_url: p.poster.avatarUrl };
    const imageUrl = firstImageOf(p.media);
    const caption = p.lead || text || null;
    const shared: SharedPost =
      p.targetType === "post"
        ? { target_type: "post", target_id: p.targetId, kind: "post", path: p.path, title: null, caption, image_url: imageUrl, author }
        : sharedPostFromListing({ targetType: p.targetType, targetId: p.targetId, title: p.title ?? p.poster.name, caption, imageUrl, author });
    shareSheet.open(shared, { url: `${SITE_URL}${p.path}`, label: p.title ?? APP_NAME });
  }

  function report() {
    if (!user) return needLogin();
    show(
      REPORT_REASONS.map((r) => ({
        label: r.label,
        onPress: async () => {
          await reportContent(supabase, user.id, { targetType: p.targetType, targetId: p.targetId, reason: r.value as ReportReason }).catch(() => {});
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

  return { like, save, own, openDetail, message, share, report, menu };
}
