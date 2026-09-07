import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { NewConversationForm } from "@/components/messages/new-conversation-form";

export const metadata: Metadata = { title: "New message" };

export default async function NewMessagePage() {
  const user = await requireUser("/messages/new");
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex h-14 items-center gap-2 border-b border-gray-200 px-2 sm:px-4">
        <Link href="/messages" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100 md:hidden" aria-label="Back to chats">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-semibold">New message</h1>
      </div>
      <div className="mx-auto w-full max-w-lg p-4">
        <NewConversationForm currentUserId={user.id} />
      </div>
    </div>
  );
}
