import { MessageCircle } from "lucide-react";
import { startDirectConversationAction } from "@/lib/actions/messages";
import { Button, LinkButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Opens a 1:1 chat with the listing owner. Renders nothing for your own listings. */
export function MessageButton({
  userId,
  currentUserId,
  prefill,
  returnTo,
  label = "Message",
  className,
  variant = "primary",
}: {
  userId: string;
  currentUserId: string | null;
  prefill?: string;
  returnTo: string;
  label?: string;
  className?: string;
  /** "action" renders a compact icon + label for post action bars. */
  variant?: "primary" | "action";
}) {
  if (currentUserId === userId) return null;

  if (variant === "action") {
    const classes = "inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-gray-800 hover:bg-gray-100";
    if (!currentUserId) {
      return (
        <a href={`/login?next=${encodeURIComponent(returnTo)}`} className={cn(classes, className)}>
          <MessageCircle className="h-5 w-5" /> {label}
        </a>
      );
    }
    return (
      <form action={startDirectConversationAction} className={className}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        {prefill ? <input type="hidden" name="prefill" value={prefill} /> : null}
        <button type="submit" className={classes}>
          <MessageCircle className="h-5 w-5" /> {label}
        </button>
      </form>
    );
  }

  if (!currentUserId) {
    return (
      <LinkButton href={`/login?next=${encodeURIComponent(returnTo)}`} className={className}>
        <MessageCircle className="h-5 w-5" />
        {label}
      </LinkButton>
    );
  }

  return (
    <form action={startDirectConversationAction} className={className}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {prefill ? <input type="hidden" name="prefill" value={prefill} /> : null}
      <Button type="submit" className="w-full">
        <MessageCircle className="h-5 w-5" />
        {label}
      </Button>
    </form>
  );
}
