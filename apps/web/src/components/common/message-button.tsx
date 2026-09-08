"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
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
  /** The listing this button sits on, so the contact is counted in its stats. */
  target?: { type: "apartment" | "item" | "roommate"; id: string };
}) {
  const dock = useChatDock();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (currentUserId === userId) return null;

  const actionClasses = "inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-gray-800 hover:bg-gray-100 disabled:opacity-60";

  if (!currentUserId) {
    const href = `/login?next=${encodeURIComponent(returnTo)}`;
    return variant === "action" ? (
      <a href={href} className={cn(actionClasses, className)}>
        <MessageCircle className="h-5 w-5" /> {label}
      </a>
    ) : (
      <LinkButton href={href} className={className}>
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
      const result = await openDirectConversationAction(userId, target ?? null);
      if (result.conversationId) dock.openChat(result.conversationId, { prefill });
      else router.push(`/messages`);
    });
  }

  return (
    <form action={startDirectConversationAction} className={className}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {prefill ? <input type="hidden" name="prefill" value={prefill} /> : null}
      {target ? <input type="hidden" name="targetType" value={target.type} /> : null}
      {target ? <input type="hidden" name="targetId" value={target.id} /> : null}
      {variant === "action" ? (
        <button type="submit" onClick={onClick} disabled={pending} className={actionClasses}>
          <MessageCircle className="h-5 w-5" /> {label}
        </button>
      ) : (
        <Button type="submit" onClick={onClick} loading={pending} className="w-full">
          <MessageCircle className="h-5 w-5" />
          {label}
        </Button>
      )}
    </form>
  );
}
