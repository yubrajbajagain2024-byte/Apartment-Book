"use client";

import { useActionState } from "react";
import { DEAL_STATUSES, type Deal, type University } from "@apartment-book/shared";
import type { FormState } from "@/lib/actions/types";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { ImageUploader } from "@/components/common/image-uploader";

/** yyyy-mm-dd for a date input, from a stored timestamp. */
function dateValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
  /** The campuses the business serves: ticked for a new deal. */
  defaultUniversityIds: string[];
  initial?: Deal;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values;
  const err = state?.fieldErrors;
  const def = (key: string, fallback: string | null | undefined) => v?.[key] ?? (fallback ?? "");
  const ticked = new Set(v ? (v.universityIds ?? "").split(",").filter(Boolean) : (initial?.university_ids ?? defaultUniversityIds));

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormMessage error={state?.error} />
      <Card>
        <CardHeader>
          <CardTitle>The offer</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="title" required error={err?.title} className="sm:col-span-2">
            <Input id="title" name="title" required maxLength={120} defaultValue={def("title", initial?.title)} placeholder="Student lunch special" />
          </Field>
          <Field label="Discount" htmlFor="discountLabel" error={err?.discountLabel} hint="Short, as a badge: 20% off, Free delivery, $5 lunch.">
            <Input id="discountLabel" name="discountLabel" maxLength={60} defaultValue={def("discountLabel", initial?.discount_label)} />
          </Field>
          <Field label="Promo code" htmlFor="code" error={err?.code} hint="Shown to students who open the deal (optional).">
            <Input id="code" name="code" maxLength={60} defaultValue={def("code", initial?.code)} />
          </Field>
          <Field label="Details" htmlFor="description" error={err?.description} className="sm:col-span-2" hint="What is included, when it applies, what to show at the counter.">
            <Textarea id="description" name="description" maxLength={2000} defaultValue={def("description", initial?.description)} />
          </Field>
          <Field label="Link" htmlFor="linkUrl" error={err?.linkUrl} className="sm:col-span-2" hint="Where to order or read more (optional).">
            <Input id="linkUrl" name="linkUrl" type="url" defaultValue={def("linkUrl", initial?.link_url)} placeholder="https://…" />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where and when</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium text-gray-800">Campuses</legend>
            <p className="mb-2 text-xs text-gray-500">Students at the ticked campuses see this deal. Tick none to show it at every campus.</p>
            <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-gray-200 p-2 sm:grid-cols-2">
              {universities.map((u) => (
                <Checkbox key={u.id} name="universityIds" value={u.id} label={u.name} defaultChecked={ticked.has(u.id)} />
              ))}
            </div>
            {err?.universityIds ? <p className="mt-1 text-sm text-red-600">{err.universityIds[0]}</p> : null}
          </fieldset>
          <Field label="Starts" htmlFor="startsAt" error={err?.startsAt} hint="Leave empty to start now.">
            <Input id="startsAt" name="startsAt" type="date" defaultValue={def("startsAt", dateValue(initial?.starts_at))} />
          </Field>
          <Field label="Ends" htmlFor="endsAt" error={err?.endsAt} hint="Leave empty for an open-ended deal.">
            <Input id="endsAt" name="endsAt" type="date" defaultValue={def("endsAt", dateValue(initial?.ends_at))} />
          </Field>
          <Field label="Status" htmlFor="status" error={err?.status}>
            <Select id="status" name="status" defaultValue={def("status", initial?.status ?? "active")}>
              {DEAL_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Picture</CardTitle>
          <p className="mt-1 text-sm text-gray-600">One image, optional: the dish, the storefront, the offer.</p>
        </CardHeader>
        <CardBody>
          <ImageUploader name="imageUrl" metaName="imageMeta" kind="apartments" userId={userId} max={1} initial={initial?.image_url ? [{ url: initial.image_url, width: null, height: null, blur: null }] : []} />
          {err?.imageUrl ? <p className="mt-2 text-sm text-red-600">{err.imageUrl[0]}</p> : null}
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <LinkButton href={cancelHref} variant="ghost">
          Cancel
        </LinkButton>
        <Button type="submit" size="lg" loading={pending}>
          {initial ? "Save changes" : "Publish deal"}
        </Button>
      </div>
    </form>
  );
}
