import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/utils";

/**
 * Everything in this app is for staff. The proxy is the first gate: without a session
 * only the login, the auth callback, the "no access" page, robots.txt and the worker
 * endpoint (which checks its own secret) answer; with a session that has not passed
 * the second factor, only /security does. Whether the person is staff is decided by
 * the admin layout (database RPC), and every page and action re-checks in SQL.
 */
const PUBLIC_PATHS = ["/login", "/auth/callback", "/no-access", "/api/media/worker", "/robots.txt"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isSecurityPath(pathname: string): boolean {
  return pathname === "/security" || pathname.startsWith("/security/");
}

export async function proxy(request: NextRequest) {
  // The worker endpoint authenticates with its own secret (CRON_SECRET); no session is involved.
  if (request.nextUrl.pathname === "/api/media/worker") return finish(NextResponse.next({ request }));

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

  if (!user) {
    if (isPublicPath(pathname)) return finish(response);
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return finish(withCookies(NextResponse.redirect(loginUrl), response));
  }

  if (pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = safeNextPath(request.nextUrl.searchParams.get("next"));
    homeUrl.search = "";
    return finish(withCookies(NextResponse.redirect(homeUrl), response));
  }

  if (!isPublicPath(pathname) && !isSecurityPath(pathname)) {
    // The JWT says whether this session passed a second factor; the database re-checks
    // it (and that a verified authenticator still exists) on every admin call.
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel !== "aal2") {
      const securityUrl = request.nextUrl.clone();
      securityUrl.pathname = "/security";
      securityUrl.search = "";
      securityUrl.searchParams.set("next", `${pathname}${search}`);
      return finish(withCookies(NextResponse.redirect(securityUrl), response));
    }
  }

  return finish(response);
}

/** Never indexed, never cached: this is a private tool. */
function finish(res: NextResponse): NextResponse {
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

/** Copy refreshed auth cookies onto a redirect response so the session is not lost. */
function withCookies(target: NextResponse, source: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
