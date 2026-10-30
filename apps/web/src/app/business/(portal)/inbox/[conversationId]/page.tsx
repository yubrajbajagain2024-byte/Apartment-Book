import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { businessInboxView, getConversation, getInquiryDetails, listMessages } from "@apartment-book/shared";
import { portalTeam } from "@/lib/business/data";
import { requireCapability } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { InquiryContext } from "@/components/business/inquiry-context";
import { ChatWindow } from "@/components/messages/chat-window";
import { ConversationHeader } from "@/components/messages/conversation-header";

type Props = { params: Promise<{ conversationId: string }> };

export const metadata: Metadata = { title: "Inbox" };

/**
 * One inquiry: the student, what they asked about, and the chat. Messages arrive and send in real time (the shared chat
 * window), the team's own on the right; the database refuses a business message until the student has written.
 */
export default async function InquiryPage({ params }: Props) {
  const { conversationId } = await params;
  const { user, membership } = await requireCapability("reply", `/inbox/${conversationId}`);
  const supabase = await createClient();
  // One round trip for everything the page needs: the database answers each read for this member alone, so the checks
  // below only decide what to show, not what was read.
  const [conversation, team, messages, details] = await Promise.all([
    getConversation(supabase, conversationId, user.id),
    portalTeam(membership.business.id),
    listMessages(supabase, conversationId),
    getInquiryDetails(supabase, [conversationId]).catch(() => null),
  ]);
  // Not until the student has written (the inbox's rule, and migration 56's in the database).
  if (!conversation || conversation.business?.id !== membership.business.id || !conversation.lastMessageAt) notFound();
  const view = businessInboxView(conversation, new Set(team.map((m) => m.user_id)));
  const target = details?.[conversationId]?.target ?? null;

  return (
    <>
      <ConversationHeader conversation={view} currentUserId={user.id} />
      {target ? <InquiryContext target={target} /> : null}
      <ChatWindow key={conversationId} conversation={view} currentUserId={user.id} initialMessages={messages} teamIds={team.map((m) => m.user_id)} />
    </>
  );
}
