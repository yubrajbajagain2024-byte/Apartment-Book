import { MessageCircle } from "lucide-react";
import { startDirectConversationAction } from "@/lib/actions/messages";
import { Button, LinkButton } from "@/components/ui/button";

/** Opens a 1:1 chat with the listing owner. Renders nothing for your own listings. */
export function MessageButton({
  userId,
  currentUserId,
  prefill,
  returnTo,
  label = "Message",
  className,
}: {
  userId: string;
  currentUserId: string | null;
  prefill?: string;
  returnTo: string;
  label?: string;
  className?: string;
}) {
  if (currentUserId === userId) return null;

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
