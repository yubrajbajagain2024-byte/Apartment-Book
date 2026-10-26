import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/utils";

/**
 * Where invitation and password-reset emails lead. With the recommended email template
 * (README: "Invitation emails"), the link carries ?token_hash=…&type=invite|recovery and
 * is verified here, on the server: one use, expiring, and proof that the person opened
 * the email. Supabase's default template instead sends the browser through its own
 * /verify, which comes back with the session in the URL fragment; servers never see a
 * fragment, so that case continues on /auth/accept (browsers keep the fragment across
 * this redirect). Only these two kinds of link are accepted.
 */
const ACCEPTED: EmailOtpType[] = ["invite", "recovery"];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"), "/password");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type) {
    if (!ACCEPTED.includes(type)) return NextResponse.redirect(`${origin}/auth/accept?error_description=${encodeURIComponent("This kind of link is not used here.")}`);
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      const expired = /expired|invalid/i.test(error.message);
      const message = expired ? "This link has expired or was already used. Ask an owner or admin to send a new one." : error.message;
      return NextResponse.redirect(`${origin}/auth/accept?error_description=${encodeURIComponent(message)}`);
    }
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Default Supabase template: the session (or an error) is in the fragment.
  return NextResponse.redirect(`${origin}/auth/accept?next=${encodeURIComponent(next)}`);
}
