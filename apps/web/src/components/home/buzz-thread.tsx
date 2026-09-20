"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { VenetianMask } from "lucide-react";
import { listBuzzComments, type BuzzComment, type BuzzPost } from "@apartment-book/shared";
import { addBuzzCommentAction, deleteBuzzCommentAction, muteBuzzAuthorAction } from "@/lib/actions/buzz";
import { createClient } from "@/lib/supabase/client";
import { Button, LinkButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { BUZZ_HOME, BuzzByline, BuzzCard, BuzzMenu } from "./buzz-card";

const MAX_REPLY = 2000;

function oldestFirst(list: BuzzComment[]): BuzzComment[] {
  return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** A whole Buzz thread: the post, its anonymous replies (oldest first) and the reply box. */
export function BuzzThread({ post, comments: initialComments, signedIn }: { post: BuzzPost; comments: BuzzComment[]; signedIn: boolean }) {
  const router = useRouter();
  const [comments, setComments] = useState(() => oldestFirst(initialComments));
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const path = `/buzz/${post.id}`;

  function submit() {
    const body = text.trim();
    if (!body || pending) return;
    setError(null);
    start(async () => {
      const result = await addBuzzCommentAction(post.id, body).catch(() => ({ error: "Could not post your reply.", comments: undefined }));
      if (result.error || !result.comments) {
        setError(result.error ?? "Could not post your reply.");
        return;
      }
      setComments(oldestFirst(result.comments));
      setText("");
    });
  }

  async function removeReply(commentId: string) {
    const result = await deleteBuzzCommentAction(post.id, commentId);
    if (result.comments) setComments(oldestFirst(result.comments));
    return { error: result.error };
  }

  async function hidePerson(comment: BuzzComment) {
    const result = await muteBuzzAuthorAction({ commentId: comment.id }, { stayQuiet: true });
    if (result.error) return result;
    if (comment.isOp) {
      // Hiding the person who started this thread hides the thread itself.
      router.push(BUZZ_HOME);
      router.refresh();
      return {};
    }
    const fresh = await listBuzzComments(createClient(), post.id).catch(() => null);
    setComments((prev) => (fresh ? oldestFirst(fresh) : prev.filter((c) => c.id !== comment.id)));
    router.refresh();
    return {};
  }

  return (
    <div className="-mx-3 flex flex-col gap-1 sm:mx-0 sm:gap-3" data-testid="buzz-thread">
      <BuzzCard post={{ ...post, commentCount: comments.length }} signedIn={signedIn} full priority />

      <section id="replies" aria-label="Replies" className="scroll-mt-20 bg-white shadow-sm ring-1 ring-gray-200 sm:rounded-xl">
        <h2 className="border-b border-gray-100 px-4 py-3 text-sm font-bold text-gray-900">{comments.length === 0 ? "Replies" : `${comments.length} ${comments.length === 1 ? "reply" : "replies"}`}</h2>

        <div className="border-b border-gray-100 px-4 py-3">
          {signedIn ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="flex flex-col gap-2"
            >
              <Textarea
                name="body"
                rows={3}
                maxLength={MAX_REPLY}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                }}
                placeholder="Reply anonymously…"
                aria-label="Reply anonymously"
                data-testid="buzz-reply-input"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-1.5 text-xs text-gray-500">
                  <VenetianMask className="h-4 w-4 shrink-0" /> Your name is never shown. Be kind, and leave out other people&apos;s names and personal details.
                </p>
                <Button type="submit" loading={pending} disabled={!text.trim()} className="shrink-0" data-testid="buzz-reply-send">
                  Reply
                </Button>
              </div>
              {error ? (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              ) : null}
            </form>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-700">Log in to reply. Your reply stays anonymous.</p>
              <LinkButton href={`/login?next=${encodeURIComponent(path)}`}>Log in</LinkButton>
            </div>
          )}
        </div>

        {comments.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-500">No replies yet. Be the first to answer.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {comments.map((c) => (
              <li key={c.id} className="flex items-start gap-2 px-4 py-3" data-testid="buzz-reply">
                <div className="min-w-0 flex-1">
                  <BuzzByline alias={c.alias} createdAt={c.createdAt} isMine={c.isMine} isOp={c.isOp} />
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-800 [overflow-wrap:anywhere]">{c.body}</p>
                </div>
                <BuzzMenu
                  label="Reply options"
                  signedIn={signedIn}
                  loginPath={path}
                  report={c.isMine ? undefined : { targetType: "buzz_comment", targetId: c.id }}
                  onHide={c.isMine ? undefined : () => hidePerson(c)}
                  hideLabel={c.isOp ? "Hide this thread" : "Hide this person's replies here"}
                  hideConfirm={
                    c.isOp
                      ? "This person started the thread, so hiding them hides the whole thread. You will not find out who they are, and they will not be told."
                      : "Hide this person's replies in this thread? You will not find out who they are, and they will not be told."
                  }
                  onDelete={c.isMine || post.isMine ? () => removeReply(c.id) : undefined}
                  deleteConfirm={c.isMine ? "Delete your reply?" : "Delete this reply from your thread?"}
                  className="-mr-2 -mt-1"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="px-3 pb-4 text-center text-xs text-gray-500 sm:px-0">
        <Link href={BUZZ_HOME} className="font-semibold text-brand-700 hover:underline">
          Back to Buzz
        </Link>
      </p>
    </div>
  );
}
