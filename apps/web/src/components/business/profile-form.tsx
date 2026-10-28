"use client";

import { useActionState } from "react";
import { BUSINESS_CATEGORIES, type Business, type University } from "@apartment-book/shared";
import { updateBusinessAction } from "@/lib/actions/business";
import { cn } from "@/lib/utils";
import { AvatarUploader } from "@/components/common/avatar-uploader";
import { bizButton, bizField, Notice, Panel } from "./ui";

function Field({ label, htmlFor, hint, error, className, children }: { label: string; htmlFor: string; hint?: string; error?: string[]; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-biz-ink-2">
        {label}
      </label>
      {children}
      {error?.[0] ? <p className="text-[13px] text-biz-danger">{error[0]}</p> : hint ? <p className="text-[13px] text-biz-ink-4">{hint}</p> : null}
    </div>
  );
}

/** The business profile the owner and admins edit: what students read on its public page, and what the UniBuzz team reviews. */
export function BusinessProfileForm({ business, universities, userId }: { business: Business; universities: University[]; userId: string }) {
  const [state, action, pending] = useActionState(updateBusinessAction, null);
  const v = state?.values;
  const err = state?.fieldErrors;
  const def = (key: string, fallback: string | null | undefined) => v?.[key] ?? (fallback ?? "");
  const ticked = new Set(v ? (v.universityIds ?? "").split(",").filter(Boolean) : business.university_ids);

  return (
    <form action={action} className="flex flex-col gap-6">
      {state?.error ? <Notice tone="danger" title={state.error} /> : null}
      {state?.success ? <Notice tone="success" title={state.success} /> : null}
      <Panel className="grid gap-5 p-6 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <AvatarUploader name="logoUrl" userId={userId} initialUrl={v?.logoUrl ?? business.logo_url} displayName={business.name} />
          {err?.logoUrl ? <p className="mt-1 text-[13px] text-biz-danger">{err.logoUrl[0]}</p> : null}
        </div>
        <Field label="Business name" htmlFor="name" error={err?.name}>
          <input id="name" name="name" required maxLength={120} defaultValue={def("name", business.name)} className={cn(bizField, "h-11")} />
        </Field>
        <Field label="Category" htmlFor="category" error={err?.category}>
          <select id="category" name="category" required defaultValue={def("category", business.category)} className={cn(bizField, "h-11")}>
            {BUSINESS_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bio" htmlFor="description" error={err?.description} hint="A few lines students read at the top of your profile." className="sm:col-span-2">
          <textarea id="description" name="description" rows={4} maxLength={2000} defaultValue={def("description", business.description)} className={cn(bizField, "resize-y py-3 leading-relaxed")} />
        </Field>
      </Panel>

      <Panel className="grid gap-5 p-6 sm:grid-cols-2">
        <Field label="Website" htmlFor="website" error={err?.website}>
          <input id="website" name="website" type="url" defaultValue={def("website", business.website)} placeholder="https://…" className={cn(bizField, "h-11")} />
        </Field>
        <Field label="Phone" htmlFor="phone" error={err?.phone} hint="Shown on your profile.">
          <input id="phone" name="phone" type="tel" defaultValue={def("phone", business.phone)} className={cn(bizField, "h-11")} />
        </Field>
        <Field label="Contact email" htmlFor="contactEmail" error={err?.contactEmail} hint="For the UniBuzz team only. Students message you in the app.">
          <input id="contactEmail" name="contactEmail" type="email" defaultValue={def("contactEmail", business.contact_email)} className={cn(bizField, "h-11")} />
        </Field>
        <Field label="City" htmlFor="city" error={err?.city}>
          <input id="city" name="city" defaultValue={def("city", business.city)} className={cn(bizField, "h-11")} />
        </Field>
        <Field label="Address" htmlFor="address" error={err?.address} className="sm:col-span-2">
          <input id="address" name="address" defaultValue={def("address", business.address)} className={cn(bizField, "h-11")} />
        </Field>
      </Panel>

      <Panel className="p-6">
        <h2 className="text-[17px] font-semibold text-biz-ink">Campuses you serve</h2>
        <p className="mt-0.5 text-[13px] text-biz-ink-3">Ticked for new posts and ads by default.</p>
        <div className="mt-4 grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded-2xl bg-biz-surface-3 p-2 sm:grid-cols-2">
          {universities.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-biz-ink-2 transition-colors hover:bg-biz-surface has-[:checked]:bg-biz-surface has-[:checked]:font-medium has-[:checked]:text-biz-ink">
              <input type="checkbox" name="universityIds" value={u.id} defaultChecked={ticked.has(u.id)} className="h-4 w-4 rounded accent-[var(--biz-accent)]" />
              <span className="truncate">{u.name}</span>
            </label>
          ))}
        </div>
        {err?.universityIds ? <p className="mt-1 text-[13px] text-biz-danger">{err.universityIds[0]}</p> : null}
      </Panel>

      <div className="flex items-center justify-end">
        <button type="submit" disabled={pending} className={bizButton({ variant: "primary", size: "lg" })}>
          {pending ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}
