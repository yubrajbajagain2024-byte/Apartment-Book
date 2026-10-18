"use client";

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Globe, Lock, Users, type LucideIcon } from "lucide-react";
import { ownSectionNote, PROFILE_SECTION_NOUNS, PROFILE_VISIBILITY_OPTIONS, type ProfileSection, type ProfileVisibility } from "@apartment-book/shared";
import { setVisibilityAction } from "@/lib/actions/profile-page";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

export const VISIBILITY_ICONS: Record<ProfileVisibility, LucideIcon> = { public: Globe, friends: Users, private: Lock };

/**
 * The owner's line above Classes, Saved and Liked: who can see the tab ("Only you can see your saved posts") and a
 * Change button with Everyone / Friends / Only me. The choice shows straight away; the page re-renders with it once saved.
 */
export function VisibilityControl({ section, value }: { section: ProfileSection; value: ProfileVisibility }) {
  const router = useRouter();
  const noun = PROFILE_SECTION_NOUNS[section];
  const [shown, setShown] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setShown(value);
  }
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const Icon = VISIBILITY_ICONS[shown];

  // The menu opens on the current choice; a click outside or Tab closes it.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[aria-checked='true']")?.focus();
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }

  function choose(next: ProfileVisibility) {
    close(true);
    if (next === shown) return;
    const before = shown;
    setShown(next);
    setError(null);
    startTransition(async () => {
      const result = await setVisibilityAction(section, next);
      if (result.error) {
        setShown(before);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  /** Arrow keys, Home and End move between the three choices; Escape closes and Tab leaves. */
  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitemradio']") ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") move(index + 1);
    else if (e.key === "ArrowUp") move(index - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(items.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") close(false);
  }

  return (
    <div className="border-b border-gray-100 px-4 py-2.5" data-testid={`profile-visibility-${section}`}>
      <div className="flex items-center gap-2.5 text-sm">
        <Icon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-gray-700">{ownSectionNote(section, shown)}</p>
        <div ref={rootRef} className="relative shrink-0">
          <button
            ref={buttonRef}
            type="button"
            onClick={() => (open ? close(false) : setOpen(true))}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-gray-100 px-3 text-xs font-semibold text-gray-900 hover:bg-gray-200"
            data-testid="profile-visibility-change"
          >
            {pending ? <Spinner className="h-3.5 w-3.5" /> : null}
            Change<span className="sr-only"> who can see your {noun}</span>
          </button>
          {open ? (
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={`Who can see your ${noun}`}
              onKeyDown={onMenuKeyDown}
              className="absolute right-0 top-full z-30 mt-1.5 w-64 rounded-xl bg-white p-1.5 text-left shadow-lg ring-1 ring-gray-200"
            >
              <p className="px-2.5 pb-1 pt-1 text-xs font-semibold text-gray-500">Who can see your {noun}</p>
              {PROFILE_VISIBILITY_OPTIONS.map((option) => {
                const checked = option.value === shown;
                const OptionIcon = VISIBILITY_ICONS[option.value];
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    tabIndex={checked ? 0 : -1}
                    onClick={() => choose(option.value)}
                    className={cn("flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline-none", checked && "bg-gray-50")}
                  >
                    <OptionIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-600" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-gray-900">{option.label}</span>
                      <span className="block text-xs text-gray-500">{option.description}</span>
                    </span>
                    {checked ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
