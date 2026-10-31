import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/utils";

/**
 * Handles redirects back from Supabase Auth: OAuth (Google) and PKCE links send
 * `?code=...`; email links can send `?token_hash=...&type=...`. The admin app's own
 * URL must be in Supabase's redirect allow-list (see the root README).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"));

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(friendly(error.message))}`);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("Invalid sign-in link")}`);
}

/** "Database error saving new user" is what Supabase returns when the email-domain trigger refuses an address with no staff invitation. */
function friendly(message: string): string {
  if (/database error saving new user/i.test(message)) return "That Google account has no staff invitation and is not a university address, so it cannot sign in here.";
  return message;
}
