"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Ban, Check, ChevronDown, ChevronUp, Flag, Heart, ListFilter, MoreHorizontal, Reply as ReplyIcon, ThumbsDown, Trash2, X } from "lucide-react";
import { COMMENT_SORTS, compactCount, getMyCommentVotes, listComments, threadComments, timeAgo, type CommentSort, type CommentVote, type PostCommentNode, type PostCommentWithAuthor, type PostTargetType } from "@apartment-book/shared";
import { addCommentAction, deleteCommentAction, voteCommentAction } from "@/lib/actions/engagement";
import { setBlockedAction } from "@/lib/actions/moderation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ReportMenu } from "@/components/common/report-block";
import { Avatar } from "@/components/ui/avatar";

const PREVIEW = 3;
/** Holding a comment this long opens its options (about what TikTok uses). */
const LONG_PRESS_MS = 500;
/** A finger that travels further than this is scrolling, not holding. */
const LONG_PRESS_SLOP = 8;
/** The options menu keeps this far from the screen edges. */
const MENU_MARGIN = 8;
type Vote = -1 | 0 | 1;
type VoteResult = { error?: string; vote?: CommentVote };
/** One vote request in the air per comment; taps made meanwhile are remembered and the last one is sent after it (same as BuzzVote). */
type Flight = { wanted: Vote; settled: CommentVote; busy: boolean };
/** The options menu is anchored to a point inside a row (`dx`/`dy` from its corner), so it follows the row when the page scrolls. `opener` gets the focus back when it closes. */
type Anchor = { id: string; el: HTMLElement; opener: HTMLElement; dx: number; dy: number };
type MenuStep = "menu" | "report" | "block" | "delete";
/** Replies sit under the parent avatar (32px plus the gap); every level below moves another 16px in. */
const INDENT = ["", "ml-11", "ml-[60px]", "ml-[76px]"];
const menuItem = "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-gray-900 hover:bg-gray-100 disabled:opacity-50";
const rateButton = "flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:text-gray-900";

/** The given comments and every reply below them: the server cascades a delete, so the local list must too. */
function withReplies(list: PostCommentWithAuthor[], seeds: Iterable<string>): Set<string> {
  const gone = new Set(seeds);
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
 * Closes a popover on a press outside it or on Escape. Escape is caught on its way down and kept from the window, so the
 * reels drawer (which also closes on Escape) stays open while only the popover goes. Presses on `keep` elements are left
 * alone so the button that opened the popover can toggle it instead of closing and reopening it.
 */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void, keep?: string) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target && (ref.current?.contains(target) || (keep && target.closest(keep)))) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, ref, close, keep]);
}

/** The second step of a destructive menu item: the question, then Cancel or the action itself. */
function Confirm({ title, text, action, pending, onConfirm, onCancel }: { title: string; text?: string; action: string; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="p-1.5" role="group" aria-label={title}>
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      {text ? <p className="pt-1 text-xs text-gray-500">{text}</p> : null}
      <div className="flex gap-2 pt-3">
        <button type="button" onClick={onCancel} className="flex-1 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-200">
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={pending} className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
          {action}
        </button>
      </div>
    </div>
  );
}

/**
 * One comment: avatar, grey name (the poster's own carry "Author"), the body, then a line with the time, Reply, the "…"
 * options button (shown on hover, always on touch screens) and, on the right, the heart with its count and a thumbs-down.
 */
