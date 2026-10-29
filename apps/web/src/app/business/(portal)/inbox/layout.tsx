import { redirect } from "next/navigation";
import { businessConversations, getInquiryDetails, inquiryNeedsReply, listConversations, listTeam, standingOf, teamRoleAllows } from "@apartment-book/shared";
import { getPortalBase, portalPath, requireBusiness } from "@/lib/business/portal";
import { joinPortal } from "@/lib/business/paths";
import { createClient } from "@/lib/supabase/server";
import { InboxPending } from "@/components/business/inbox-pending";
import { InquiryList, type InquiryItem } from "@/components/business/inquiry-list";
import { MessagesPathsProvider } from "@/components/messages/messages-paths";
import { MessagesShell } from "@/components/messages/messages-shell";

/**
 * The business's inbox: its own list (filters, search, what each chat is about, who wrote last) beside the student
 * site's chat window, pointed at the portal's paths. Every chat here was started by a student, from a listing, a post,
 * an ad or the profile; the database lets the business read it only once the student has written, and write only in
 * reply. The team members who reply (the owner, admins, editors) answer together; analysts never see it. While the
 * business waits for review it is already in the sidebar, saying it opens on approval (students write only to an
 * approved business); the chats themselves stay closed until then, here and in the database.
 */
export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const { user, membership } = await requireBusiness("/inbox");
  if (!teamRoleAllows(membership.role, "reply")) redirect(await portalPath("/"));
  if (standingOf(membership.business) !== "approved") return <InboxPending businessName={membership.business.name} />;
  const supabase = await createClient();
  const [conversations, team, base] = await Promise.all([listConversations(supabase, user.id), listTeam(supabase, membership.business.id), getPortalBase()]);
  const teamIds = new Set(team.map((m) => m.user_id));
  // A chat with no message yet is a student who tapped "Message" and has not written. Migration 56 hides it in the
  // database; leaving it out here keeps the inbox the same on a database without 56.
  const inbox = businessConversations(conversations, membership.business.id, teamIds).filter((c) => c.lastMessageAt);
  const details = await getInquiryDetails(
    supabase,
    inbox.map((c) => c.id),
  ).catch(() => ({}) as Awaited<ReturnType<typeof getInquiryDetails>>);
  const firstNames = new Map(team.map((m) => [m.user_id, m.profile?.full_name?.split(" ")[0] || "A teammate"]));
  const items: InquiryItem[] = inbox.map((c) => {
    const last = details[c.id]?.lastSenderId ?? null;
    return {
      conversation: c,
      target: details[c.id]?.target ?? null,
      needsReply: inquiryNeedsReply(last, teamIds),
      lastBy: last === user.id ? "You" : last && teamIds.has(last) ? (firstNames.get(last) ?? null) : null,
    };
  });
  return (
    <MessagesPathsProvider
      value={{ base: joinPortal(base, "/inbox"), newChat: null, profile: null, audience: "business", emptyText: "No inquiries yet. Students message you from your profile, posts, listings and ads; every one lands here." }}
    >
      {/* Beside the sidebar on wide screens; under the portal's top bar (and with no tab bar) on smaller ones. */}
      <MessagesShell list={<InquiryList items={items} />} className="lg:left-[var(--biz-sidebar-width)] lg:top-0" bottomBar={false}>
        {children}
      </MessagesShell>
    </MessagesPathsProvider>
  );
}
