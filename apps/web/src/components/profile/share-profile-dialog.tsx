"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, Link2, QrCode, Share, X } from "lucide-react";
import { APP_NAME, qrMatrix, qrSvgPath } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";

/** Whose profile the sheet shares, and its absolute address (the site's own URL, so the code works off this device too). */
export type ShareProfileTarget = { url: string; name: string; username: string | null; avatarUrl: string | null; isMe: boolean };

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** About how wide the code is drawn; each square gets a whole number of pixels so the edges stay crisp. */
const QR_TARGET_PX = 200;
/** Scanners want four empty squares around the code. */
const QUIET_ZONE = 4;

/**
 * "Share profile" (or the QR mark next to the @handle): a button that opens the share sheet. Each button owns its sheet,
 * so the focus goes back to the one that opened it.
 */
export function ShareProfileButton({ target, variant, className }: { target: ShareProfileTarget; variant: "button" | "qr"; className?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      {variant === "qr" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Show profile QR code"
          aria-haspopup="dialog"
          className={cn("inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 hover:text-gray-900", className)}
          data-testid="profile-qr-button"
        >
          <QrCode className="h-4 w-4" />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={className} data-testid="share-profile-button">
          Share profile
        </button>
      )}
      <ShareProfileDialog open={open} onClose={close} target={target} />
    </>
  );
}

/** The sheet itself: the QR code of the profile's address, the name and @handle, Copy link and the system share sheet. */
export function ShareProfileDialog({ open, onClose, target }: { open: boolean; onClose: () => void; target: ShareProfileTarget }) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<ShareProfileSheet onClose={onClose} target={target} />, document.body);
}

function ShareProfileSheet({ onClose, target }: { onClose: () => void; target: ShareProfileTarget }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Phones and Safari have a system share sheet; read once, in the browser (the sheet never renders on the server).
  const [canShare] = useState(() => typeof navigator !== "undefined" && typeof navigator.share === "function");
  const matrix = useMemo(() => qrMatrix(target.url), [target.url]);
  const path = useMemo(() => qrSvgPath(matrix), [matrix]);
  const n = matrix.length;
  const cell = Math.max(3, Math.floor(QR_TARGET_PX / Math.max(1, n)));
  const qrLabel = target.isMe ? "QR code for your profile" : `QR code for ${target.name}'s profile`;

  // Focus moves into the sheet (its Close button) and goes back to whatever opened it when it closes.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]");
    (first ?? panelRef.current)?.focus();
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

  // Escape closes the sheet and nothing underneath it.
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
    },
    [],
  );

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(target.url);
      setNotice(null);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice("Could not copy the link.");
    }
  }

  async function shareTo() {
    try {
      await navigator.share({ title: `${target.name} on ${APP_NAME}`, url: target.url });
      onClose();
    } catch (e) {
      // Closing the system sheet without sharing is not a failure: ours just stays open.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setNotice("Could not open the share sheet.");
    }
  }

  /** Keys stay in the sheet, and Tab cycles inside it. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (e.key !== "Tab" || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && active !== panelRef.current && panelRef.current.contains(active);
    if (e.shiftKey && (!inside || active === first)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (!inside || active === last)) {
      e.preventDefault();
      first.focus();
    }
  }

  const action = "inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-gray-100 px-4 text-sm font-semibold text-gray-900 hover:bg-gray-200";

  return (
    <div role="dialog" aria-modal="true" aria-label="Share profile" onKeyDown={onKeyDown} className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" data-testid="share-profile-dialog">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div ref={panelRef} tabIndex={-1} className="ab-fade-in relative flex max-h-[90dvh] w-full flex-col overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl focus:outline-none sm:w-[380px] sm:rounded-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">Share profile</h2>
          <button type="button" onClick={onClose} aria-label="Close" data-autofocus="" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex flex-col items-center gap-4 px-5 pb-5 pt-5">
          <div className="flex min-w-0 max-w-full flex-col items-center gap-1 text-center">
            <Avatar name={target.name} src={target.avatarUrl} size="lg" />
            <p className="mt-1 max-w-full truncate text-base font-bold text-gray-900">{target.name}</p>
            {target.username ? <p className="max-w-full truncate text-sm text-gray-600">@{target.username}</p> : null}
          </div>
          {/* The code on white with its quiet zone, so it scans from a screen in any light. */}
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200" style={{ padding: cell * QUIET_ZONE }}>
            <svg role="img" aria-label={qrLabel} viewBox={`0 0 ${n} ${n}`} width={cell * n} height={cell * n} shapeRendering="crispEdges" className="block" data-testid="profile-qr">
              <path d={path} fill="#000" />
            </svg>
          </div>
          <p className="max-w-full select-all truncate text-xs text-gray-500">{target.url}</p>
          <div className="flex w-full gap-2">
            <button type="button" onClick={() => void copyLink()} className={action}>
              {copied ? <Check className="h-4 w-4 text-brand-600" /> : <Link2 className="h-4 w-4" />}
              {copied ? "Link copied" : "Copy link"}
            </button>
            {canShare ? (
              <button type="button" onClick={() => void shareTo()} className={action}>
                <Share className="h-4 w-4" />
                Share to…
              </button>
            ) : null}
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {copied ? "Link copied" : ""}
          </p>
          {notice ? (
            <p role="alert" className="text-xs text-red-600">
              {notice}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
