import type { Metadata } from "next";
import { Inbox } from "lucide-react";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxIndexPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-biz-accent-soft text-biz-accent-ink">
        <Inbox className="h-7 w-7" />
      </span>
      <p className="text-[19px] font-semibold text-biz-ink">Your inquiries</p>
      <p className="max-w-xs text-[15px] text-biz-ink-3">Pick a conversation. Students always write first, from your profile, posts, listings or ads; you reply right here.</p>
    </div>
  );
}
