import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Messages" };

export default function MessagesIndexPage() {
  return (
    <div className="ab-fade-in flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-gray-500">
      <span className="mb-1 flex h-14 w-14 items-center justify-center rounded-full text-gray-900 ring-1 ring-gray-200">
        <MessageCircle className="h-6 w-6" strokeWidth={1.5} />
      </span>
      <p className="font-display text-2xl tracking-tight text-gray-900">Your messages</p>
      <p className="max-w-xs text-sm leading-relaxed">Pick a conversation on the left, or start a new chat with a student or a group.</p>
      <div className="mt-2">
        <LinkButton href="/messages/new">New message</LinkButton>
      </div>
    </div>
  );
}
