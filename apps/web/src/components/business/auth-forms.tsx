"use client";

import { useActionState } from "react";
import { BUSINESS_CATEGORIES, type University } from "@apartment-book/shared";
import { businessJoinAction, businessSignInAction, businessSignUpAction } from "@/lib/actions/business";
import { Button } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { UniversitySelect } from "@/components/common/university-select";
import { PortalLink } from "./portal-base";

export function BusinessLoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, action, pending] = useActionState(businessSignInAction, null);
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <FormMessage error={state?.error ?? initialError} />
        <Field label="Email" htmlFor="email" error={state?.fieldErrors?.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.values?.email} placeholder="you@yourbusiness.com" />
        </Field>
        <Field label="Password" htmlFor="password" error={state?.fieldErrors?.password}>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" size="lg" loading={pending}>
          Log in
        </Button>
      </form>
      <p className="text-center text-sm text-gray-600">
        New business?{" "}
        <PortalLink href="/signup" className="font-semibold text-brand-600 hover:underline">
          List your business
        </PortalLink>
      </p>
    </div>
  );
}

export function BusinessSignupForm({ universities }: { universities: University[] }) {
  const [state, action, pending] = useActionState(businessSignUpAction, null);
  const v = state?.values;
  const err = state?.fieldErrors;

  if (state?.success) {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage success={state.success} />
        <p className="text-center text-sm text-gray-600">
          Already confirmed?{" "}
          <PortalLink href="/login" className="font-semibold text-brand-600 hover:underline">
            Log in
          </PortalLink>
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormMessage error={state?.error} />
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Your business</legend>
        <Field label="Business name" htmlFor="businessName" required error={err?.businessName}>
          <Input id="businessName" name="businessName" required maxLength={120} defaultValue={v?.businessName} placeholder="River Rock Apartments" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="category" required error={err?.category}>
            <Select id="category" name="category" required defaultValue={v?.category ?? "housing"}>
              {BUSINESS_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Campus you serve" htmlFor="universityId" error={err?.universityId} hint="You can add more later.">
            <UniversitySelect id="universityId" universities={universities} defaultValue={v?.universityId} emptyLabel="Choose a campus" />
          </Field>
          <Field label="Website" htmlFor="website" error={err?.website}>
            <Input id="website" name="website" type="url" defaultValue={v?.website} placeholder="https://…" />
          </Field>
          <Field label="Phone" htmlFor="phone" error={err?.phone}>
            <Input id="phone" name="phone" type="tel" defaultValue={v?.phone} />
          </Field>
          <Field label="City" htmlFor="city" error={err?.city} className="sm:col-span-2">
            <Input id="city" name="city" defaultValue={v?.city} placeholder="San Marcos, TX" />
          </Field>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Your account</legend>
        <Field label="Your name" htmlFor="fullName" required error={err?.fullName}>
          <Input id="fullName" name="fullName" autoComplete="name" required maxLength={80} defaultValue={v?.fullName} />
        </Field>
        <Field label="Work email" htmlFor="email" required error={err?.email} hint="Any address works for a business. Students need a university email.">
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={v?.email} placeholder="you@yourbusiness.com" />
        </Field>
        <Field label="Password" htmlFor="password" required error={err?.password} hint="At least 8 characters.">
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
      </fieldset>
      <Button type="submit" size="lg" loading={pending}>
        Create business account
      </Button>
      <p className="text-center text-sm text-gray-600">
        Already listed?{" "}
        <PortalLink href="/login" className="font-semibold text-brand-600 hover:underline">
          Log in
        </PortalLink>
      </p>
    </form>
  );
}

export function BusinessJoinForm({ token, email, businessName }: { token: string; email: string; businessName: string }) {
  const [state, action, pending] = useActionState(businessJoinAction, null);
  if (state?.success) {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage success={state.success} />
        <p className="text-center text-sm text-gray-600">
          Already confirmed?{" "}
          <PortalLink href="/login" className="font-semibold text-brand-600 hover:underline">
            Log in
          </PortalLink>
        </p>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <FormMessage error={state?.error} />
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" value={email} readOnly className="bg-gray-50 text-gray-600" />
      </Field>
      <Field label="Your name" htmlFor="fullName" required error={state?.fieldErrors?.fullName}>
        <Input id="fullName" name="fullName" autoComplete="name" required maxLength={80} defaultValue={state?.values?.fullName} />
      </Field>
      <Field label="Password" htmlFor="password" required error={state?.fieldErrors?.password} hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Button type="submit" size="lg" loading={pending}>
        Join {businessName}
      </Button>
    </form>
  );
}
