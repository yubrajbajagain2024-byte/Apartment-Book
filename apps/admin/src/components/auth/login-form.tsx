"use client";

import { useActionState } from "react";
import { signInAction, signInWithGoogleAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function GoogleButton({ next }: { next: string }) {
  return (
    <form action={signInWithGoogleAction}>
      <input type="hidden" name="next" value={next} />
      <Button type="submit" variant="outline" className="w-full">
        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#EA4335"
            d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.8-5.4 3.8-3.3 0-5.9-2.7-5.9-6s2.6-6 5.9-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12S6.7 21.6 12 21.6c5.5 0 9.2-3.9 9.2-9.3 0-.6-.1-1.1-.2-1.6H12z"
          />
        </svg>
        Continue with Google
      </Button>
    </form>
  );
}

export function LoginForm({ next, initialError, google = true }: { next: string; initialError?: string; google?: boolean }) {
  const [state, action, pending] = useActionState(signInAction, null);
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <FormMessage error={state?.error ?? initialError} />
        <Field label="Email" htmlFor="email" error={state?.fieldErrors?.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.values?.email} placeholder="you@txstate.edu" />
        </Field>
        <Field label="Password" htmlFor="password" error={state?.fieldErrors?.password}>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" size="lg" loading={pending}>
          Log in
        </Button>
      </form>
      {google ? (
        <>
          <div className="flex items-center gap-3 text-xs uppercase text-gray-400">
            <span className="h-px flex-1 bg-gray-200" /> or <span className="h-px flex-1 bg-gray-200" />
          </div>
          <GoogleButton next={next} />
        </>
      ) : null}
    </div>
  );
}
