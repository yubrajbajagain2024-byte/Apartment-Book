import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import type { PostTargetType } from "@apartment-book/shared";
import { makeStyles } from "@/lib/theme-provider";
import { CommentComposer, CommentList, commentCountLabel, CommentSortButton, useCommentThread } from "./comments";
import { Sheet, SheetFooter, SheetHeader } from "./sheet";

/** `focusComposer` opens the sheet straight into typing (the "Add comment…" bar under a reel), once the sheet has slid up. */
export type CommentsTarget = { targetType: PostTargetType; targetId: string; ownerId: string; comments: number; focusComposer?: boolean };

/**
 * Bottom sheet with the comment thread of one post or reel, TikTok style: the count up top (the sort button beside it),
 * the thread, and the composer pinned under it. Pass `target = null` to keep it closed. Built on the app's one Sheet:
 * it rises on the system's spring over a fading backdrop, and the header pulls it down.
 */
export function CommentsSheet({ target, onClose, onCountChange }: { target: CommentsTarget | null; onClose: () => void; onCountChange: (delta: number) => void }) {
  // Keep showing the last thread while the sheet slides away, so it does not go blank mid-animation.
  const [shown, setShown] = useState<CommentsTarget | null>(target);
  useEffect(() => {
    if (target) setShown(target);
  }, [target]);

  return (
    <Sheet visible={target !== null} onClose={onClose} closeLabel="Close comments" height="70%" keyboard>
      {shown ? <SheetBody key={`${shown.targetType}:${shown.targetId}`} target={shown} onCountChange={onCountChange} /> : null}
    </Sheet>
  );
}

/** The thread of one target: header with the count and sort button, the scrolling list, and the composer pinned at the bottom. */
function SheetBody({ target, onCountChange }: { target: CommentsTarget; onCountChange: (delta: number) => void }) {
  const styles = useStyles();
  const thread = useCommentThread({ targetType: target.targetType, targetId: target.targetId, ownerId: target.ownerId, onCountChange });
  // The post's number until the thread has loaded, then what is really there (replies included).
  const count = thread.count ?? target.comments;
  // Asked to type straight away: the keyboard comes up once the sheet has risen into place (the body mounts with the sheet).
  const { inputRef } = thread;
  useEffect(() => {
    if (!target.focusComposer) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [target.focusComposer, inputRef]);
  return (
    <>
      <SheetHeader title={commentCountLabel(count)} leading={<CommentSortButton onSort={thread.setSort} />} />
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list}>
        <CommentList thread={thread} emptyText="Be the first to comment." />
      </ScrollView>
      <SheetFooter style={styles.footer}>
        <CommentComposer thread={thread} />
      </SheetFooter>
    </>
  );
}

const useStyles = makeStyles(() => ({
  list: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  footer: { paddingTop: 10 },
}));
