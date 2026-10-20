"use client";

/**
 * The Buzz guidelines gate (UniVerse SPEC §5.3): an INLINE panel, never a modal. It is the only Buzz request made
 * before acceptance (`buzz_v2_gate`); every other query stays disabled until it says `accepted`. [I understand] →
 * `buzz_v2_accept_gate(BUZZ_GUIDELINES_VERSION)` · [Not now] → back to the previous Home tab (pane) / [Back] (pages).
 * Signed out, Buzz shows a sign-in panel instead (and makes no request at all).
 */
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, VenetianMask } from "lucide-react";
import { BUZZ_ANONYMITY_ANCHOR, BUZZ_GATE_COPY, BUZZ_GUIDELINES_VERSION, buzzErrorMessage } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { buzzApi } from "./api";
import { guidelinesHref } from "./moderation";
import { buzzKeys, setQueryData, useBuzzQuery } from "./query";
import { useBuzzSession } from "./surface";
import { toast } from "./toast";
import { Button, buttonClass, Skeleton, SkeletonText, T } from "./ui";

export function useBuzzGate() {
  const { signedIn } = useBuzzSession();
  const q = useBuzzQuery(signedIn ? buzzKeys.gate : null, () => buzzApi.gate(), { staleTime: Number.POSITIVE_INFINITY });
  return {
    signedIn,
    accepted: q.data?.accepted === true,
    /** Signed in, and the gate state is not known yet. */
    isLoading: signedIn && q.isLoading,
    isError: signedIn && q.isError,
    error: q.error,
    retry: q.refetch,
  };
}

export function BuzzGatePanel({ variant, onDismiss, className }: { variant: "pane" | "page"; onDismiss(): void; className?: string }) {
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    setBusy(true);
    try {
      setQueryData(buzzKeys.gate, await buzzApi.acceptGate(BUZZ_GUIDELINES_VERSION));
    } catch (e) {
      toast.error(buzzErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="buzz-gate-title" className={className} data-testid="buzz-gate">
      <div className="mx-4 flex flex-col gap-5 rounded-[20px] border border-incog-accent-line bg-incog-surface-1 p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-incog-accent-soft text-incog-accent-ink">
            <VenetianMask size={22} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="buzz-gate-title" className={cn("text-incog-ink", T.title3)}>
              {BUZZ_GATE_COPY.title}
            </h2>
            <p className={cn("text-incog-ink-3", T.caption)}>{BUZZ_GATE_COPY.subtitle}</p>
          </div>
        </div>
        <ol className="flex flex-col gap-3">
          {BUZZ_GATE_COPY.rules.map((rule, i) => (
            <li key={rule} className="flex items-start gap-3">
              <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-incog-accent-soft tabular-nums text-incog-accent-ink", T.micro)}>{i + 1}</span>
              <span className={cn("text-incog-ink-2", T.body)}>{rule}</span>
            </li>
          ))}
        </ol>
        <p className={cn("text-incog-ink-3", T.footnote)}>
          {BUZZ_GATE_COPY.footnote}{" "}
          <Link href={guidelinesHref(BUZZ_ANONYMITY_ANCHOR)} className="text-incog-accent-ink underline-offset-2 hover:underline">
            {BUZZ_GATE_COPY.learnMore}
          </Link>
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="lg" fullWidth loading={busy} onClick={() => void accept()} data-testid="buzz-gate-accept">
            {BUZZ_GATE_COPY.accept}
          </Button>
          <Button variant="ghost" size="md" fullWidth onClick={onDismiss} leftIcon={variant === "page" ? ArrowLeft : undefined}>
            {variant === "page" ? BUZZ_GATE_COPY.back : BUZZ_GATE_COPY.notNow}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Signed out: Buzz is for signed-in students only. */
export function BuzzSignInPanel({ next, className }: { next: string; className?: string }) {
  const login = `/login?next=${encodeURIComponent(next)}`;
  return (
    <section aria-labelledby="buzz-signin-title" className={className} data-testid="buzz-signin">
      <div className="mx-4 flex flex-col gap-5 rounded-[20px] border border-incog-accent-line bg-incog-surface-1 p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-incog-accent-soft text-incog-accent-ink">
            <VenetianMask size={22} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="buzz-signin-title" className={cn("text-incog-ink", T.title3)}>
              Log in to see Buzz
            </h2>
            <p className={cn("text-incog-ink-3", T.caption)}>{BUZZ_GATE_COPY.subtitle}</p>
          </div>
        </div>
        <p className={cn("text-incog-ink-2", T.body)}>Buzz is where students post anonymously: questions, confessions, hot takes about campus. Log in with your university account to read it and join in.</p>
        <div className="flex flex-col gap-2">
          <Link href={login} className={buttonClass("primary", "lg", true)}>
            Log in
          </Link>
          <Link href={`/signup?next=${encodeURIComponent(next)}`} className={buttonClass("ghost", "md", true)}>
            Create an account
          </Link>
        </div>
      </div>
    </section>
  );
}

/** While the gate state loads: a neutral skeleton, no Buzz content. */
export function BuzzGateSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("mx-4 flex flex-col gap-4 rounded-[20px] border border-incog-line bg-incog-surface-1 p-5", className)} aria-busy="true" aria-label="Loading Buzz">
      <div className="flex items-center gap-3">
        <Skeleton w={44} h={44} circle />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton w="55%" h={16} />
          <Skeleton w="75%" h={12} />
        </div>
      </div>
      <SkeletonText lines={3} />
    </div>
  );
}