function CommentRow({
  c,
  ownerId,
  menuOpen,
  popped,
  setEl,
  onReply,
  onVote,
  onOptions,
  onContextMenu,
  onPressStart,
  onPressMove,
  onPressEnd,
  onClickCapture,
}: {
  c: PostCommentNode;
  ownerId: string;
  /** This comment's options menu is open. */
  menuOpen: boolean;
  /** "<comment id>:<vote>" of the button just pressed anywhere in the thread. */
  popped: string | null;
  setEl: (id: string, el: HTMLLIElement | null) => void;
  onReply: (c: PostCommentNode) => void;
  onVote: (c: PostCommentNode, arrow: 1 | -1) => void;
  onOptions: (c: PostCommentNode, button: HTMLButtonElement) => void;
  onContextMenu: (c: PostCommentNode, e: ReactMouseEvent<HTMLLIElement>) => void;
  onPressStart: (c: PostCommentNode, e: ReactPointerEvent<HTMLLIElement>) => void;
  onPressMove: (e: ReactPointerEvent<HTMLLIElement>) => void;
  onPressEnd: () => void;
  onClickCapture: (e: ReactMouseEvent<HTMLLIElement>) => void;
}) {
  const reply = c.depth > 0;
  const liked = c.myVote === 1;
  const disliked = c.myVote === -1;
  return (
    // Padding instead of a list gap, so the thread line runs unbroken from one reply to the next.
    <li
      ref={(el) => setEl(c.id, el)}
      data-testid="comment-row"
      data-depth={c.depth}
      // Focusable by script only: the options menu hands the focus back to the row when a right-click or a long press opened it.
      tabIndex={-1}
      className={cn("group relative flex items-start gap-2.5 py-1.5 [-webkit-touch-callout:none] [@media(hover:none)]:select-none", reply && "border-l border-gray-200 pl-3", INDENT[c.depth])}
      onContextMenu={(e) => onContextMenu(c, e)}
      onPointerDown={(e) => onPressStart(c, e)}
      onPointerMove={onPressMove}
      onPointerUp={onPressEnd}
      onPointerCancel={onPressEnd}
      onPointerLeave={onPressEnd}
      onClickCapture={onClickCapture}
    >
      <Link href={`/profile/${c.author.id}`} className="shrink-0">
        <Avatar name={c.author.full_name} src={c.author.avatar_url} size={reply ? "xs" : "sm"} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-tight text-gray-500">
          <Link href={`/profile/${c.author.id}`} className="hover:underline">
            {c.author.full_name}
          </Link>
          {c.user_id === ownerId ? (
            <>
              {" · "}
              <span className="text-brand-600">Author</span>
            </>
          ) : null}
        </p>
        <p className="whitespace-pre-line break-words text-[15px] leading-5 text-gray-900">{c.body}</p>
        <div className="flex items-center gap-3 pt-1 text-xs text-gray-500">
          <span suppressHydrationWarning>{timeAgo(c.created_at)}</span>
          {/* A 28px-tall hit area; the negative margins cancel it out in the layout, so the line looks the same. */}
          <button type="button" onClick={() => onReply(c)} aria-label="Reply" className="-mx-1 -my-1.5 flex h-7 items-center px-1 font-semibold hover:text-gray-900">
            Reply
          </button>
          <button
            type="button"
            data-comment-options
            onClick={(e) => onOptions(c, e.currentTarget)}
            aria-label="Comment options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={cn("flex h-6 w-6 items-center justify-center rounded-full hover:bg-gray-100 hover:text-gray-900", "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100", menuOpen && "opacity-100")}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => onVote(c, 1)} aria-label="Like comment" aria-pressed={liked} className={cn(rateButton, liked && "text-[#ed4956] hover:text-[#ed4956]")}>
              <Heart className={cn("h-4 w-4", liked && "fill-current text-[#ed4956]", popped === `${c.id}:1` && "ab-pop")} />
            </button>
            <span data-testid="comment-likes" aria-label={c.likes === 1 ? "1 like" : `${c.likes} likes`} aria-live="polite" className="min-w-2 text-xs font-medium tabular-nums text-gray-500">
              {c.likes > 0 ? compactCount(c.likes) : ""}
            </span>
            <button type="button" onClick={() => onVote(c, -1)} aria-label="Dislike comment" aria-pressed={disliked} className={cn(rateButton, disliked && "text-gray-900")}>
              <ThumbsDown className={cn("h-[15px] w-[15px]", disliked && "fill-current text-gray-900", popped === `${c.id}:-1` && "ab-pop")} />
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * TikTok-style comment thread: "N comments" with a sort button, then each comment as avatar, grey name, body, and a line
 * with the time, Reply, and a heart (with its count) and thumbs-down on the right. Replies are folded behind "View N
 * replies" and run along a thin line under the parent avatar. Holding a comment (or its "…" button / right-click) opens
 * Reply, Report, Block and Delete. The composer is a pill with "Add comment…", at the top (feed, detail page) or pinned
 * to the bottom (reels drawer). Loads on first open.
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
  composer = "top",
  hideHeader = false,
}: {
  targetType: PostTargetType;
  targetId: string;
  /** Count from the feed, so the header and "View all N comments" are right before anything loads. */
  totalComments: number;
  onCountChange?: (delta: number) => void;
  currentUser: { id: string; name: string; avatarUrl: string | null } | null;
  /** The post author: their comments carry the "Author" tag and they can delete any comment. */
  ownerId: string;
  /** Change this value to focus the comment input (e.g. when "Comment" is pressed). */
  focusToken?: number;
  /** Server-rendered comments (detail page) skip the initial fetch. */
  initialComments?: PostCommentWithAuthor[];
  className?: string;
  /** "top": the composer comes first, under the post's action buttons. "bottom": pinned under the list, like a comment sheet. */
  composer?: "top" | "bottom";
  /** Leave out the "N comments" line and its sort button. */
  hideHeader?: boolean;
}) {
  const router = useRouter();
  const [comments, setComments] = useState<PostCommentWithAuthor[] | null>(initialComments ?? null);
  // The viewer's votes and the live heart counts, kept apart from the comments so a vote never reorders the thread: Top ranks
  // on the counts as loaded, and the hearts cast since are folded in when a sort is picked.
  const [votes, setVotes] = useState<Record<string, -1 | 1>>({});
  const [tallies, setTallies] = useState<Record<string, { score: number; likes: number }>>({});
  const [sort, setSort] = useState<CommentSort>("top");
  const [sortOpen, setSortOpen] = useState(false);
  // A comment sheet shows the whole thread straight away; a feed card starts with a short preview.
  const [showAll, setShowAll] = useState(Boolean(initialComments) || composer === "bottom");
  // Top-level comments whose replies are unfolded ("View N replies").
  const [openThreads, setOpenThreads] = useState<Set<string>>(() => new Set());
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  // "<comment id>:<vote>" of the button just pressed, so only a tap pops the icon, never votes arriving from the server.
  const [popped, setPopped] = useState<string | null>(null);
  const [menu, setMenu] = useState<Anchor | null>(null);
  const [step, setStep] = useState<MenuStep>("menu");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const sortRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const rowEls = useRef(new Map<string, HTMLLIElement>());
  // The comment just posted: scrolled into view once it is on the page.
  const scrollTo = useRef<string | null>(null);
  // Comment ids whose votes were already looked up, and the votes in the air.
  const asked = useRef(new Set<string>());
  const flights = useRef(new Map<string, Flight>());
  // The finger holding a row, and whether the click that follows a long press should be ignored.
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const swallowClick = useRef(false);
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

  // The viewer's own votes come in a separate small query for the ids not looked up yet, so the list never waits for them.
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
          // A vote cast while the lookup was out is newer than what it brought back.
          for (const [id, vote] of Object.entries(mine)) if (!flights.current.has(id)) next[id] = vote;
          return next;
        }),
      () => {
        // Your own votes are a nicety: the thread reads fine with the counts alone.
      },
    );
  }, [comments, viewerId]);

  // Bring the comment just posted into view: with "Top" first it may land far below the composer.
  useEffect(() => {
    const id = scrollTo.current;
    if (!id) return;
    scrollTo.current = null;
    rowEls.current.get(id)?.scrollIntoView({ block: composer === "bottom" ? "center" : "nearest", behavior: "smooth" });
  }, [comments, composer]);

  const { rows, rootOf, byRoot, byId } = useMemo(() => {
    // Sorted on the counts as loaded, then the live tallies are laid over each row: a tap changes a number, never a place.
    const rows = threadComments(comments ?? [], votes, { sort }).map((r) => (tallies[r.id] ? { ...r, ...tallies[r.id] } : r));
    // Thread order puts a parent before its replies, so a reply's top-level comment is already known when it comes up.
    const rootOf = new Map<string, string>();
    const byRoot = new Map<string, PostCommentNode[]>();
    const byId = new Map<string, PostCommentNode>();
    for (const r of rows) {
      byId.set(r.id, r);
      const root = r.depth === 0 ? r.id : (rootOf.get(r.parent_id ?? "") ?? r.id);
      rootOf.set(r.id, root);
      if (r.depth > 0) byRoot.set(root, [...(byRoot.get(root) ?? []), r]);
    }
    return { rows, rootOf, byRoot, byId };
  }, [comments, votes, tallies, sort]);

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

  /** Picking a sort is the one moment the thread may move: the hearts cast since it loaded go into the comments, so Top re-ranks on them. */
  function changeSort(next: CommentSort) {
    setComments((prev) => prev?.map((c) => (tallies[c.id] ? { ...c, ...tallies[c.id] } : c)) ?? prev);
    setTallies({});
    setSort(next);
    setSortOpen(false);
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
      scrollTo.current = comment.id;
      setComments((prev) => [...(prev ?? []), comment]);
      if (parent) unfold(rootOf.get(parent.id) ?? parent.id);
      setShowAll(true);
      setBody("");
      setReplyTo(null);
      onCountChange?.(1);
    });
  }

  /**
   * Takes comments out of the list after the server removed them. The focus, handed back to one of their rows when the menu
   * closed, moves on to the composer, or to the row above when there is none.
   */
  function drop(gone: Set<string>, above: HTMLElement | null) {
    setComments((prev) => (prev ?? []).filter((c) => !gone.has(c.id)));
    // Do not keep "Replying to …" pointed at a comment that is no longer there.
    setReplyTo((r) => (r && gone.has(r.id) ? null : r));
    onCountChange?.(-gone.size);
    (ref.current ?? above)?.focus({ preventScroll: true });
  }

  /** The nearest row on the page above the given one that is not about to go. */
  function rowAbove(id: string, gone: Set<string>): HTMLElement | null {
    for (let i = rows.findIndex((r) => r.id === id) - 1; i >= 0; i--) {
      const el = rowEls.current.get(rows[i].id);
      if (el && !gone.has(rows[i].id)) return el;
    }
    return null;
  }

  /** Closes the menu and hands the focus back to what opened it, so a keyboard user is not dropped on the page body. */
  const closeMenu = useCallback(() => {
    // preventScroll: a wheel-scrolled thread must not jump back to the row when the menu is dismissed.
    menu?.opener.focus({ preventScroll: true });
    setMenu(null);
    setStep("menu");
  }, [menu]);

  const closeSort = useCallback(() => setSortOpen(false), []);

  function confirmDelete(id: string) {
    const gone = withReplies(comments ?? [], [id]);
    const above = rowAbove(id, gone);
    closeMenu();
    startTransition(async () => {
      const result = await deleteCommentAction(id);
      if (result.error) {
        setError(result.error);
        return;
      }
      drop(gone, above);
    });
  }

  /**
   * Blocking hides everything the person wrote, here and everywhere else, so their comments leave the thread at once. Only
   * their own: the server keeps the replies others left under them, which move up to the top level as they do after a reload.
   */
  function confirmBlock(row: PostCommentNode) {
    const gone = new Set((comments ?? []).filter((c) => c.user_id === row.user_id).map((c) => c.id));
    const above = rowAbove(row.id, gone);
    closeMenu();
    startTransition(async () => {
      const result = await setBlockedAction(row.user_id, true);
      if (result.error) {
        setError(result.error);
        return;
      }
      drop(gone, above);
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
    setTallies((prev) => ({ ...prev, [id]: { score: tally.score, likes: tally.likes } }));
    setVotes((prev) => {
      const next = { ...prev };
      if (tally.myVote === 0) delete next[id];
      else next[id] = tally.myVote;
      return next;
    });
  }

  /** The same button again clears your vote; the other one flips it. The count changes right away and the server's answer wins. */
  function cast(row: PostCommentNode, arrow: 1 | -1) {
    if (!currentUser) return toLogin();
    const next: Vote = row.myVote === arrow ? 0 : arrow;
    const flight = flights.current.get(row.id) ?? { wanted: row.myVote, settled: { score: row.score, likes: row.likes, myVote: row.myVote }, busy: false };
    flights.current.set(row.id, flight);
    flight.wanted = next;
    setError(null);
    setPopped(next === 0 ? null : `${row.id}:${next}`);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(12);
    // Only hearts are counted; a thumbs-down stays private.
    applyVote(row.id, { score: row.score - row.myVote + next, likes: row.likes - (row.myVote === 1 ? 1 : 0) + (next === 1 ? 1 : 0), myVote: next });
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

  /** Opens the options for a comment at a point inside its row (the "…" button, the right-click, or the finger); `opener` gets the focus back afterwards. */
  function openMenu(id: string, el: HTMLElement, opener: HTMLElement, x: number, y: number) {
    const rect = el.getBoundingClientRect();
    setStep("menu");
    setMenu({ id, el, opener, dx: x - rect.left, dy: y - rect.top });
  }

  function cancelPress() {
    if (!press.current) return;
    clearTimeout(press.current.timer);
    press.current = null;
  }

  /** Touch only: a mouse has the "…" button and the right-click. */
  function startPress(c: PostCommentNode, e: ReactPointerEvent<HTMLLIElement>) {
    if (e.pointerType === "mouse" || e.button !== 0) return;
    cancelPress();
    const el = e.currentTarget;
    const { clientX: x, clientY: y } = e;
    const timer = setTimeout(() => {
      press.current = null;
      // The tap that ends the hold would otherwise press whatever is under the finger; the flag clears itself in case no click comes.
      swallowClick.current = true;
      setTimeout(() => (swallowClick.current = false), 700);
      openMenu(c.id, el, el, x, y);
    }, LONG_PRESS_MS);
    press.current = { x, y, timer };
  }

  function movePress(e: ReactPointerEvent<HTMLLIElement>) {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP) cancelPress();
  }

  /** Puts the menu beside its anchor, flipped above it when there is no room below, and never past a screen edge. */
  const place = useCallback(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const row = menu.el.getBoundingClientRect();
    const x = row.left + menu.dx;
    const y = row.top + menu.dy;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(Math.max(MENU_MARGIN, x), Math.max(MENU_MARGIN, window.innerWidth - width - MENU_MARGIN));
    const top = y + 6 + height > window.innerHeight - MENU_MARGIN ? Math.max(MENU_MARGIN, y - height - 6) : y + 6;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }, [menu]);

  // Positioned before the first paint, and again whenever its contents change size (the report reasons, a confirmation).
  useLayoutEffect(() => {
    place();
  }, [place, step]);

  useEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const observer = new ResizeObserver(() => place());
    observer.observe(el);
    // Follow the row while the page scrolls (a tap can trigger a late scroll on phones).
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [menu, place]);

  // Keyboard users land on the first item of each step (Cancel, on a confirmation).
  useEffect(() => {
    if (menu) menuRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [menu, step]);

  useDismiss(menu !== null, menuRef, closeMenu, "[data-comment-options]");
  useDismiss(sortOpen, sortRef, closeSort);

  const tops = rows.filter((r) => r.depth === 0);
  // Collapsed: the newest few top-level comments, their replies behind "View all". Expanded: the thread, replies folded under each comment.
  const preview = [...tops].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-PREVIEW);
  const hidden = showAll ? 0 : comments === null ? Math.max(0, totalComments - PREVIEW) : rows.length - preview.length;
  // Once the thread is here its own count is the truth; before that, the feed's.
  const count = comments?.length ?? totalComments;
  const menuRow = menu ? byId.get(menu.id) : undefined;
  const mine = menuRow !== undefined && currentUser?.id === menuRow.user_id;
  const canDelete = menuRow !== undefined && currentUser !== null && (mine || currentUser.id === ownerId);
  const hasText = body.trim().length > 0;

  const setRowEl = useCallback((id: string, el: HTMLLIElement | null) => {
    if (el) rowEls.current.set(id, el);
    else rowEls.current.delete(id);
  }, []);

  /** The "…" button: the menu opens under it, or closes when it is already open for this comment. */
  function openFromButton(c: PostCommentNode, button: HTMLButtonElement) {
    if (menu?.id === c.id) return closeMenu();
    const rect = button.getBoundingClientRect();
    openMenu(c.id, button.closest("li") ?? button, button, rect.left, rect.bottom);
  }

  function onRowContextMenu(c: PostCommentNode, e: ReactMouseEvent<HTMLLIElement>) {
    e.preventDefault();
    cancelPress();
    openMenu(c.id, e.currentTarget, e.currentTarget, e.clientX, e.clientY);
  }

  /** The tap that ends a long press must not press whatever is under the finger. */
  function swallow(e: ReactMouseEvent<HTMLLIElement>) {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  const row = (c: PostCommentNode) => (
    <CommentRow key={c.id} c={c} ownerId={ownerId} menuOpen={menu?.id === c.id} popped={popped} setEl={setRowEl} onReply={startReply} onVote={cast} onOptions={openFromButton} onContextMenu={onRowContextMenu} onPressStart={startPress} onPressMove={movePress} onPressEnd={cancelPress} onClickCapture={swallow} />
  );

  // The thread: each top-level comment, its replies when unfolded, then "View N replies" / "Hide replies" closing the block.
  const items: ReactNode[] = [];
  if (showAll) {
    for (const t of tops) {
      const open = openThreads.has(t.id);
      items.push(row(t));
      if (open) for (const r of byRoot.get(t.id) ?? []) items.push(row(r));
      if (t.replyCount > 0) {
        items.push(
          <li key={`${t.id}:replies`} className="ml-11 pb-1">
            <button type="button" onClick={() => toggleThread(t.id)} aria-expanded={open} className="inline-flex h-7 items-center gap-2 text-xs font-semibold text-gray-500 hover:text-gray-900">
              <span aria-hidden="true" className="h-px w-6 bg-gray-300" />
              {open ? "Hide replies" : t.replyCount === 1 ? "View 1 reply" : `View ${t.replyCount} replies`}
              {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </li>,
        );
      }
    }
  } else {
    for (const t of preview) items.push(row(t));
  }

  const header =
    showAll && !hideHeader ? (
      // In a comment sheet the line stays at the top while the thread scrolls under it; the negative margins keep its place in the flow.
      <div className={cn("flex items-center justify-center gap-1", composer === "bottom" && "sticky top-0 z-10 -mb-2 -mt-3 bg-white pb-2 pt-3")}>
        <p className="text-base font-bold text-gray-900">{count === 0 ? "No comments yet" : count === 1 ? "1 comment" : `${compactCount(count)} comments`}</p>
        {count > 0 ? (
          <div ref={sortRef} className="relative">
            <button type="button" onClick={() => setSortOpen((o) => !o)} aria-label="Sort comments" aria-haspopup="menu" aria-expanded={sortOpen} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 hover:text-gray-900">
              <ListFilter className="h-4 w-4" />
            </button>
            {sortOpen ? (
              <div role="menu" aria-label="Sort comments" className="absolute left-1/2 top-full z-30 mt-1 w-36 -translate-x-1/2 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-gray-200">
                {COMMENT_SORTS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={o.value === sort}
                    onClick={() => changeSort(o.value)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm font-medium text-gray-900 hover:bg-gray-100"
                  >
                    {o.label}
                    {o.value === sort ? <Check className="h-4 w-4 text-brand-600" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null;

  const composerNode = currentUser ? (
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
      <div className="flex items-end gap-2">
        <Avatar name={currentUser.name} src={currentUser.avatarUrl} size="sm" className="mb-0.5" />
        <div className="flex min-w-0 flex-1 items-end rounded-[20px] bg-gray-100 py-0.5 pl-4 pr-1.5 focus-within:ring-2 focus-within:ring-brand-200">
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
            placeholder={replyTo ? "Add a reply…" : "Add comment…"}
            aria-label="Write a comment"
            className="max-h-32 min-h-[36px] w-full resize-none bg-transparent py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending || !hasText}
            aria-label="Post comment"
            className={cn("mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors", hasText ? "bg-brand-600 text-white hover:bg-brand-700" : "bg-gray-200 text-gray-400")}
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  ) : (
    <p className="text-sm text-gray-600">
      <Link href="/login" className="font-semibold text-brand-700 hover:underline">
        Log in
      </Link>{" "}
      to join the conversation.
    </p>
  );

  return (
    <div className={cn("flex flex-col gap-3 border-t border-gray-100 px-3 py-3", className)} data-testid="comments">
      {header}
      {composer === "top" ? composerNode : null}

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => {
            setShowAll(true);
            if (comments === null) void load();
          }}
          className="self-start text-sm font-semibold text-gray-600 hover:underline"
        >
          View {hidden === 1 ? "1 more comment" : `all ${count} comments`}
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

      {items.length > 0 ? <ul className="flex flex-col">{items}</ul> : null}

      {composer === "bottom" ? <div className="sticky bottom-0 mt-auto bg-white pt-2">{composerNode}</div> : null}

      {menu && menuRow
        ? createPortal(
            // On the body, not in the row: a card's overflow-hidden and the drawer's transform would otherwise clip or misplace it.
            <div ref={menuRef} role={step === "menu" || step === "report" ? "menu" : "dialog"} aria-label="Comment options" className="fixed z-[60] w-56 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-gray-200">
              {step === "menu" ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeMenu();
                      startReply(menuRow);
                    }}
                    className={menuItem}
                  >
                    <ReplyIcon className="h-4 w-4 text-gray-500" /> Reply
                  </button>
                  {!mine ? (
                    <button type="button" role="menuitem" onClick={() => (currentUser ? setStep("report") : toLogin())} className={menuItem}>
                      <Flag className="h-4 w-4 text-gray-500" /> Report
                    </button>
                  ) : null}
                  {!mine ? (
                    <button type="button" role="menuitem" onClick={() => (currentUser ? setStep("block") : toLogin())} className={menuItem}>
                      <Ban className="h-4 w-4 text-gray-500" /> Block {menuRow.author.full_name.split(" ")[0]}
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button type="button" role="menuitem" onClick={() => setStep("delete")} className={cn(menuItem, "text-red-600")}>
                      <Trash2 className="h-4 w-4" /> Delete
                    </button>
                  ) : null}
                </>
              ) : step === "report" ? (
                <ReportMenu targetType="comment" targetId={menuRow.id} onDone={closeMenu} />
              ) : step === "block" ? (
                <Confirm title={`Block ${menuRow.author.full_name}?`} text="They won't be able to message you, and you won't see each other's posts or comments." action="Block" pending={pending} onConfirm={() => confirmBlock(menuRow)} onCancel={closeMenu} />
              ) : (
                <Confirm title="Delete this comment?" text={menuRow.replyCount > 0 ? "Its replies go with it." : undefined} action="Delete" pending={pending} onConfirm={() => confirmDelete(menuRow.id)} onCancel={closeMenu} />
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
