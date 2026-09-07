import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/env";

/** Routes that require a signed-in user. */
const PROTECTED_PREFIXES = [
  "/messages",
  "/settings",
  "/saved",
  "/profile/me",
  "/apartments/new",
  "/roommates/new",
  "/marketplace/new",
];

function isProtectedPath(pathname: string): boolean {
  if (pathname.endsWith("/edit")) return true;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refreshes the session cookie when needed. Do not remove.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

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
