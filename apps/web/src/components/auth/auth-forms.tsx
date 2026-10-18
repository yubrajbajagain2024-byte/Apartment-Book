"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction, signInWithGoogleAction, signUpAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function GoogleButton({ next }: { next: string }) {
  return (
    <form action={signInWithGoogleAction}>
      <input type="hidden" name="next" value={next} />
      <Button type="submit" variant="outline" className="w-full">
        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.8-5.4 3.8-3.3 0-5.9-2.7-5.9-6s2.6-6 5.9-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12S6.7 21.6 12 21.6c5.5 0 9.2-3.9 9.2-9.3 0-.6-.1-1.1-.2-1.6H12z" />
        </svg>
        Continue with Google
      </Button>
    </form>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 text-xs uppercase text-gray-400">
      <span className="h-px flex-1 bg-gray-200" /> or <span className="h-px flex-1 bg-gray-200" />
    </div>
  );
}

function domainHint(domains: string[]): string | undefined {
  if (domains.length === 0) return undefined;
  return domains.length === 1 ? `Use your @${domains[0]} email address.` : `Use your university email (${domains.map((d) => `@${d}`).join(", ")}).`;
}

export function LoginForm({ next, initialError, domains = [] }: { next: string; initialError?: string; domains?: string[] }) {
  const [state, action, pending] = useActionState(signInAction, null);
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <FormMessage error={state?.error ?? initialError} />
        <Field label="Email" htmlFor="email" error={state?.fieldErrors?.email} hint={domainHint(domains)}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={state?.values?.email}
            placeholder={domains[0] ? `you@${domains[0]}` : "you@university.edu"}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={state?.fieldErrors?.password}>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" size="lg" loading={pending}>
          Log in
        </Button>
      </form>
      <Divider />
      <GoogleButton next={next} />
      <p className="text-center text-sm text-gray-600">
        New here?{" "}
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold text-brand-600 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}

export function SignupForm({ next, domains = [] }: { next: string; domains?: string[] }) {
  const [state, action, pending] = useActionState(signUpAction, null);

  if (state?.success) {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage success={state.success} />
        <p className="text-center text-sm text-gray-600">
          Already confirmed?{" "}
          <Link href="/login" className="font-semibold text-brand-600 hover:underline">
            Log in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <FormMessage error={state?.error} />
        <Field label="Full name" htmlFor="fullName" error={state?.fieldErrors?.fullName}>
          <Input id="fullName" name="fullName" autoComplete="name" required defaultValue={state?.values?.fullName} />
        </Field>
        <Field label="University email" htmlFor="email" error={state?.fieldErrors?.email} hint={domainHint(domains) ?? "Use your university email if you have one."}>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.values?.email} placeholder={domains[0] ? `you@${domains[0]}` : undefined} />
        </Field>
        <Field label="Password" htmlFor="password" error={state?.fieldErrors?.password} hint="At least 8 characters.">
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
        <Button type="submit" size="lg" loading={pending}>
          Create account
        </Button>
      </form>
      <Divider />
      <GoogleButton next={next} />
      <p className="text-center text-sm text-gray-600">
        Already have an account?{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-brand-600 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
