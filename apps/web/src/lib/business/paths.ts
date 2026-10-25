/** The pages of the business portal live under /business; on the portal's own host that prefix is left off. */
export const PORTAL_PREFIX = "/business";

/** `base` is "/business" on the site, "" on the portal's own host. joinPortal("", "/") is "/". */
export function joinPortal(base: string, path: string): string {
  const rest = path === "/" ? "" : path;
  return `${base}${rest}` || "/";
}

/** A pathname as the portal sees it, whichever host it came in on: "/business/listings" and "/listings" are both "/listings". */
export function portalPathname(pathname: string): string {
  if (pathname === PORTAL_PREFIX) return "/";
  return pathname.startsWith(`${PORTAL_PREFIX}/`) ? pathname.slice(PORTAL_PREFIX.length) : pathname;
}
