"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Bookmark, Check, Flag, MoreHorizontal, Share2 } from "lucide-react";
import type { ReportTargetType } from "@apartment-book/shared";
import { ReportMenu } from "@/components/common/report-block";
import { cn } from "@/lib/utils";
import type { SaveController } from "@/components/common/save-button";
import { useShare } from "@/components/common/share-button";

const MENU_WIDTH = 208; // w-52

/** Right-align the menu under the button without pushing it past either screen edge (left-column tiles on phones). */
function placeBelow(button: HTMLButtonElement | null): { top: number; right: number } | null {
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  const right = Math.min(Math.max(8, window.innerWidth - rect.right), Math.max(8, window.innerWidth - MENU_WIDTH - 8));
  return { top: rect.bottom + 6, right };
}

/**
 * Facebook-style "•••" menu in a post header: Save/Unsave post and Share post.
 * The dropdown is position:fixed so the card's overflow-hidden can't clip it.
 */
export function PostMenu({ save, path, title, className, report }: { save: SaveController; path: string; title: string; className?: string; /** Enables "Report post" (omit on your own posts). */ report?: { targetType: ReportTargetType; targetId: string } }) {
  const [reporting, setReporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const { share, copied } = useShare(path, title);

  function toggle() {
    if (open) {
      setOpen(false);
      setReporting(false);
      return;
    }
    setReporting(false);
    setPos(placeBelow(buttonRef.current));
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // Follow the button while the page scrolls (a tap can trigger a late scroll on phones).
    const follow = () => setPos(placeBelow(buttonRef.current));
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  const item = "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-gray-900 hover:bg-gray-100 disabled:opacity-50";

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className)} onPointerDown={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }}
        aria-label="Post options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && pos ? (
        <div id={menuId} role="menu" aria-label="Post options" style={{ top: pos.top, right: pos.right }} className="fixed z-50 w-52 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-gray-200">
          {save.signedIn ? (
            <button
              type="button"
              role="menuitem"
              disabled={save.pending}
              onClick={() => {
                save.toggle();
                setOpen(false);
              }}
              className={item}
            >
              <Bookmark className={cn("h-5 w-5", save.saved && "fill-current text-brand-700")} />
              {save.saved ? "Unsave post" : "Save post"}
            </button>
          ) : (
            <a role="menuitem" href={`/login?next=${encodeURIComponent(path)}`} className={item}>
              <Bookmark className="h-5 w-5" /> Save post
            </a>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              const copiedNow = await share();
              // Leave "Link copied" on screen for a beat when there is no share sheet.
              if (copiedNow) setTimeout(() => setOpen(false), 900);
              else setOpen(false);
            }}
            className={item}
          >
            {copied ? <Check className="h-5 w-5 text-brand-600" /> : <Share2 className="h-5 w-5" />}
            {copied ? "Link copied" : "Share post"}
          </button>
          {report && save.signedIn ? (
            reporting ? (
              <ReportMenu targetType={report.targetType} targetId={report.targetId} onDone={() => setOpen(false)} className="border-t border-gray-100 pt-1.5" />
            ) : (
              <button type="button" role="menuitem" onClick={() => setReporting(true)} className={cn(item, "text-red-600")}>
                <Flag className="h-5 w-5" /> Report post
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
