import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Building2, Tag } from "lucide-react";
import { businessInboxView, getConversation, listMessages, listTeam } from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { ChatWindow } from "@/components/messages/chat-window";
import { ConversationHeader } from "@/components/messages/conversation-header";

type Props = { params: Promise<{ conversationId: string }> };

export const metadata: Metadata = { title: "Inquiry" };

/** What the student asked about: the listing or deal the chat was opened from, with a link to it on the site. */
async function inquiryAbout(supabase: Awaited<ReturnType<typeof createClient>>, conversationId: string): Promise<{ kind: "apartment" | "deal"; title: string; href: string } | null> {
  const { data } = await supabase.from("conversations").select("inquiry_target_type, inquiry_target_id").eq("id", conversationId).maybeSingle();
  if (!data?.inquiry_target_type || !data.inquiry_target_id) return null;
  if (data.inquiry_target_type === "apartment") {
    const { data: a } = await supabase.from("apartments").select("title").eq("id", data.inquiry_target_id).maybeSingle();
    return a ? { kind: "apartment", title: a.title, href: `${getSiteUrl()}/apartments/${data.inquiry_target_id}` } : null;
  }
  const { data: d } = await supabase.from("deals").select("title").eq("id", data.inquiry_target_id).maybeSingle();
  return d ? { kind: "deal", title: d.title, href: `${getSiteUrl()}/deals` } : null;
}

export default async function InquiryPage({ params }: Props) {
  const { conversationId } = await params;
  const { user, membership } = await requireBusiness(`/inbox/${conversationId}`, ["approved"]);
  const supabase = await createClient();
  const [conversation, team] = await Promise.all([getConversation(supabase, conversationId, user.id), listTeam(supabase, membership.business.id)]);
  if (!conversation || conversation.business?.id !== membership.business.id) notFound();
  const view = businessInboxView(conversation, new Set(team.map((m) => m.user_id)));
  const [messages, about] = await Promise.all([listMessages(supabase, conversationId), inquiryAbout(supabase, conversationId)]);

  return (
    <>
      <ConversationHeader conversation={view} currentUserId={user.id} />
      {about ? (
        <a href={about.href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-600 hover:bg-gray-100" data-testid="inquiry-about">
          {about.kind === "apartment" ? <Building2 className="h-3.5 w-3.5 text-brand-600" /> : <Tag className="h-3.5 w-3.5 text-brand-600" />}
          <span>
            Asked about <span className="font-semibold text-gray-900">{about.title}</span>
          </span>
        </a>
      ) : null}
      <ChatWindow key={conversationId} conversation={view} currentUserId={user.id} initialMessages={messages} teamIds={team.map((m) => m.user_id)} />
    </>
  );
}
