"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Ban, Flag, MoreHorizontal } from "lucide-react";
import { setBlockedAction } from "@/lib/actions/moderation";
import { firstNameOf } from "@/lib/profile";
import { cn } from "@/lib/utils";
import { ReportMenu } from "@/components/common/report-block";

/**
 * The square "•••" button next to Follow and Message on someone else's profile: Block / Unblock and Report, as the
 * profile offered before. Blocking re-renders the page (the follows both ways are gone, so the Follow button goes too).
 */
export function ProfileMoreMenu({ profileId, name, initialBlocked }: { profileId: string; name: string; initialBlocked: boolean }) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [blocked, setBlocked] = useState(initialBlocked);
  const [seen, setSeen] = useState(initialBlocked);
  if (seen !== initialBlocked) {
    setSeen(initialBlocked);
    setBlocked(initialBlocked);
  }
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const firstName = firstNameOf(name);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggleMenu() {
    setReporting(false);
    setError(null);
    setOpen((v) => !v);
  }

  function toggleBlock() {
    if (!blocked && !window.confirm(`Block ${name}? They won't be able to message you, and you won't see each other's posts.`)) return;
    startTransition(async () => {
      const result = await setBlockedAction(profileId, !blocked);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBlocked(!blocked);
      setOpen(false);
    });
  }

  const item = "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-gray-900 hover:bg-gray-100 disabled:opacity-50";

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleMenu}
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-900 hover:bg-gray-200"
        data-testid="profile-more"
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label="More options" className="absolute right-0 top-full z-30 mt-2 w-60 rounded-xl bg-white p-1.5 text-left shadow-lg ring-1 ring-gray-200">
          <button type="button" role="menuitem" disabled={pending} onClick={toggleBlock} className={item}>
            <Ban className="h-5 w-5 text-gray-600" />
            {blocked ? `Unblock ${firstName}` : `Block ${firstName}`}
          </button>
          {reporting ? (
            <ReportMenu targetType="profile" targetId={profileId} onDone={() => setOpen(false)} className="border-t border-gray-100 pt-1.5" />
          ) : (
            <button type="button" role="menuitem" onClick={() => setReporting(true)} className={cn(item, "text-red-600")}>
              <Flag className="h-5 w-5" /> Report {firstName}
            </button>
          )}
          {error ? (
            <p role="alert" className="px-2.5 pb-1 pt-1 text-xs text-red-600">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
