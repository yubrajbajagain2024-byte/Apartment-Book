"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { joinPortal, PORTAL_PREFIX, portalPathname } from "@/lib/business/paths";

const PortalBaseContext = createContext<string>(PORTAL_PREFIX);

/** The prefix the portal's links need on this host ("" on the portal's own domain, "/business" on the site). */
export function PortalBaseProvider({ base, children }: { base: string; children: ReactNode }) {
  return <PortalBaseContext.Provider value={base}>{children}</PortalBaseContext.Provider>;
}

export function usePortalBase(): string {
  return useContext(PortalBaseContext);
}

/** `href("/listings")` is the address of that portal page on this host. */
export function usePortalHref(): (path: string) => string {
  const base = usePortalBase();
  return (path: string) => joinPortal(base, path);
}

/** The current page as the portal sees it ("/listings"), whichever host it is on. */
export function usePortalPathname(): string {
  return portalPathname(usePathname());
}

/** A link to a portal page, written without the base: <PortalLink href="/deals">. */
export function PortalLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const base = usePortalBase();
  return <Link href={joinPortal(base, href)} {...props} />;
}

/**
 * Prefetch a page in full, its data included, the moment someone shows they are about to open it: the pointer over
 * the link, keyboard focus, or a finger on it. A link merely in view prefetches only up to the page's loading state
 * (Next's default for pages that read the database), so the server renders nothing for pages nobody opens; once the
 * intent is shown the whole page is fetched, and the click lands on it with no loading state at all. Spread the result
 * onto a PortalLink. Next keeps the prefetched page for staleTimes.static (next.config.ts) and fetches it again on the
 * next intent after that; a server action that changes anything clears it at once.
 */
export function useIntentPrefetch(): { prefetch: true | null; onPointerEnter: () => void; onFocus: () => void; onTouchStart: () => void } {
  const [intent, setIntent] = useState(false);
  const show = () => setIntent(true);
  return { prefetch: intent ? true : null, onPointerEnter: show, onFocus: show, onTouchStart: show };
}

/** A PortalLink that prefetches its page in full on intent (the sidebar, a section's tabs, a period switch). */
export function IntentLink(props: ComponentProps<typeof PortalLink>) {
  const intent = useIntentPrefetch();
  return <PortalLink {...intent} {...props} />;
}
