"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Reply, Search, VenetianMask, X } from "lucide-react";
import { BUZZ_COMMENT_SORTS, compactCount, listBuzzComments, threadBuzzComments, type BuzzComment, type BuzzCommentNode, type BuzzCommentSort, type BuzzPost } from "@apartment-book/shared";
import { addBuzzCommentAction, deleteBuzzCommentAction, muteBuzzAuthorAction } from "@/lib/actions/buzz";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button, LinkButton } from "@/components/ui/button";
import { BUZZ_FOCUS_SEARCH, BUZZ_HOME, BUZZ_SEARCH_ID, BuzzAge, BuzzAvatar, BuzzBadges, BuzzSortMenu } from "./buzz-bits";
import { BuzzMenu, BuzzPostBlock, BuzzThreadMenu } from "./buzz-card";
import { BuzzVote } from "./buzz-vote";

const MAX_REPLY = 2000;
/** Replies whose top edge is above this line count as "already read" for the jump button (navbar plus a little air). */
const JUMP_LINE = 140;

type Tally = { score: number; myVote: -1 | 0 | 1 };
type Row = BuzzCommentNode & {
  /** The replies above this one, outermost first: one thread line each. */
  lines: string[];
};

/**
 * A whole Buzz thread laid out like Reddit's: the post, "Best ⌄", the replies as a flat list with thread lines,
 * a button that jumps to the next top-level reply and the "Join the conversation" bar stuck to the bottom.
 */
