"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Link2, Search, Share, Users, X } from "lucide-react";
import { APP_NAME, listFriends, type ProfileSummary, type SharedPost } from "@apartment-book/shared";
import { sendSharedPostAction } from "@/lib/actions/messages";
import { isOptimizableImage } from "@/lib/images";
import { createClient } from "@/lib/supabase/client";
import { cn, errorMessage } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";

export type ShareDialogProps = {
  /** What is being shared, as it will appear in the friend's chat. */
  sharedPost: SharedPost;
  /** Absolute address of the shared thing, for "Copy link". */
  url: string;
  open: boolean;
  onClose: () => void;
  currentUser: { id: string } | null;
};

const NOTE_MAX = 500;
const MAX_RECIPIENTS = 20;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const KIND_NAME: Record<SharedPost["kind"], string> = { post: "Post", reel: "Reel", listing: "Listing" };

/** State for a share button: `show()` opens the sheet with the absolute address of `path`, `hide()` closes it. */
export function useShareDialog(path: string): { open: boolean; url: string; show: () => void; hide: () => void } {
  const [state, setState] = useState({ open: false, url: "" });
  const show = useCallback(() => setState({ open: true, url: `${window.location.origin}${path}` }), [path]);
  const hide = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  return { open: state.open, url: state.url, show, hide };
}

/**
 * Instagram's share sheet: your friends (people you follow who follow you back) as a grid of faces, a search box, tap
 * to pick one or more, an optional note and Send. Each friend gets a direct message carrying the post as a card.
 * A bottom sheet on phones, a centred card on wider screens; rendered on the body so no card's overflow or transform
 * can clip it. Remounts every time it opens, so nothing picked or typed is left over from last time.
 */
export function ShareDialog(props: ShareDialogProps) {
  if (!props.open || typeof document === "undefined") return null;
  return createPortal(<ShareSheet {...props} />, document.body);
}

