"use client";

import { useActionState, useState } from "react";
import { DEAL_STATUSES, POST_KINDS, mediaItems, type Deal, type University } from "@apartment-book/shared";
import type { FormState } from "@/lib/actions/types";
import { cn } from "@/lib/utils";
import { MediaField } from "./media-field";
import { bizButton, bizField, Notice, Panel } from "./ui";

/** yyyy-mm-dd for a date input, from a stored timestamp. */
function dateValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** yyyy-mm-ddThh:mm in the browser's time, for a datetime-local input. */
function localValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dateValue(iso)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Field({ label, htmlFor, hint, error, className, children }: { label: string; htmlFor?: string; hint?: string; error?: string[]; className?: string; children: React.ReactNode }) {
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

/**
 * A business post (v1's deal, every kind since migration 50): an update, a product, a service, a deal, an event or a
 * promotion, with up to ten photos or one video, a price, a promo code and a link; the campuses whose students see it
 * and when. Kept under v1's name, DealForm.
 */
export function DealForm({
  action,
  universities,
  userId,
  defaultUniversityIds,
  initial,
  cancelHref,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  universities: University[];
  userId: string;
  /** The campuses the business serves: ticked for a new post. */
  defaultUniversityIds: string[];
  initial?: Deal;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values;
  const err = state?.fieldErrors;
  const def = (key: string, fallback: string | null | undefined) => v?.[key] ?? (fallback ?? "");
  const ticked = new Set(v ? (v.universityIds ?? "").split(",").filter(Boolean) : (initial?.university_ids ?? defaultUniversityIds));
  const [kind, setKind] = useState(def("kind", initial?.kind ?? "update"));
  const [eventLocal, setEventLocal] = useState(localValue(v?.eventAt || initial?.event_at));
  const offer = kind === "deal" || kind === "promotion";

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state?.error ? <Notice tone="danger" title={state.error} /> : null}

      <Panel className="flex flex-col gap-5 p-6">
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-biz-ink-2">What are you posting?</legend>
          <div className="flex flex-wrap gap-2">
            {POST_KINDS.map((k) => (
              <label key={k.value} className={cn("cursor-pointer rounded-full px-4 py-2 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200", kind === k.value ? "bg-biz-ink text-biz-surface" : "bg-biz-surface-3 text-biz-ink-2 hover:text-biz-ink")}>
                <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} className="sr-only" />
                {k.label}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Title" htmlFor="title" error={err?.title}>
          <input id="title" name="title" required maxLength={120} defaultValue={def("title", initial?.title)} placeholder={kind === "event" ? "Open mic night" : kind === "product" ? "Cold brew, 16 oz" : "What's new"} className={cn(bizField, "h-11")} />
        </Field>
        <Field label="Details" htmlFor="description" error={err?.description} hint="What it is, what is included, how students get it.">
          <textarea id="description" name="description" rows={4} maxLength={2000} defaultValue={def("description", initial?.description)} className={cn(bizField, "resize-y py-3 leading-relaxed")} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-biz-ink-2">Photos or video</span>
          <MediaField userId={userId} initial={mediaItems(initial?.media).length ? mediaItems(initial?.media) : initial?.image_url ? [{ type: "image", url: initial.image_url }] : []} />
        </div>
      </Panel>

      <Panel className="grid gap-5 p-6 sm:grid-cols-2">
        <Field label="Price (optional)" htmlFor="price" error={err?.price} hint="In US dollars, for example 4.50.">
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-biz-ink-3">$</span>
            <input id="price" name="price" inputMode="decimal" defaultValue={def("price", initial?.price_cents != null ? String(initial.price_cents / 100) : "")} className={cn(bizField, "h-11 pl-7 tabular-nums")} />
          </div>
        </Field>
        <Field label="Link (optional)" htmlFor="linkUrl" error={err?.linkUrl} hint="Where to order, book or read more.">
          <input id="linkUrl" name="linkUrl" type="url" defaultValue={def("linkUrl", initial?.link_url)} placeholder="https://…" className={cn(bizField, "h-11")} />
        </Field>
        {offer ? (
          <>
            <Field label="Offer badge" htmlFor="discountLabel" error={err?.discountLabel} hint="Short: 20% off, Free delivery, $5 lunch.">
              <input id="discountLabel" name="discountLabel" maxLength={60} defaultValue={def("discountLabel", initial?.discount_label)} className={cn(bizField, "h-11")} />
            </Field>
            <Field label="Promo code (optional)" htmlFor="code" error={err?.code} hint="Shown to students who open the post.">
              <input id="code" name="code" maxLength={60} defaultValue={def("code", initial?.code)} className={cn(bizField, "h-11 font-mono")} />
            </Field>
          </>
        ) : null}
        {kind === "event" ? (
          <Field label="When the event is" htmlFor="eventLocal" error={err?.eventAt} className="sm:col-span-2">
            <input id="eventLocal" type="datetime-local" required value={eventLocal} onChange={(e) => setEventLocal(e.target.value)} className={cn(bizField, "h-11 sm:max-w-xs")} />
            <input type="hidden" name="eventAt" value={eventLocal ? new Date(eventLocal).toISOString() : ""} />
          </Field>
        ) : null}
      </Panel>

      <Panel className="flex flex-col gap-5 p-6">
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-biz-ink-2">Campuses</legend>
          <p className="mb-3 text-[13px] text-biz-ink-4">Students at the ticked campuses see this post on your profile and in Deals. Tick none for every campus.</p>
          <div className="grid max-h-60 grid-cols-1 gap-1 overflow-y-auto rounded-2xl bg-biz-surface-3 p-2 sm:grid-cols-2">
            {universities.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-biz-ink-2 transition-colors hover:bg-biz-surface has-[:checked]:bg-biz-surface has-[:checked]:font-medium has-[:checked]:text-biz-ink">
                <input type="checkbox" name="universityIds" value={u.id} defaultChecked={ticked.has(u.id)} className="h-4 w-4 rounded accent-[var(--biz-accent)]" />
                <span className="truncate">{u.name}</span>
              </label>
            ))}
          </div>
          {err?.universityIds ? <p className="mt-1 text-[13px] text-biz-danger">{err.universityIds[0]}</p> : null}
        </fieldset>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Shows from" htmlFor="startsAt" error={err?.startsAt} hint="Empty: now.">
            <input id="startsAt" name="startsAt" type="date" defaultValue={def("startsAt", dateValue(initial?.starts_at))} className={cn(bizField, "h-11")} />
          </Field>
          <Field label="Until" htmlFor="endsAt" error={err?.endsAt} hint="Empty: until you archive it.">
            <input id="endsAt" name="endsAt" type="date" defaultValue={def("endsAt", dateValue(initial?.ends_at))} className={cn(bizField, "h-11")} />
          </Field>
          <Field label="Status" htmlFor="status" error={err?.status}>
            <select id="status" name="status" defaultValue={def("status", initial?.status ?? "active")} className={cn(bizField, "h-11")}>
              {DEAL_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Panel>

      <div className="flex items-center justify-end gap-3">
        <a href={cancelHref} className={bizButton({ variant: "ghost" })}>
          Cancel
        </a>
        <button type="submit" disabled={pending} className={bizButton({ variant: "primary", size: "lg" })}>
          {pending ? "Saving…" : initial ? "Save changes" : "Publish post"}
        </button>
      </div>
    </form>
  );
}
