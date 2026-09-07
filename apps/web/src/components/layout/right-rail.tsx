import Link from "next/link";
import { Bell, MessageCircle, Plus } from "lucide-react";
import { listConversations } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ConversationAvatar } from "@/components/messages/conversation-list";

/** Right column: notifications and recent chats (signed in) or a join card. */
export async function RightRail() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <Card>
        <CardBody className="flex flex-col gap-3">
          <p className="font-semibold text-gray-900">Texas State students only</p>
          <p className="text-sm text-gray-600">Sign up with your @txstate.edu email to message people, save places and post your own.</p>
          <LinkButton href="/signup">Create account</LinkButton>
          <LinkButton href="/login" variant="secondary">
            Log in
          </LinkButton>
        </CardBody>
      </Card>
    );
  }

  const conversations = await listConversations(await createClient(), user.id).catch(() => []);
  const recent = conversations.slice(0, 5);

  return (
    <>
      <Card>
        <CardHeader className="flex items-center justify-between py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4 text-brand-600" /> Notifications
          </CardTitle>
        </CardHeader>
        <CardBody className="py-3 text-sm text-gray-600">You&apos;re all caught up. New messages, saves and nearby listings will show here.</CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4 text-brand-600" /> Chats
          </CardTitle>
          <Link href="/messages" className="text-sm font-medium text-brand-600 hover:underline">
            See all
          </Link>
        </CardHeader>
        <CardBody className="flex flex-col gap-1 px-2 py-2">
          {recent.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-600">No chats yet. Message a listing owner to start one.</p>
          ) : (
            recent.map((c) => (
              <Link key={c.id} href={`/messages/${c.id}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-100">
                <ConversationAvatar conversation={c} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className={c.unreadCount > 0 ? "block truncate text-sm font-bold text-gray-900" : "block truncate text-sm font-medium text-gray-800"}>{c.title}</span>
                  <span className="block truncate text-xs text-gray-500">{c.lastMessagePreview ?? "Say hi 👋"}</span>
                </span>
                {c.unreadCount > 0 ? (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">{c.unreadCount}</span>
                ) : null}
              </Link>
            ))
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-2 py-3">
          <p className="text-sm font-semibold text-gray-900">Have a place or something to sell?</p>
          <div className="flex flex-col gap-1.5">
            <LinkButton href="/apartments/new" size="sm" variant="secondary">
              <Plus className="h-4 w-4" /> Post an apartment
            </LinkButton>
            <LinkButton href="/roommates/new" size="sm" variant="secondary">
              <Plus className="h-4 w-4" /> Roommate post
            </LinkButton>
            <LinkButton href="/marketplace/new" size="sm" variant="secondary">
              <Plus className="h-4 w-4" /> Sell an item
            </LinkButton>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
