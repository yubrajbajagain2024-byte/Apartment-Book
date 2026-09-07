import { listConversations } from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ConversationList } from "@/components/messages/conversation-list";
import { MessagesShell } from "@/components/messages/messages-shell";

export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/messages");
  const conversations = await listConversations(await createClient(), user.id);
  return (
    <MessagesShell list={<ConversationList conversations={conversations} currentUserId={user.id} />}>
      {children}
    </MessagesShell>
  );
}