function ShareSheet({ sharedPost, url, onClose, currentUser }: Omit<ShareDialogProps, "open">) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [query, setQuery] = useState("");
  /** The friends matching `q` when they were fetched; null until the first list arrives. */
  const [friends, setFriends] = useState<{ q: string; list: ProfileSummary[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [picked, setPicked] = useState<ProfileSummary[]>([]);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Where to come back to after logging in. Only read in the browser: the sheet never renders on the server.
  const [nextPath] = useState(() => `${window.location.pathname}${window.location.search}`);
  // Whether the browser has a system share sheet for "Share to…" (phones, Safari). Read the same way, once the sheet is up.
  const [canShare] = useState(() => typeof navigator !== "undefined" && typeof navigator.share === "function");
  const signedIn = Boolean(currentUser);
  const q = query.trim();
  const pickedIds = new Set(picked.map((p) => p.id));
  /** Sending, or sent and about to close: the recipients are fixed. */
  const busy = status !== "idle";

  // Focus moves into the sheet and goes back to the share button when it closes. The search box takes it only with a
  // mouse or trackpad: on a touch screen its keyboard would come up over the friends, so the sheet itself takes it there.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>("[data-autofocus]");
    const raisesKeyboard = first instanceof HTMLInputElement && !window.matchMedia("(pointer: fine)").matches;
    (first && !raisesKeyboard ? first : panel)?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);

  // The page behind does not scroll while the sheet is up.
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  // Escape closes the sheet and nothing else: handled on the window in the capture phase, so it wins over the Reels
  // feed's shortcuts and any drawer underneath wherever the focus happens to be.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // Friends, straight away on open and debounced while typing. State changes happen inside the timer callback.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await listFriends(createClient(), q);
        if (!cancelled) {
          setFriends({ q, list: found });
          setLoadError(null);
        }
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e, "Could not load your friends."));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, q ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, signedIn, reload]);

  function toggle(friend: ProfileSummary) {
    // A change now would not be sent, yet the sheet would still say "Sent".
    if (busy) return;
    setNotice(null);
    if (pickedIds.has(friend.id)) {
      setPicked(picked.filter((p) => p.id !== friend.id));
    } else if (picked.length >= MAX_RECIPIENTS) {
      setNotice(`You can send to up to ${MAX_RECIPIENTS} friends at a time.`);
    } else {
      setPicked([...picked, friend]);
    }
  }

  async function send() {
    if (picked.length === 0 || status !== "idle") return;
    setStatus("sending");
    setNotice(null);
    try {
      const result = await sendSharedPostAction(
        picked.map((p) => p.id),
        sharedPost,
        note,
      );
      if (result.error) {
        setStatus("idle");
        setNotice(result.error);
        return;
      }
      if (result.failed.length > 0) {
        // Keep the ones who did not get it picked, so one more tap on Send retries just them.
        const failed = picked.filter((p) => result.failed.includes(p.id));
        setPicked(failed);
        setStatus("idle");
        setNotice(`Could not send to ${failed.map((p) => p.full_name).join(", ")}. Try again.`);
        return;
      }
      setStatus("sent");
      closeTimer.current = setTimeout(onClose, 1200);
    } catch (e) {
      setStatus("idle");
      setNotice(errorMessage(e, "Could not send. Try again."));
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice("Could not copy the link.");
    }
  }

  /** "Share to…": the system share sheet, as the share buttons opened before this sheet. Ours closes once something was shared. */
  async function shareTo() {
    const title = sharedPost.title ?? (sharedPost.caption ? sharedPost.caption.slice(0, 80) : `${sharedPost.author.name} on ${APP_NAME}`);
    try {
      await navigator.share({ title, url });
      onClose();
    } catch (e) {
      // Closing the system sheet without sharing is not a failure: ours just stays open.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setNotice("Could not open the share sheet.");
    }
  }

  /** Keys pressed in the sheet stay in the sheet (the Reels feed's j / k shortcuts are behind it), and Tab cycles inside it. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (e.key !== "Tab" || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    // The sheet itself (focused by a click on its background, or on open on a touch screen) counts as outside, so Tab and
    // Shift+Tab go to the first and the last control rather than out of the sheet.
    const inside = active instanceof HTMLElement && active !== panelRef.current && panelRef.current.contains(active);
    if (e.shiftKey && (!inside || active === first)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (!inside || active === last)) {
      e.preventDefault();
      first.focus();
    }
  }

  const sendLabel = status === "sending" ? "Sending…" : status === "sent" ? "Sent" : "Send";
  const previewText = sharedPost.title ?? sharedPost.caption;

  return (
    <div role="dialog" aria-modal="true" aria-label="Share" onKeyDown={onKeyDown} className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/40" />
      {/* Focusable but not a Tab stop: a click anywhere on the sheet keeps the focus, and with it the keys, inside. */}
      <div ref={panelRef} tabIndex={-1} className="ab-fade-in relative flex max-h-[85dvh] w-full flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl focus:outline-none sm:max-h-[min(44rem,90dvh)] sm:w-[420px] sm:rounded-2xl" data-testid="share-dialog">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">Share</h2>
          <button type="button" onClick={onClose} aria-label="Close" data-autofocus={signedIn ? undefined : ""} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200">
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* What is being sent, so nobody shares the wrong thing. */}
        <div className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-2.5">
          {sharedPost.image_url ? (
            isOptimizableImage(sharedPost.image_url) ? (
              <Image src={sharedPost.image_url} alt="" width={44} height={44} sizes="44px" className="h-11 w-11 shrink-0 rounded-lg bg-gray-100 object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- a snapshot URL from a host next/image does not serve
              <img src={sharedPost.image_url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded-lg bg-gray-100 object-cover" />
            )
          ) : (
            <Avatar name={sharedPost.author.name} src={sharedPost.author.avatar_url} size="md" className="h-11 w-11" />
          )}
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold text-gray-900">{sharedPost.author.name}</p>
            <p className="truncate text-xs text-gray-500">{previewText || KIND_NAME[sharedPost.kind]}</p>
          </div>
        </div>

        {signedIn ? (
          <>
            <div className="relative shrink-0 px-4 pt-3">
              <Search className="pointer-events-none absolute left-7 top-[calc(50%+0.375rem)] h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search friends"
                aria-label="Search friends"
                autoComplete="off"
                data-autofocus=""
                className="h-10 w-full rounded-full bg-gray-100 pl-9 pr-9 text-sm text-gray-900 placeholder:text-gray-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
              {searching && friends !== null ? <Spinner className="absolute right-7 top-[calc(50%+0.375rem)] h-4 w-4 -translate-y-1/2 text-gray-400" /> : null}
            </div>

            <div className="min-h-[11rem] min-w-0 flex-1 overflow-y-auto px-4 py-3" aria-busy={searching}>
              {loadError ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <p className="text-sm text-red-600">{loadError}</p>
                  <button type="button" onClick={() => setReload((n) => n + 1)} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                    Retry
                  </button>
                </div>
              ) : friends === null ? (
                <ul className="grid grid-cols-4 gap-x-2 gap-y-4" aria-label="Loading friends">
                  {Array.from({ length: 8 }, (_, i) => (
                    <li key={i} className="flex flex-col items-center gap-1.5 p-1">
                      <span className="ab-skeleton h-16 w-16 rounded-full" />
                      <span className="ab-skeleton h-3 w-12 rounded" />
                    </li>
                  ))}
                </ul>
              ) : friends.list.length === 0 && friends.q === "" ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                    <Users className="h-6 w-6" />
                  </span>
                  <p className="text-sm text-gray-600">Friends you follow back show up here.</p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      router.push("/search");
                    }}
                    className={buttonClasses({ variant: "secondary", size: "sm" })}
                  >
                    Find people
                  </button>
                </div>
              ) : friends.list.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">No friends match “{friends.q}”.</p>
              ) : (
                <ul className="grid grid-cols-4 gap-x-2 gap-y-4">
                  {friends.list.map((friend) => {
                    const on = pickedIds.has(friend.id);
                    return (
                      <li key={friend.id} className="min-w-0">
                        <button
                          type="button"
                          onClick={() => toggle(friend)}
                          aria-label={friend.full_name}
                          aria-pressed={on}
                          aria-disabled={busy || undefined}
                          className="flex w-full flex-col items-center gap-1.5 rounded-xl p-1 text-center hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 aria-disabled:cursor-default aria-disabled:opacity-60 aria-disabled:hover:bg-transparent"
                        >
                          <span className="relative">
                            <Avatar name={friend.full_name} src={friend.avatar_url} size="lg" className={cn("h-16 w-16 text-lg ring-2 ring-offset-2 transition-shadow", on ? "ring-brand-600" : "ring-transparent")} />
                            {on ? (
                              <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white ring-2 ring-white">
                                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                              </span>
                            ) : null}
                          </span>
                          <span className={cn("line-clamp-2 w-full break-words text-xs leading-tight", on ? "font-semibold text-gray-900" : "text-gray-700")}>{friend.full_name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="shrink-0 border-t border-gray-200 px-4 py-3">
              {picked.length > 0 ? (
                <>
                  <p className="mb-2 truncate text-xs text-gray-500" data-testid="share-recipients">
                    To {picked.map((p) => p.full_name).join(", ")}
                  </p>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
                    rows={1}
                    maxLength={NOTE_MAX}
                    placeholder="Write a message…"
                    aria-label="Write a message"
                    disabled={status !== "idle"}
                    className="mb-2 max-h-24 min-h-10 w-full resize-none rounded-2xl bg-gray-100 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60"
                  />
                </>
              ) : null}
              <button
                type="button"
                onClick={() => void send()}
                disabled={picked.length === 0}
                // Not disabled while sending: a focused button that turns disabled drops the focus out of the sheet. send() ignores the presses.
                aria-disabled={busy || undefined}
                className={cn(buttonClasses({ className: "h-11 w-full rounded-xl aria-disabled:pointer-events-none" }), status === "sending" && "opacity-50")}
              >
                {status === "sending" ? <Spinner className="h-4 w-4" /> : status === "sent" ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
                {sendLabel}
              </button>
              <p role="status" aria-live="polite" className="sr-only">
                {busy ? sendLabel : ""}
              </p>
              {notice ? (
                <p role="alert" className="mt-2 text-xs text-red-600">
                  {notice}
                </p>
              ) : null}
              <SecondaryActions copied={copied} onCopy={() => void copyLink()} onShare={canShare ? () => void shareTo() : undefined} />
            </div>
          </>
        ) : (
          <div className="px-4 py-3">
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <Users className="h-6 w-6" />
              </span>
              <p className="text-sm text-gray-600">Send posts, reels and listings straight to friends you follow back.</p>
              <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className={buttonClasses({ size: "sm" })}>
                Log in to share with friends
              </Link>
            </div>
            {notice ? (
              <p role="alert" className="mt-2 text-xs text-red-600">
                {notice}
              </p>
            ) : null}
            <SecondaryActions copied={copied} onCopy={() => void copyLink()} onShare={canShare ? () => void shareTo() : undefined} />
          </div>
        )}
      </div>
    </div>
  );
}

/** The row under Send: copying the link and, where the browser has a system share sheet (phones, Safari), "Share to…". */
function SecondaryActions({ copied, onCopy, onShare }: { copied: boolean; onCopy: () => void; onShare?: () => void }) {
  const item = "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-gray-800 hover:bg-gray-100";
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-1">
      <button type="button" onClick={onCopy} className={item}>
        {copied ? <Check className="h-4 w-4 text-brand-600" /> : <Link2 className="h-4 w-4" />}
        {copied ? "Link copied" : "Copy link"}
      </button>
      {onShare ? (
        <button type="button" onClick={onShare} className={item}>
          <Share className="h-4 w-4" />
          Share to…
        </button>
      ) : null}
    </div>
  );
}
