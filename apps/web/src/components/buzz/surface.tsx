"use client";

/**
 * The root of every Buzz screen on the website (Home → Buzz, a thread, search, My buzzes):
 *  - paints the Phosphor world (`data-surface="incognito"`);
 *  - binds all Buzz state to the signed-in account before anything renders (`bindBuzzOwner`): another account, or
 *    none, starts from nothing — drafts, folds, search and cached Buzz data are gone;
 *  - mounts the Buzz toaster and the moderation sheets;
 *  - and, while a Buzz screen is on show, swaps the viewer's own photo in the site header for a neutral glyph, the way
 *    UniVerse's top bar crossfades the avatar away on Buzz: at rest, nothing on screen next to Buzz shows who you are.
 */
import { createContext, Fragment, useContext, useLayoutEffect, useMemo, type ReactNode } from "react";
import { buzzFixtureVariant, enableBuzzFixtures } from "./api";
import { BuzzModerationHost } from "./moderation";
import { bindBuzzOwner, useBuzzOwner } from "./store";
import { BuzzToaster } from "./toast";

interface BuzzSession {
  signedIn: boolean;
  /** Development fixture variant in use, or null. */
  fixture: string | null;
}

const SessionContext = createContext<BuzzSession>({ signedIn: false, fixture: null });

export function useBuzzSession(): BuzzSession {
  return useContext(SessionContext);
}

/**
 * The header's account button (components/layout/menus.tsx: `aria-label="Account menu"`) keeps working; only its
 * picture is covered by a neutral person glyph while a Buzz root is in the page. `:has()` makes it hold from the very
 * first paint (no flash of the photo) and lets go the moment Buzz leaves the page.
 */
const NEUTRAL_GLYPH =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%231f2937' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Ccircle cx='12' cy='10' r='3'/%3E%3Cpath d='M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662'/%3E%3C/svg%3E";
const HIDE_OWN_AVATAR = `html:has([data-buzz-root]) button[aria-label="Account menu"]{position:relative}
html:has([data-buzz-root]) button[aria-label="Account menu"]>*{opacity:0}
html:has([data-buzz-root]) button[aria-label="Account menu"]::after{content:"";position:absolute;inset:0;margin:auto;width:40px;height:40px;border-radius:9999px;background:#e5e7eb url("${NEUTRAL_GLYPH}") center/22px no-repeat}`;

export function BuzzSurface({
  userId,
  fixtures,
  className,
  fallback,
  children,
}: {
  /** The signed-in user's id (from the server), or null when signed out. Never shown, only compared. */
  userId: string | null;
  /** `?buzzFixtures=` from the page (development only). */
  fixtures?: string | null;
  className?: string;
  /** What shows for the instant before the state is bound (and on the server). */
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const fixture = process.env.NODE_ENV !== "production" ? fixtures || buzzFixtureVariant() : null;
  const expected = fixture ? `fixture:${fixture}` : userId;
  const owner = useBuzzOwner();
  useLayoutEffect(() => {
    if (fixture) enableBuzzFixtures(fixture);
    bindBuzzOwner(expected);
  }, [fixture, expected]);
  const session = useMemo<BuzzSession>(() => ({ signedIn: expected !== null, fixture }), [expected, fixture]);
  const ready = owner === expected;
  return (
    <div data-surface="incognito" data-buzz-root="" className={className}>
      <style>{HIDE_OWN_AVATAR}</style>
      <SessionContext.Provider value={session}>
        {/* Keyed by account: a change of account remounts everything, so nothing reads the wiped state. */}
        {ready ? <Fragment key={String(expected)}>{children}</Fragment> : (fallback ?? null)}
        {ready ? (
          <>
            <BuzzToaster />
            <BuzzModerationHost />
          </>
        ) : null}
      </SessionContext.Provider>
    </div>
  );
}
