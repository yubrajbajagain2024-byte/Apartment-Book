import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Messages" };

export default function MessagesIndexPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-gray-500">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <MessageCircle className="h-8 w-8" />
      </span>
      <p className="text-lg font-semibold text-gray-800">Your messages</p>
      <p className="max-w-xs text-sm">Pick a conversation on the left, or start a new chat with a student or a group.</p>
      <LinkButton href="/messages/new">New message</LinkButton>
    </div>
  );
}
