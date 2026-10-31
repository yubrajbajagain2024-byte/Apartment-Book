"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui/spinner";

/** Turns the fragment Supabase's default email links come back with into this app's session, or explains the error. */
function readFragment(): URLSearchParams {
  return new URLSearchParams(typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, ""));
}

function friendly(code: string | null, description: string | null): string {
  if (code === "otp_expired" || /expired/i.test(description ?? "")) return "This link has expired or was already used. Ask an owner or admin to send a new one.";
  if (code === "access_denied") return "This link could not be used. Ask an owner or admin to send a new one.";
  return description || "This link could not be used.";
}

/** Reads the fragment, signs in with it when it holds an invite or recovery session, and says what went wrong otherwise. */
async function openLink(): Promise<{ ok: true } | { ok: false; error: string }> {
  const hash = readFragment();
  // Drop the tokens from the address bar and the history right away.
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (hash.get("error_code") || hash.get("error")) return { ok: false, error: friendly(hash.get("error_code"), hash.get("error_description")) };
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  const type = hash.get("type");
  if (!accessToken || !refreshToken || (type !== "invite" && type !== "recovery")) {
    return { ok: false, error: "This link is incomplete. Open it again from the email, or ask for a new one." };
  }
  const { error } = await createClient().auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  return error ? { ok: false, error: friendly(null, error.message) } : { ok: true };
}

export function AcceptLink({ next, serverError }: { next: string; serverError: string | null }) {
  const [error, setError] = useState<string | null>(serverError);
  const [working, setWorking] = useState(!serverError);

  useEffect(() => {
    if (serverError) return;
    openLink().then((result) => {
      // A full navigation, so the server sees the new session cookies.
      if (result.ok) window.location.replace(next);
      else {
        setError(result.error);
        setWorking(false);
      }
    });
  }, [next, serverError]);

  if (working) {
    return (
      <p className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-600">
        <Spinner className="h-4 w-4" /> Checking your link…
      </p>
    );
  }
  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-sm text-red-700" role="alert">
        {error}
      </p>
      <Link href="/login" className="text-sm font-semibold text-brand-600 hover:underline">
        Go to the login page
      </Link>
    </div>
  );
}
