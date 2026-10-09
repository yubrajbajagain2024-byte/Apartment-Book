"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Reply, SendHorizonal, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";
import { compactCount, getMyCommentVotes, listComments, threadComments, timeAgo, type CommentVote, type PostCommentNode, type PostCommentWithAuthor, type PostTargetType } from "@apartment-book/shared";
import { addCommentAction, deleteCommentAction, voteCommentAction } from "@/lib/actions/engagement";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";

const PREVIEW = 3;
type Vote = -1 | 0 | 1;
type VoteResult = { error?: string; vote?: CommentVote };
/** One vote request in the air per comment; taps made meanwhile are remembered and the last one is sent after it (same as BuzzVote). */
type Flight = { wanted: Vote; settled: CommentVote; busy: boolean };
/** Replies indent 24px per level. The first level gets it from the padding beside the thread line, so the line sits under the parent. */
const INDENT = ["", "", "ml-6", "ml-12"];
const thumbClass = "inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-gray-100 hover:text-gray-900";

/** The comment and every reply below it: the server cascades a delete, so the local list must too. */
function subtree(list: PostCommentWithAuthor[], id: string): Set<string> {
  const gone = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of list) {
      if (c.parent_id && gone.has(c.parent_id) && !gone.has(c.id)) {
        gone.add(c.id);
        grew = true;
      }
    }
  }
  return gone;
}

/**
 * Comment thread under a post: the input sits right under the action buttons, comments below it (oldest first) with
 * replies threaded under the comment they answer. Every comment has thumbs up / down with its score, Reply, and Delete
 * for your own comments or comments on your post. Loads on first open.
 */
