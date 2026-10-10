"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import type { PostTargetType } from "@apartment-book/shared";
import { openDirectConversationAction, startDirectConversationAction } from "@/lib/actions/messages";
import { cn } from "@/lib/utils";
import { Button, LinkButton } from "@/components/ui/button";
import { useChatDock } from "@/components/messages/chat-dock";

/**
 * Opens a 1:1 chat with the listing owner. On desktop it opens in the chat dock
 * (no navigation); on phones, or without JavaScript, the form submits and the
 * full Messages page opens. Renders nothing for your own listings.
 */
export function MessageButton({
  userId,
  currentUserId,
  prefill,
  returnTo,
  label = "Message",
  className,
  variant = "primary",
  tone = "primary",
  target,
}: {
  userId: string;
  currentUserId: string | null;
  prefill?: string;
  returnTo: string;
  label?: string;
  className?: string;
  /** "action" renders a compact icon + label for post action bars. */
  variant?: "primary" | "action";
  /** The colour of the "primary" variant: brand blue, or light grey next to another main button (a profile's Follow). */
  tone?: "primary" | "secondary";
  /** The listing this button sits on, so the contact is counted in its stats. Home-feed posts have no contact stats. */
  target?: { type: PostTargetType; id: string };
}) {
  const dock = useChatDock();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (currentUserId === userId) return null;
  const listing = target && target.type !== "post" ? { type: target.type, id: target.id } : null;

  const actionClasses = "inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-gray-800 hover:bg-gray-100 disabled:opacity-60";

  if (!currentUserId) {
    const href = `/login?next=${encodeURIComponent(returnTo)}`;
    return variant === "action" ? (
      <a href={href} className={cn(actionClasses, className)}>
        <MessageCircle className="h-5 w-5" /> {label}
      </a>
    ) : (
      <LinkButton href={href} variant={tone} className={className}>
        <MessageCircle className="h-5 w-5" />
        {label}
      </LinkButton>
    );
  }

  function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
    if (!dock || !desktop) return; // let the form submit and navigate
    e.preventDefault();
    startTransition(async () => {
      const result = await openDirectConversationAction(userId, listing);
      if (result.conversationId) dock.openChat(result.conversationId, { prefill });
      else router.push(`/messages`);
    });
  }

  return (
    // For the action variant the form is `contents`, so the button itself sits in the parent's flex row.
    <form action={startDirectConversationAction} className={variant === "action" ? "contents" : className}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {prefill ? <input type="hidden" name="prefill" value={prefill} /> : null}
      {listing ? <input type="hidden" name="targetType" value={listing.type} /> : null}
      {listing ? <input type="hidden" name="targetId" value={listing.id} /> : null}
      {variant === "action" ? (
        <button type="submit" onClick={onClick} disabled={pending} className={cn(actionClasses, className)}>
          <MessageCircle className="h-5 w-5" /> {label}
        </button>
      ) : (
        <Button type="submit" onClick={onClick} loading={pending} variant={tone} className="w-full">
          <MessageCircle className="h-5 w-5" />
          {label}
        </Button>
      )}
    </form>
  );
}
