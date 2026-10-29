import { Inbox, ShieldCheck } from "lucide-react";
import { BizLink, Panel } from "./ui";

/**
 * The Inbox of a business still waiting for the UniBuzz team's review. Students can message only an approved business
 * (the database refuses an inquiry to any other), so there is nothing to list yet: this says when it opens and how.
 */
export function InboxPending({ businessName }: { businessName: string }) {
  return (
    <Panel className="mx-auto flex max-w-xl flex-col items-center gap-3 p-10 text-center" data-testid="inbox-pending">
      <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-biz-accent-soft text-biz-accent-ink">
        <Inbox className="h-7 w-7" aria-hidden="true" />
      </span>
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-biz-ink">Your Inbox opens once you are approved</h1>
      <p className="text-[15px] leading-relaxed text-biz-ink-3">
        As soon as the UniBuzz team approves {businessName}, students can message you from your profile, posts and listings. Their messages land here as they are sent, and
        anyone on your team who replies can answer. Students always write first.
      </p>
      <BizLink href="/settings/verification" variant="secondary" className="mt-3">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" /> See where your review stands
      </BizLink>
    </Panel>
  );
}
