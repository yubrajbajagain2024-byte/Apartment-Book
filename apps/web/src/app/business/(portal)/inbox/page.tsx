import type { Metadata } from "next";
import { Inbox } from "lucide-react";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxIndexPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-gray-500">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Inbox className="h-8 w-8" />
      </span>
      <p className="text-lg font-semibold text-gray-800">Your inquiries</p>
      <p className="max-w-xs text-sm">Pick a conversation on the left. Students write first, from your listings and deals; anyone on the team can answer.</p>
    </div>
  );
}
