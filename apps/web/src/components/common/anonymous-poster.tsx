import { EyeOff } from "lucide-react";
import { timeAgo } from "@/lib/utils";

/**
 * Who posted an anonymous roommate post or item (20261105000000_anonymous_listings.sql): nobody to show or link to. Its
 * poster sees that it is theirs, and that nobody else can tell.
 */
export function AnonymousPoster({ own, createdAt, verb = "Posted" }: { own: boolean; createdAt: string; verb?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
        <EyeOff className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate font-semibold text-gray-900">{own ? "You, anonymously" : "Anonymous"}</p>
        <p className="text-xs text-gray-500" suppressHydrationWarning>
          {own ? "Only you can see that this is yours" : `${verb} anonymously ${timeAgo(createdAt)}`}
        </p>
      </div>
    </div>
  );
}
