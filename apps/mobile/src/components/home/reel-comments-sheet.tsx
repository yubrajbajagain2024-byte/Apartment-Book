import { useMemo } from "react";
import type { Reel } from "@apartment-book/shared";
import { CommentsSheet, type CommentsTarget } from "../comments-sheet";

/** Bottom sheet with the comment thread of one reel. Pass `reel = null` to keep it closed; `focusComposer` opens it straight into typing. */
export function ReelCommentsSheet({ reel, focusComposer = false, onClose, onCountChange }: { reel: Reel | null; focusComposer?: boolean; onClose: () => void; onCountChange: (delta: number) => void }) {
  const target = useMemo<CommentsTarget | null>(() => (reel ? { targetType: reel.sourceType, targetId: reel.sourceId, ownerId: reel.author.id, comments: reel.comments, focusComposer } : null), [reel, focusComposer]);
  return <CommentsSheet target={target} onClose={onClose} onCountChange={onCountChange} />;
}
