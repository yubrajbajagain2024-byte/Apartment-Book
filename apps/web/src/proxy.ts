import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getBusinessHost, getSupabaseEnv } from "@/lib/env";
import { PORTAL_PREFIX } from "@/lib/business/paths";

/** Routes that require a signed-in user. */
const PROTECTED_PREFIXES = [
  "/messages",
  "/notifications",
  "/settings",
  "/saved",
  "/profile/me",
  "/apartments/new",
  "/roommates/new",
  "/marketplace/new",
  "/posts/new",
  "/reels/new",
  "/buzz/new",
];

/** The business portal's pages anyone may open; everything else in it needs a signed-in business account. */
const PORTAL_PUBLIC = ["/login", "/signup", "/join"];

function isProtectedPath(pathname: string): boolean {
  if (pathname.endsWith("/edit")) return true;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Is this request for the business portal's own host (NEXT_PUBLIC_BUSINESS_SITE_URL's)? There the portal answers at the
 * root: "/listings" is the page the site serves at "/business/listings". Any host that starts with "business." counts,
 * so a preview deployment with such an alias works before NEXT_PUBLIC_BUSINESS_SITE_URL is set.
 */
function isBusinessHost(request: NextRequest): boolean {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").toLowerCase().split(":")[0];
  if (!host) return false;
  const configured = getBusinessHost();
  return (configured !== null && host === configured) || host.startsWith("business.");
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const businessHost = isBusinessHost(request);
  // Auth callbacks and API routes are the same on every host.
  const shared = pathname.startsWith("/auth/") || pathname.startsWith("/api/");
  // The path inside the portal when this is a portal request, and the prefix its links need on this host.
  let portalPath: string | null = null;
  let base = PORTAL_PREFIX;
  if (businessHost && !shared) {
    base = "";
    portalPath = pathname === PORTAL_PREFIX ? "/" : pathname.startsWith(`${PORTAL_PREFIX}/`) ? pathname.slice(PORTAL_PREFIX.length) : pathname;
  } else if (pathname === PORTAL_PREFIX || pathname.startsWith(`${PORTAL_PREFIX}/`)) {
    portalPath = pathname === PORTAL_PREFIX ? "/" : pathname.slice(PORTAL_PREFIX.length);
  }
  // The portal's pages read their base from this header (server) and pass it down (client). Only the proxy sets it:
  // whatever a client sent under that name is dropped.
  const requestHeaders = new Headers(request.headers);
  if (portalPath !== null) requestHeaders.set("x-portal-base", base);
  else requestHeaders.delete("x-portal-base");

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refreshes the session cookie when needed. Do not remove.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (portalPath !== null) {
    const isPublic = PORTAL_PUBLIC.some((p) => portalPath === p || portalPath.startsWith(`${p}/`));
    if (!user && !isPublic) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = `${base}/login`;
      loginUrl.search = "";
      loginUrl.searchParams.set("next", `${portalPath}${search}`);
      return withCookies(NextResponse.redirect(loginUrl), response);
    }
    if (user && (portalPath === "/login" || portalPath === "/signup")) {
      const next = request.nextUrl.searchParams.get("next");
      const homeUrl = request.nextUrl.clone();
      homeUrl.pathname = `${base}${next && next.startsWith("/") && !next.startsWith("//") && next !== "/" ? next : ""}` || "/";
      homeUrl.search = "";
      return withCookies(NextResponse.redirect(homeUrl), response);
    }
    if (businessHost) {
      // The portal's own host serves its pages from the root: show the /business page for this path.
      const target = request.nextUrl.clone();
      target.pathname = portalPath === "/" ? PORTAL_PREFIX : `${PORTAL_PREFIX}${portalPath}`;
      const rewritten = NextResponse.rewrite(target, { request: { headers: requestHeaders } });
      rewritten.headers.set("Cache-Control", "private, no-store");
      return withCookies(rewritten, response);
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  if (!user && isProtectedPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return withCookies(NextResponse.redirect(loginUrl), response);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const next = request.nextUrl.searchParams.get("next");
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    homeUrl.search = "";
    return withCookies(NextResponse.redirect(homeUrl), response);
  }

  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/** Copy refreshed auth cookies onto a redirect response so the session is not lost. */
function withCookies(target: NextResponse, source: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}

export const config = {
  matcher: [
    // Run on every route except static assets and images.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