export function CommentsSection({
  targetType,
  targetId,
  totalComments,
  onCountChange,
  currentUser,
  ownerId,
  focusToken = 0,
  initialComments,
  className,
}: {
  targetType: PostTargetType;
  targetId: string;
  /** Count from the feed, so "View all N comments" is right before anything loads. */
  totalComments: number;
  onCountChange?: (delta: number) => void;
  currentUser: { id: string; name: string; avatarUrl: string | null } | null;
  /** The post author can delete any comment. */
  ownerId: string;
  /** Change this value to focus the comment input (e.g. when "Comment" is pressed). */
  focusToken?: number;
  /** Server-rendered comments (detail page) skip the initial fetch. */
  initialComments?: PostCommentWithAuthor[];
  className?: string;
}) {
  const router = useRouter();
  const [comments, setComments] = useState<PostCommentWithAuthor[] | null>(initialComments ?? null);
  // The viewer's thumbs, kept apart from the comments so a vote never reorders the thread.
  const [votes, setVotes] = useState<Record<string, -1 | 1>>({});
  const [showAll, setShowAll] = useState(Boolean(initialComments));
  // Top-level comments whose replies are unfolded ("View N replies").
  const [openThreads, setOpenThreads] = useState<Set<string>>(() => new Set());
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  // "<comment id>:<vote>" of the thumb just pressed, so only a tap pops the icon, never votes arriving from the server.
  const [popped, setPopped] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Comment ids whose votes were already looked up, and the votes in the air.
  const asked = useRef(new Set<string>());
  const flights = useRef(new Map<string, Flight>());
  const viewerId = currentUser?.id ?? null;

  useEffect(() => {
    if (focusToken > 0) ref.current?.focus();
  }, [focusToken]);

  const load = useCallback(
    () =>
      listComments(createClient(), targetType, targetId).then(
        (rows) => setComments(rows),
        (e: unknown) => setLoadError(e instanceof Error ? e.message : "Could not load comments."),
      ),
    [targetType, targetId],
  );

  useEffect(() => {
    if (comments === null) void load();
  }, [comments, load]);

  // The viewer's own thumbs come in a separate small query for the ids not looked up yet, so the list never waits for them.
  useEffect(() => {
    if (!comments) return;
    const fresh = comments.map((c) => c.id).filter((id) => !asked.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) asked.current.add(id);
    if (!viewerId) return;
    getMyCommentVotes(createClient(), viewerId, fresh).then(
      (mine) =>
        setVotes((prev) => {
          const next = { ...prev };
          // A thumb pressed while the lookup was out is newer than what it brought back.
          for (const [id, vote] of Object.entries(mine)) if (!flights.current.has(id)) next[id] = vote;
          return next;
        }),
      () => {
        // Your own thumbs are a nicety: the thread reads fine with the scores alone.
      },
    );
  }, [comments, viewerId]);

  const { rows, rootOf } = useMemo(() => {
    const rows = threadComments(comments ?? [], votes);
    // Thread order puts a parent before its replies, so a reply's top-level comment is already known when it comes up.
    const rootOf = new Map<string, string>();
    for (const r of rows) rootOf.set(r.id, r.depth === 0 ? r.id : (rootOf.get(r.parent_id ?? "") ?? r.id));
    return { rows, rootOf };
  }, [comments, votes]);

  function toLogin() {
    router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }

  function unfold(id: string) {
    setOpenThreads((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  function toggleThread(id: string) {
    setOpenThreads((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function submit() {
    const text = body.trim();
    if (!text || pending) return;
    const parent = replyTo;
    startTransition(async () => {
      setError(null);
      const result = await addCommentAction(targetType, targetId, text, parent?.id ?? null);
      if (result.error || !result.comment) {
        setError(result.error ?? "Could not post your comment.");
        return;
      }
      const comment = result.comment;
      // Nobody has voted on a brand-new comment, so there is nothing to look up for it.
      asked.current.add(comment.id);
      setComments((prev) => [...(prev ?? []), comment]);
      if (parent) unfold(rootOf.get(parent.id) ?? parent.id);
      setShowAll(true);
      setBody("");
      setReplyTo(null);
      onCountChange?.(1);
    });
  }

  function remove(id: string) {
    const gone = subtree(comments ?? [], id);
    startTransition(async () => {
      const result = await deleteCommentAction(id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setComments((prev) => (prev ?? []).filter((c) => !gone.has(c.id)));
      // Do not keep "Replying to …" pointed at a comment that is no longer there.
      setReplyTo((r) => (r && gone.has(r.id) ? null : r));
      onCountChange?.(-gone.size);
    });
  }

  function startReply(c: PostCommentNode) {
    if (!currentUser) return toLogin();
    setReplyTo({ id: c.id, name: c.author.full_name });
    ref.current?.focus();
  }

  function cancelReply() {
    setReplyTo(null);
  }

  function applyVote(id: string, tally: CommentVote) {
    setComments((prev) => prev?.map((c) => (c.id === id ? { ...c, score: tally.score } : c)) ?? prev);
    setVotes((prev) => {
      const next = { ...prev };
      if (tally.myVote === 0) delete next[id];
      else next[id] = tally.myVote;
      return next;
    });
  }

  /** The same thumb again clears your vote; the other thumb flips it. The number changes right away and the server's answer wins. */
  function cast(row: PostCommentNode, arrow: 1 | -1) {
    if (!currentUser) return toLogin();
    const next: Vote = row.myVote === arrow ? 0 : arrow;
    const flight = flights.current.get(row.id) ?? { wanted: row.myVote, settled: { score: row.score, myVote: row.myVote }, busy: false };
    flights.current.set(row.id, flight);
    flight.wanted = next;
    setError(null);
    setPopped(next === 0 ? null : `${row.id}:${next}`);
    if (next !== 0 && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(12);
    applyVote(row.id, { score: row.score - row.myVote + next, myVote: next });
    if (flight.busy) return;
    flight.busy = true;
    void (async () => {
      try {
        for (;;) {
          const sending = flight.wanted;
          const result = await voteCommentAction(row.id, sending).catch((): VoteResult => ({ error: "Could not save your vote." }));
          if (result.error || !result.vote) {
            flight.wanted = flight.settled.myVote;
            applyVote(row.id, flight.settled);
            setError(result.error ?? "Could not save your vote.");
            return;
          }
          flight.settled = result.vote;
          if (flight.wanted === sending) {
            applyVote(row.id, result.vote);
            return;
          }
        }
      } finally {
        flight.busy = false;
      }
    })();
  }

  const tops = rows.filter((r) => r.depth === 0);
  // Collapsed: the last few top-level comments, their replies behind "View all". Expanded: the thread, replies folded under each comment.
  const visible = showAll ? rows.filter((r) => r.depth === 0 || openThreads.has(rootOf.get(r.id) ?? r.id)) : tops.slice(-PREVIEW);
  const hidden = comments === null ? Math.max(0, totalComments - PREVIEW) : showAll ? 0 : rows.length - visible.length;

  return (
    <div className={cn("flex flex-col gap-3 border-t border-gray-100 px-3 py-3", className)} data-testid="comments">
      {currentUser ? (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {replyTo ? (
            <div className="ml-10 inline-flex max-w-full items-center gap-1 self-start rounded-full bg-gray-100 py-0.5 pl-2.5 pr-1 text-xs text-gray-700" data-testid="reply-to">
              <span className="truncate">
                Replying to <span className="font-semibold text-gray-900">{replyTo.name}</span>
              </span>
              <button type="button" onClick={cancelReply} aria-label="Cancel reply" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-gray-200">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : null}
          <div className="flex items-start gap-2">
            <Avatar name={currentUser.name} src={currentUser.avatarUrl} size="sm" />
            <div className="flex min-w-0 flex-1 items-end rounded-2xl bg-gray-100 pl-3 pr-1 focus-within:ring-2 focus-within:ring-brand-200">
              <textarea
                ref={ref}
                name="comment"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  } else if (e.key === "Escape" && replyTo) {
                    // Only the reply is dropped; the window listener that closes the reels drawer must not see this press.
                    e.preventDefault();
                    e.stopPropagation();
                    cancelReply();
                  }
                }}
                rows={1}
                maxLength={1000}
                placeholder={replyTo ? "Write a reply…" : "Write a comment…"}
                aria-label="Write a comment"
                className="max-h-32 min-h-[36px] w-full resize-none bg-transparent py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={pending || body.trim().length === 0}
                aria-label="Post comment"
                className="mb-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-brand-600 hover:bg-brand-50 disabled:text-gray-400 disabled:hover:bg-transparent"
              >
                <SendHorizonal className="h-4 w-4" />
              </button>
            </div>
          </div>
        </form>
      ) : (
        <p className="text-sm text-gray-600">
          <Link href="/login" className="font-semibold text-brand-700 hover:underline">
            Log in
          </Link>{" "}
          to join the conversation.
        </p>
      )}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => {
            setShowAll(true);
            if (comments === null) void load();
          }}
          className="self-start text-sm font-semibold text-gray-600 hover:underline"
        >
          {/* Once the thread is here its own count is the truth; before that, the feed's. */}
          View {hidden === 1 ? "1 more comment" : `all ${comments?.length ?? totalComments} comments`}
        </button>
      ) : null}
      {loadError ? (
        <p className="text-sm text-red-600">
          {loadError}{" "}
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              void load();
            }}
            className="font-semibold underline"
          >
            Retry
          </button>
        </p>
      ) : null}
      {comments === null && totalComments > 0 && !loadError ? <p className="text-sm text-gray-500">Loading comments…</p> : null}

      {visible.length > 0 ? (
        <ul className="flex flex-col">
          {visible.map((c) => {
            const canDelete = currentUser !== null && (currentUser.id === c.user_id || currentUser.id === ownerId);
            const reply = c.depth > 0;
            const open = openThreads.has(c.id);
            return (
              // Padding instead of a list gap, so the thread line runs unbroken from one reply to the next.
              <li key={c.id} data-testid="comment-row" data-depth={c.depth} className={cn("flex items-start gap-2 pb-2.5 last:pb-0", reply && "border-l border-gray-200 pl-6", INDENT[c.depth])}>
                <Link href={`/profile/${c.author.id}`} className="shrink-0">
                  <Avatar name={c.author.full_name} src={c.author.avatar_url} size={reply ? "xs" : "sm"} />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="inline-block max-w-full rounded-2xl bg-gray-100 px-3 py-1.5">
                    <Link href={`/profile/${c.author.id}`} className="block text-[13px] font-semibold leading-tight text-gray-900 hover:underline">
                      {c.author.full_name}
                    </Link>
                    <p className="whitespace-pre-line break-words text-sm text-gray-900">{c.body}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1 px-1 pt-0.5 text-xs text-gray-500">
                    <span className="px-2" suppressHydrationWarning>
                      {timeAgo(c.created_at)}
                    </span>
                    <div className="flex items-center" role="group" aria-label="Rate this comment">
                      <button type="button" onClick={() => cast(c, 1)} aria-label="Like comment" aria-pressed={c.myVote === 1} className={cn(thumbClass, c.myVote === 1 && "text-brand-600 hover:text-brand-600")}>
                        <ThumbsUp className={cn("h-3.5 w-3.5", c.myVote === 1 && "fill-current", popped === `${c.id}:1` && "ab-pop")} />
                      </button>
                      <span aria-live="polite" className={cn("min-w-4 text-center font-semibold tabular-nums", c.myVote === 1 ? "text-brand-700" : c.myVote === -1 ? "text-red-600" : "text-gray-700")} data-testid="comment-score">
                        {compactCount(c.score)}
                      </span>
                      <button type="button" onClick={() => cast(c, -1)} aria-label="Dislike comment" aria-pressed={c.myVote === -1} className={cn(thumbClass, c.myVote === -1 && "text-red-600 hover:text-red-600")}>
                        <ThumbsDown className={cn("h-3.5 w-3.5", c.myVote === -1 && "fill-current", popped === `${c.id}:-1` && "ab-pop")} />
                      </button>
                    </div>
                    <button type="button" onClick={() => startReply(c)} aria-label="Reply" className="inline-flex h-7 items-center gap-1 rounded-full px-2 font-semibold hover:bg-gray-100 hover:text-gray-900">
                      <Reply className="h-3.5 w-3.5" /> Reply
                    </button>
                    {canDelete ? (
                      <button type="button" onClick={() => remove(c.id)} disabled={pending} className="inline-flex h-7 items-center gap-1 rounded-full px-2 hover:bg-gray-100 hover:text-red-600" aria-label="Delete comment">
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    ) : null}
                  </div>
                  {showAll && c.depth === 0 && c.replyCount > 0 ? (
                    <button type="button" onClick={() => toggleThread(c.id)} aria-expanded={open} className="mt-0.5 inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-gray-500 hover:text-gray-800">
                      <span aria-hidden="true" className="h-px w-6 bg-gray-300" />
                      {open ? "Hide replies" : c.replyCount === 1 ? "View 1 reply" : `View ${c.replyCount} replies`}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
