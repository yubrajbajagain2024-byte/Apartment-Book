"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { joinPortal, PORTAL_PREFIX, portalPathname } from "@/lib/business/paths";

const PortalBaseContext = createContext<string>(PORTAL_PREFIX);

/** The prefix the portal's links need on this host ("" on business.campconnect.com, "/business" on the site). */
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
