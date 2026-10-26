"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { confirmTotpEnrollment, getMfaStatus, startTotpEnrollment, verifyTotp, type MfaStatus, type TotpEnrollment } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : "Something went wrong. Try again.");

/**
 * Steps the session up to aal2: a code from an authenticator the account already has, or adding one first (QR code
 * or the secret typed by hand, then its first code). Afterwards the console opens.
 */
export function StaffTwoFactor() {
  const router = useRouter();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    getMfaStatus(createClient())
      .then((s) => {
        if (s.verified) router.replace("/admin");
        else setStatus(s);
      })
      .catch((e) => setError(message(e)));
  }, [router]);

  const factor = status?.factors.find((f) => f.status === "verified") ?? null;

  function addAuthenticator() {
    setError(null);
    start(async () => {
      try {
        setEnrollment(await startTotpEnrollment(createClient(), "UniBuzz staff console"));
      } catch (e) {
        setError(message(e));
      }
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setError(null);
    start(async () => {
      try {
        const supabase = createClient();
        if (enrollment) await confirmTotpEnrollment(supabase, enrollment.factorId, digits);
        else if (factor) await verifyTotp(supabase, factor.id, digits);
        router.replace("/admin");
        router.refresh();
      } catch (err) {
        setCode("");
        setError(/invalid|expired/i.test(message(err)) ? "That code didn't work. Enter the newest one from the app." : message(err));
      }
    });
  }

  if (!status) {
    return error ? <p className="text-sm text-red-700">{error}</p> : <Spinner />;
  }

  const askCode = Boolean(enrollment || factor);
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5">
      {enrollment ? (
        <>
          <p className="text-sm text-gray-700">Scan this with your authenticator app, then enter the code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL Supabase generates; nothing to optimize */}
          <img src={enrollment.qrCode} alt="QR code for your authenticator app" className="mx-auto h-48 w-48" />
          <p className="text-xs text-gray-600">
            Can&apos;t scan it? Type this key instead: <code className="break-all font-mono text-gray-900">{enrollment.secret}</code>
          </p>
        </>
      ) : factor ? (
        <p className="text-sm text-gray-700">
          The staff console needs a code from your authenticator app each time you sign in. It&apos;s the same app as CampConnect Admin.
        </p>
      ) : (
        <>
          <p className="text-sm text-gray-700">
            The staff console needs two-factor sign-in. Add an authenticator app (Google Authenticator, 1Password, Authy or similar) to this
            account. It&apos;s the same one CampConnect Admin uses.
          </p>
          <Button onClick={addAuthenticator} loading={pending}>
            Add an authenticator app
          </Button>
        </>
      )}
      {askCode ? (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-900">
            6-digit code
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={error ? true : undefined}
              autoFocus
            />
          </label>
          <Button type="submit" loading={pending}>
            Confirm
          </Button>
        </form>
      ) : null}
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}
