"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Copy, KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { formatDate, type MfaStatus, type TotpEnrollment } from "@apartment-book/shared";
import { confirmEnrollmentAction, removeFactorAction, startEnrollmentAction, verifyMfaAction } from "@/lib/actions/mfa";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConfirmButton } from "@/components/common/confirm-button";

/**
 * Two-factor authentication for a staff account, in three states: not enrolled
 * (set up an authenticator app), enrolled but not verified in this session (enter
 * a code), verified (manage the authenticator). Enrolment is checked first: right
 * after the only authenticator is removed the cookie still says aal2, and the way
 * forward is a new setup, not a "verified" card with nothing in it.
 */
export function MfaPanel({ status, next }: { status: MfaStatus; next: string }) {
  if (!status.enrolled) return <EnrollCard next={next} />;
  if (status.verified) return <VerifiedCard status={status} next={next} />;
  return <VerifyCard status={status} next={next} />;
}

function Why() {
  return (
    <p className="text-sm text-gray-600">
      Every action here is checked in the database against a session that passed a second factor, so a stolen password alone cannot touch the team, people, content or
      reports.
    </p>
  );
}

function CodeInput({ id }: { id: string }) {
  return (
    <Input
      id={id}
      name="code"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      required
      autoFocus
      placeholder="123456"
      className="h-12 max-w-48 text-center font-mono text-xl tracking-[0.4em] placeholder:tracking-[0.4em]"
    />
  );
}

function HeaderIcon({ tone, children }: { tone: "amber" | "blue" | "green"; children: ReactNode }) {
  const tones = { amber: "bg-amber-100 text-amber-800", blue: "bg-brand-50 text-brand-700", green: "bg-green-100 text-green-700" };
  return <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tones[tone]}`}>{children}</span>;
}

/** Not enrolled yet: generate a secret, show the QR code and confirm the first code. */
function EnrollCard({ next }: { next: string }) {
  const [startState, start, starting] = useActionState(startEnrollmentAction, null);
  const enrollment = startState?.step === "enrolling" ? startState.enrollment : undefined;

  return (
    <Card>
      <CardHeader className="flex items-center gap-3">
        <HeaderIcon tone="amber">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
        </HeaderIcon>
        <div className="min-w-0">
          <CardTitle>Set up two-factor authentication</CardTitle>
          <p className="text-sm text-gray-600">Required before you can do anything in this app.</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-5">
        <Why />
        {!enrollment ? (
          <form action={start} className="flex flex-col gap-3">
            <FormMessage error={startState?.error} />
            <Button type="submit" loading={starting} className="self-start">
              Start setup
            </Button>
          </form>
        ) : (
          <div className="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)]">
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-xl bg-white p-2 ring-1 ring-gray-200">
                <img src={enrollment.qrCode} alt="QR code for your authenticator app" width={200} height={200} className="h-[200px] w-[200px]" />
              </div>
              <SecretBox secret={enrollment.secret} />
            </div>
            <div className="flex flex-col gap-4">
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-gray-700">
                <li>Install Google Authenticator, 1Password or Authy on your phone.</li>
                <li>Scan the code or type the key.</li>
                <li>Enter the 6-digit code the app shows.</li>
              </ol>
              <ConfirmForm key={enrollment.factorId} enrollment={enrollment} next={next} />
              <form action={start} className="self-start">
                <Button type="submit" variant="ghost" size="sm" loading={starting}>
                  Start over with a new code
                </Button>
              </form>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ConfirmForm({ enrollment, next }: { enrollment: TotpEnrollment; next: string }) {
  const [state, action, pending] = useActionState(confirmEnrollmentAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="factorId" value={enrollment.factorId} />
      <input type="hidden" name="next" value={next} />
      <FormMessage error={state?.fieldErrors?.code ? undefined : state?.error} />
      <Field label="6-digit code" htmlFor="enrollCode" error={state?.fieldErrors?.code}>
        <CodeInput id="enrollCode" />
      </Field>
      <Button type="submit" loading={pending} className="self-start">
        Turn on
      </Button>
    </form>
  );
}

function SecretBox({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  const grouped = secret.replace(/(.{4})/g, "$1 ").trim();

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (http, permissions): the key is on screen to type by hand.
    }
  }

  return (
    <div className="flex w-full max-w-xs flex-col gap-1.5">
      <p className="text-xs font-medium text-gray-600">Can&apos;t scan? Type this key instead</p>
      <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 ring-1 ring-gray-200">
        <code className="min-w-0 flex-1 font-mono text-sm break-all text-gray-900">{grouped}</code>
        <Button type="button" variant="ghost" size="sm" onClick={copy} aria-label="Copy key">
          {copied ? <Check className="h-4 w-4 text-green-600" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

/** Enrolled, but this session has not passed the second factor yet. */
function VerifyCard({ status, next }: { status: MfaStatus; next: string }) {
  const [state, action, pending] = useActionState(verifyMfaAction, null);
  const factor = status.factors.find((f) => f.status === "verified");

  return (
    <Card>
      <CardHeader className="flex items-center gap-3">
        <HeaderIcon tone="blue">
          <Smartphone className="h-5 w-5" aria-hidden="true" />
        </HeaderIcon>
        <div className="min-w-0">
          <CardTitle>Enter your two-factor code</CardTitle>
          <p className="text-sm text-gray-600">Open {factor?.friendlyName || "your authenticator app"} and type the current 6-digit code.</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-5">
        <Why />
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <FormMessage error={state?.fieldErrors?.code ? undefined : state?.error} />
          <Field label="6-digit code" htmlFor="verifyCode" error={state?.fieldErrors?.code}>
            <CodeInput id="verifyCode" />
          </Field>
          <Button type="submit" loading={pending} className="self-start">
            Verify
          </Button>
        </form>
        <p className="text-xs text-gray-500">Lost your authenticator? Ask another owner to remove it from Supabase → Authentication → Users, then set it up again.</p>
      </CardBody>
    </Card>
  );
}

/** Verified this session: show the authenticator and allow removing it. */
function VerifiedCard({ status, next }: { status: MfaStatus; next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function remove(factorId: string) {
    const result = await removeFactorAction(factorId);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-3">
        <HeaderIcon tone="green">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </HeaderIcon>
        <div className="min-w-0 flex-1">
          <CardTitle>Two-factor authentication is on</CardTitle>
          <p className="text-sm text-gray-600">This session passed the second factor. Everything is unlocked.</p>
        </div>
        <Badge tone="green">Verified</Badge>
      </CardHeader>
      <CardBody className="flex flex-col gap-5">
        <Why />
        <ul className="divide-y divide-gray-100 rounded-lg ring-1 ring-gray-200">
          {status.factors.map((factor) => (
            <li key={factor.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Smartphone className="h-5 w-5 shrink-0 text-gray-500" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-gray-900">{factor.friendlyName || "Authenticator app"}</p>
                <p className="text-xs text-gray-500" suppressHydrationWarning>
                  added {formatDate(factor.createdAt)}
                </p>
              </div>
              {factor.status === "verified" ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Setup not finished</Badge>}
              <ConfirmButton variant="outline" size="sm" action={() => remove(factor.id)} confirmText="Remove this authenticator? Every action will be blocked until you set up a new one.">
                Remove authenticator
              </ConfirmButton>
            </li>
          ))}
        </ul>
        <FormMessage error={error} />
        <p className="text-xs text-gray-500">Removing the authenticator blocks every action until a new one is set up, so have your new phone ready before you switch.</p>
        <LinkButton href={next} variant="secondary" size="sm" className="self-start">
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </LinkButton>
      </CardBody>
    </Card>
  );
}
