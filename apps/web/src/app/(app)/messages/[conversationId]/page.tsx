import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getConversation, listMessages } from "@apartment-book/shared";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/utils";
import { ChatWindow } from "@/components/messages/chat-window";
import { ConversationHeader } from "@/components/messages/conversation-header";

type Props = {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { conversationId } = await params;
  const user = await getCurrentUser();
  if (!user) return { title: "Conversation" };
  const conversation = await getConversation(await createClient(), conversationId, user.id).catch(() => null);
  return { title: conversation ? conversation.title : "Conversation" };
}

export default async function ConversationPage({ params, searchParams }: Props) {
  const [{ conversationId }, query] = await Promise.all([params, searchParams]);
  const user = await requireUser(`/messages/${conversationId}`);
  const supabase = await createClient();
  const conversation = await getConversation(supabase, conversationId, user.id);
  if (!conversation) notFound();
  const messages = await listMessages(supabase, conversationId);
  const prefill = messages.length === 0 ? firstParam(query.prefill) : undefined;

  return (
    <>
      <ConversationHeader conversation={conversation} currentUserId={user.id} />
      <ChatWindow key={conversationId} conversation={conversation} currentUserId={user.id} initialMessages={messages} prefill={prefill} />
    </>
  );
}