export function BuzzThread({ post, comments: initialComments, signedIn }: { post: BuzzPost; comments: BuzzComment[]; signedIn: boolean }) {
  const router = useRouter();
  const [comments, setComments] = useState(initialComments);
  // Votes cast on this page. Kept apart from `comments` so "Best" does not reshuffle the replies under your finger.
  const [votes, setVotes] = useState<Record<string, Tally>>({});
  const [sort, setSort] = useState<BuzzCommentSort>("best");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [replyTo, setReplyTo] = useState<{ id: string; alias: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [justPosted, setJustPosted] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const path = `/buzz/${post.id}`;
  const login = `/login?next=${encodeURIComponent(path)}`;

  const rows = useMemo<Row[]>(() => {
    const flat = threadBuzzComments(comments, sort);
    const parentOf = new Map(flat.map((c) => [c.id, c.parentId]));
    const hidden = new Set<string>();
    const out: Row[] = [];
    for (const c of flat) {
      const chain: string[] = [];
      for (let p = c.parentId; p && parentOf.has(p) && chain.length < 64; p = parentOf.get(p) ?? null) chain.unshift(p);
      // The list is in thread order, so a parent is always decided before its replies.
      if (chain.some((id) => collapsed.has(id) || hidden.has(id))) {
        hidden.add(c.id);
        continue;
      }
      out.push({ ...c, lines: chain.slice(0, c.depth) });
    }
    return out;
  }, [comments, sort, collapsed]);
  const topLevel = rows.filter((r) => r.depth === 0).length;

  // Bring the reply you just posted into view (it may have landed below other replies).
  useEffect(() => {
    if (!justPosted) return;
    document.getElementById(`reply-${justPosted}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    // The tint only points the reply out; it fades once you have seen where it landed.
    const timer = setTimeout(() => setJustPosted(null), 2500);
    return () => clearTimeout(timer);
  }, [justPosted]);

  function fresh(list: BuzzComment[]) {
    setComments(list);
    setVotes({});
  }

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    const body = text.trim();
    if (!body || pending) return;
    setError(null);
    const parent = replyTo;
    const before = new Set(comments.map((c) => c.id));
    start(async () => {
      const result = await addBuzzCommentAction(post.id, body, parent?.id ?? null).catch(() => ({ error: "Could not post your reply.", comments: undefined }));
      if (result.error || !result.comments) {
        setError(result.error ?? "Could not post your reply.");
        return;
      }
      // Other people see a new reply after a short delay, so the server's list is the one to trust.
      fresh(result.comments);
      if (parent) {
        setCollapsed((prev) => {
          if (!prev.has(parent.id)) return prev;
          const next = new Set(prev);
          next.delete(parent.id);
          return next;
        });
      }
      setJustPosted(result.comments.find((c) => c.isMine && !before.has(c.id))?.id ?? null);
      setText("");
      setReplyTo(null);
      setExpanded(false);
      inputRef.current?.blur();
    });
  }

  function replyToComment(c: BuzzComment) {
    setReplyTo({ id: c.id, alias: c.alias });
    setExpanded(true);
    inputRef.current?.focus();
  }

  function closeComposer() {
    setExpanded(false);
    setReplyTo(null);
    setError(null);
    inputRef.current?.blur();
  }

  async function removeReply(commentId: string) {
    const result = await deleteBuzzCommentAction(post.id, commentId);
    if (result.comments) fresh(result.comments);
    if (replyTo?.id === commentId) setReplyTo(null);
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
    // The hide covers every reply this person wrote here. An alias belongs to one person in one thread,
    // so it is a safe stand-in if the fresh list cannot be loaded.
    const list = (await listBuzzComments(createClient(), post.id).catch(() => null)) ?? comments.filter((c) => c.alias !== comment.alias);
    fresh(list);
    // Do not keep "Replying to ..." pointed at a reply that is no longer on the page.
    setReplyTo((r) => (r && !list.some((c) => c.id === r.id) ? null : r));
    router.refresh();
    return {};
  }

  /** Reddit's floating chevron: scroll to the next top-level reply, and back to the first one after the last. */
  function jumpToNext() {
    const tops = Array.from(document.querySelectorAll<HTMLElement>("[data-top-reply]"));
    // At the very bottom the last replies cannot scroll any higher, so "next" would be the same one for ever: start over.
    const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    const next = (atEnd ? undefined : tops.find((el) => el.getBoundingClientRect().top > JUMP_LINE)) ?? tops[0];
    next?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** The X goes back to the feed you came from (filters, search and scroll kept); otherwise it is a plain link to Buzz. */
  function closeThread(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (!cameFromBuzzFeed()) return;
    e.preventDefault();
    router.back();
  }

  function openSearch() {
    try {
      sessionStorage.setItem(BUZZ_FOCUS_SEARCH, "1");
    } catch {
      // Private mode: the link still opens Buzz with the search box at the top.
    }
  }

  const roundButton = "flex h-10 w-10 items-center justify-center rounded-full text-gray-900 transition-colors hover:bg-gray-100";
  const open = expanded || Boolean(replyTo);

  return (
    // At least as tall as the screen between the navbar and the reply bar's resting place, so the bar sits at the
    // bottom on a thread with few replies too. The negative margin takes back the part of the page padding the bar covers.
    <div
      className="-mx-3 -mt-4 mb-[calc(env(safe-area-inset-bottom)_-_2.25rem)] flex min-h-[calc(100dvh_-_7.25rem_-_1px_-_env(safe-area-inset-bottom))] flex-col sm:mx-0 sm:mt-0 sm:min-h-[calc(100dvh_-_8.25rem_-_1px_-_env(safe-area-inset-bottom))] md:-mb-5 md:min-h-[calc(100dvh_-_5.25rem_-_1px)]"
      data-testid="buzz-thread"
    >
      <div className="bg-white max-sm:flex-1 sm:rounded-xl sm:shadow-sm sm:ring-1 sm:ring-gray-200">
        <header className="flex items-center justify-between px-2 py-1.5">
          <Link href={BUZZ_HOME} onClick={closeThread} aria-label="Back to Buzz" title="Back to Buzz" className={roundButton}>
            <X className="h-6 w-6" />
          </Link>
          <div className="flex items-center gap-0.5">
            <Link href={`${BUZZ_HOME}#${BUZZ_SEARCH_ID}`} onClick={openSearch} aria-label="Search Buzz" title="Search Buzz" className={roundButton}>
              <Search className="h-[22px] w-[22px]" />
            </Link>
            <BuzzThreadMenu post={post} signedIn={signedIn} className="flex h-10 w-10 items-center justify-center" />
          </div>
        </header>

        <BuzzPostBlock post={post} signedIn={signedIn} replyCount={comments.length} />

        <section id="replies" aria-label="Replies" className="scroll-mt-16 border-t-[6px] border-gray-100">
          <div className="flex items-center gap-1 px-2 pt-1.5">
            <BuzzSortMenu label="Sort replies by" value={sort} options={BUZZ_COMMENT_SORTS} onSelect={(value) => setSort(BUZZ_COMMENT_SORTS.find((s) => s.value === value)?.value ?? "best")} />
            <h2 className="sr-only">{comments.length === 1 ? "1 reply" : `${comments.length} replies`}</h2>
          </div>

          {comments.length === 0 ? (
            <p className="px-4 pb-10 pt-6 text-center text-sm text-gray-500">No replies yet. Be the first to answer.</p>
          ) : (
            <ul className="pb-2 sm:[&>li:last-child]:rounded-b-xl">
              {rows.map((c, i) => {
                const folded = collapsed.has(c.id);
                const tally = votes[c.id] ?? { score: c.score, myVote: c.myVote };
                return (
                  <li
                    key={c.id}
                    id={`reply-${c.id}`}
                    data-testid="buzz-reply"
                    data-depth={c.depth}
                    data-top-reply={c.depth === 0 ? "" : undefined}
                    className={cn("flex scroll-mt-28 pl-4 transition-colors", c.depth === 0 && i > 0 && "mt-1 border-t-[6px] border-gray-100", justPosted === c.id && "bg-brand-50/60")}
                  >
                    {c.lines.map((ancestor) => (
                      // A shortcut for the mouse and the finger only. The keyboard and screen readers use each reply's own header button.
                      <button key={ancestor} type="button" tabIndex={-1} aria-hidden="true" onClick={() => toggle(ancestor)} title="Collapse this thread" className="group flex w-5 shrink-0 cursor-pointer justify-start self-stretch">
                        <span className="h-full w-px bg-gray-200 transition-colors group-hover:w-0.5 group-hover:bg-brand-500" />
                      </button>
                    ))}

                    <div className="min-w-0 flex-1 pr-3 pt-2.5">
                      <button type="button" onClick={() => toggle(c.id)} aria-expanded={!folded} aria-label={folded ? `Show ${c.alias}'s reply` : `Collapse ${c.alias}'s reply`} className="flex w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 text-left text-[13px] text-gray-500">
                        <BuzzAvatar alias={c.alias} className="mr-0.5" />
                        <span className="font-bold text-gray-600">{c.alias}</span>
                        <span aria-hidden="true">•</span>
                        <BuzzAge iso={c.createdAt} />
                        <BuzzBadges isOp={c.isOp} isMine={c.isMine} />
                        {folded ? <span className="rounded-full bg-gray-100 px-2 py-px text-xs font-semibold text-gray-700">[+{compactCount(c.replyCount + 1)}]</span> : null}
                      </button>

                      {folded ? (
                        <div className="h-2.5" />
                      ) : (
                        <>
                          <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-gray-900 [overflow-wrap:anywhere]">{c.body}</p>
                          <div className="flex items-center justify-end gap-1 text-gray-600">
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
                            />
                            {signedIn ? (
                              <button type="button" onClick={() => replyToComment(c)} className="inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-[13px] font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900" data-testid="buzz-reply-to">
                                <Reply className="h-[18px] w-[18px]" /> Reply
                              </button>
                            ) : (
                              <a href={login} className="inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-[13px] font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900" data-testid="buzz-reply-to">
                                <Reply className="h-[18px] w-[18px]" /> Reply
                              </a>
                            )}
                            <BuzzVote variant="bare" postId={post.id} commentId={c.id} score={tally.score} myVote={tally.myVote} signedIn={signedIn} onSettled={(next) => setVotes((prev) => ({ ...prev, [c.id]: next }))} />
                          </div>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Stuck to the bottom of the screen, above the phone's tab bar. */}
      <div className="pointer-events-none sticky bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-20 mt-auto px-3 pb-2 pt-3 sm:px-0 md:bottom-3">
        {topLevel > 1 ? (
          <div className="mb-2 flex justify-end">
            <button type="button" onClick={jumpToNext} aria-label="Jump to the next reply" title="Jump to the next reply" className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-900 shadow-lg ring-1 ring-gray-200 hover:bg-gray-50" data-testid="buzz-jump">
              <ChevronDown className="h-6 w-6" />
            </button>
          </div>
        ) : null}

        {signedIn ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className={cn("pointer-events-auto bg-white shadow-lg ring-1 ring-gray-200", open ? "rounded-2xl p-3" : "rounded-full px-4")}
            data-testid="buzz-composer"
          >
            {replyTo ? (
              <p className="mb-2 inline-flex max-w-full items-center gap-1 rounded-full bg-gray-100 py-1 pl-3 pr-1 text-xs text-gray-700" data-testid="buzz-replying-to">
                <span className="truncate">
                  Replying to <span className="font-semibold text-gray-900">{replyTo.alias}</span>
                </span>
                <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel" title="Answer the thread instead" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-gray-200">
                  <X className="h-3.5 w-3.5" />
                </button>
              </p>
            ) : null}
            <div className={cn("flex gap-3", open ? "items-start" : "items-center")}>
              {open ? null : <Plus className="h-5 w-5 shrink-0 text-gray-900" aria-hidden="true" />}
              <textarea
                ref={inputRef}
                name="body"
                rows={open ? 4 : 1}
                maxLength={MAX_REPLY}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onFocus={() => setExpanded(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                  if (e.key === "Escape" && !text.trim()) closeComposer();
                }}
                placeholder={open ? (replyTo ? `Reply to ${replyTo.alias}…` : "Reply anonymously…") : "Join the conversation"}
                aria-label="Join the conversation"
                className={cn("block min-w-0 flex-1 resize-none bg-transparent text-base text-gray-900 sm:text-[15px] outline-none placeholder:text-gray-500", open ? "leading-relaxed" : "h-12 overflow-hidden py-3 leading-6")}
                data-testid="buzz-reply-input"
              />
            </div>
            {open ? (
              <>
                <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-500">
                  <VenetianMask className="mt-px h-4 w-4 shrink-0" /> Your name is never shown. Be kind, and leave out other people&apos;s names and personal details.
                </p>
                {error ? (
                  <p className="mt-2 text-sm text-red-600" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="mt-2 flex items-center justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={closeComposer} className="rounded-full">
                    Close
                  </Button>
                  <Button type="submit" size="sm" loading={pending} disabled={!text.trim()} className="rounded-full px-4" data-testid="buzz-reply-send">
                    Reply
                  </Button>
                </div>
              </>
            ) : null}
          </form>
        ) : (
          <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-full bg-white py-1.5 pl-4 pr-1.5 shadow-lg ring-1 ring-gray-200">
            <p className="min-w-0 text-sm text-gray-700">Log in to reply. Your reply stays anonymous.</p>
            <LinkButton href={login} size="sm" className="rounded-full px-4">
              Log in
            </LinkButton>
          </div>
        )}
      </div>
    </div>
  );
}

type HistoryEntries = { entries(): { url: string | null }[]; currentEntry: { index: number } | null };

/** True when the page before this one in the tab's history is the Buzz feed, so "back" lands exactly there. */
function cameFromBuzzFeed(): boolean {
  try {
    const nav = (window as unknown as { navigation?: HistoryEntries }).navigation;
    const index = nav?.currentEntry?.index ?? -1;
    const before = index > 0 ? nav?.entries()[index - 1]?.url : null;
    if (!before) return false;
    const url = new URL(before);
    return url.origin === window.location.origin && url.pathname === "/" && url.searchParams.get("tab") === "buzz";
  } catch {
    return false;
  }
}
