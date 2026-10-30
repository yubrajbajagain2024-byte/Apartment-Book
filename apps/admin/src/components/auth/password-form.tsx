"use client";

import { useActionState } from "react";
import { setPasswordAction } from "@/lib/actions/password";
import { Button } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function PasswordForm({ email, firstTime }: { email: string; firstTime: boolean }) {
  const [state, action, pending] = useActionState(setPasswordAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      {/* Lets password managers save the new password under the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <FormMessage error={state?.error} />
      <Field label="New password" htmlFor="password" error={state?.fieldErrors?.password} hint="At least 12 characters. A passphrase works well.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={72} />
      </Field>
      <Field label="Repeat it" htmlFor="confirm" error={state?.fieldErrors?.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={72} />
      </Field>
      <Button type="submit" size="lg" loading={pending}>
        {firstTime ? "Save and set up two-factor" : "Save password"}
      </Button>
    </form>
  );
}
