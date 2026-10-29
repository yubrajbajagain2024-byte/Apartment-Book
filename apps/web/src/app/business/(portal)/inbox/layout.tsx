import { businessConversations, listConversations, listTeam } from "@apartment-book/shared";
import { getPortalBase, requireBusiness } from "@/lib/business/portal";
import { joinPortal } from "@/lib/business/paths";
import { createClient } from "@/lib/supabase/server";
import { ConversationList } from "@/components/messages/conversation-list";
import { MessagesPathsProvider } from "@/components/messages/messages-paths";
import { MessagesShell } from "@/components/messages/messages-shell";

/**
 * The business's inbox: the student site's Messages, with the same two-pane layout, list and chat window, pointed at
 * the portal's own paths. Every chat here was started by a student from a listing or a deal; the whole team sees and
 * answers it, and nobody can start one from this side.
 */
export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const { user, membership } = await requireBusiness("/inbox", ["approved"]);
  const supabase = await createClient();
  const [conversations, team, base] = await Promise.all([listConversations(supabase, user.id), listTeam(supabase, membership.business.id), getPortalBase()]);
  const inbox = businessConversations(conversations, membership.business.id, new Set(team.map((m) => m.user_id)));
  return (
    <MessagesPathsProvider
      value={{ base: joinPortal(base, "/inbox"), newChat: null, profile: null, audience: "business", emptyText: "No inquiries yet. Students message you from your listings and deals; every reply lands here." }}
    >
      {/* Beside the sidebar on wide screens; under the portal's top bar (and with no tab bar) on smaller ones. */}
      <MessagesShell list={<ConversationList conversations={inbox} currentUserId={user.id} />} className="lg:left-[var(--biz-sidebar-width)] lg:top-0" bottomBar={false}>
        {children}
      </MessagesShell>
    </MessagesPathsProvider>
  );
}
