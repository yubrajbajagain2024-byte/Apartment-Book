"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { SendHorizonal, Trash2 } from "lucide-react";
import { listComments, timeAgo, type PostCommentWithAuthor, type SavedTargetType } from "@apartment-book/shared";
import { addCommentAction, deleteCommentAction } from "@/lib/actions/engagement";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";

const PREVIEW = 3;

/**
 * Facebook-style comment thread under a post: the input sits right under the
 * action buttons, comments list below it (oldest first). Loads on first open.
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
  targetType: SavedTargetType;
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
  const [comments, setComments] = useState<PostCommentWithAuthor[] | null>(initialComments ?? null);
  const [showAll, setShowAll] = useState(Boolean(initialComments));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement | null>(null);

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

  function submit() {
    const text = body.trim();
    if (!text || pending) return;
    startTransition(async () => {
      setError(null);
      const result = await addCommentAction(targetType, targetId, text);
      if (result.error || !result.comment) {
        setError(result.error ?? "Could not post your comment.");
        return;
      }
      const comment = result.comment;
      setComments((prev) => [...(prev ?? []), comment]);
      setShowAll(true);
      setBody("");
      onCountChange?.(1);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteCommentAction(id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setComments((prev) => (prev ?? []).filter((c) => c.id !== id));
      onCountChange?.(-1);
    });
  }

  const list = comments ?? [];
  const visible = showAll ? list : list.slice(-PREVIEW);
  const hidden = comments === null ? Math.max(0, totalComments - PREVIEW) : list.length - visible.length;

  return (
    <div className={cn("flex flex-col gap-3 border-t border-gray-100 px-3 py-3", className)} data-testid="comments">
      {currentUser ? (
        <form
          className="flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
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
                }
              }}
              rows={1}
              maxLength={1000}
              placeholder="Write a comment…"
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
        <button type="button" onClick={() => (comments === null ? void load() : setShowAll(true))} className="self-start text-sm font-semibold text-gray-600 hover:underline">
          View {hidden === 1 ? "1 more comment" : `all ${totalComments} comments`}
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
        <ul className="flex flex-col gap-2.5">
          {visible.map((c) => {
            const canDelete = currentUser !== null && (currentUser.id === c.user_id || currentUser.id === ownerId);
            return (
              <li key={c.id} className="group flex items-start gap-2">
                <Link href={`/profile/${c.author.id}`} className="shrink-0">
                  <Avatar name={c.author.full_name} src={c.author.avatar_url} size="sm" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="inline-block max-w-full rounded-2xl bg-gray-100 px-3 py-1.5">
                    <Link href={`/profile/${c.author.id}`} className="block text-[13px] font-semibold leading-tight text-gray-900 hover:underline">
                      {c.author.full_name}
                    </Link>
                    <p className="whitespace-pre-line break-words text-sm text-gray-900">{c.body}</p>
                  </div>
                  <div className="flex items-center gap-3 px-3 pt-0.5 text-xs text-gray-500">
                    <span suppressHydrationWarning>{timeAgo(c.created_at)}</span>
                    {canDelete ? (
                      <button type="button" onClick={() => remove(c.id)} disabled={pending} className="inline-flex items-center gap-1 hover:text-red-600" aria-label="Delete comment">
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
