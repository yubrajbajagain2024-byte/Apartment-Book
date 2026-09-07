"use client";

import { useActionState } from "react";
import { CURRENCIES, ITEM_CATEGORIES, ITEM_CONDITIONS, type Item, type University } from "@apartment-book/shared";
import type { FormState } from "@/lib/actions/types";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { ImageUploader } from "@/components/common/image-uploader";
import { UniversitySelect } from "@/components/common/university-select";

export function ItemForm({
  action,
  universities,
  userId,
  defaultUniversityId,
  initial,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  universities: University[];
  userId: string;
  defaultUniversityId?: string | null;
  initial?: Item;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values;
  const def = (key: string, fallback: string | number | null | undefined) => v?.[key] ?? (fallback ?? "").toString();
  const err = state?.fieldErrors;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormMessage error={state?.error} />
      <Card>
        <CardHeader>
          <CardTitle>Item details</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="title" required error={err?.title} className="sm:col-span-2">
            <Input id="title" name="title" required maxLength={120} defaultValue={def("title", initial?.title)} placeholder="IKEA queen mattress, 1 year old" />
          </Field>
          <Field label="Description" htmlFor="description" required error={err?.description} className="sm:col-span-2" hint="Size, age, any damage, why you are selling.">
            <Textarea id="description" name="description" required defaultValue={def("description", initial?.description)} />
          </Field>
          <Field label="Price" htmlFor="price" required error={err?.price} hint="Enter 0 to give it away for free.">
            <div className="flex gap-2">
              <Select name="currency" defaultValue={def("currency", initial?.currency ?? "USD")} className="w-28" aria-label="Currency">
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
              <Input id="price" name="price" type="number" min={0} step="0.01" required defaultValue={def("price", initial?.price)} />
            </div>
          </Field>
          <Field label="Category" htmlFor="category" required error={err?.category}>
            <Select id="category" name="category" required defaultValue={def("category", initial?.category)}>
              <option value="">Choose a category</option>
              {ITEM_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Condition" htmlFor="condition" required error={err?.condition}>
            <Select id="condition" name="condition" defaultValue={def("condition", initial?.condition ?? "good")}>
              {ITEM_CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="University" htmlFor="universityId" error={err?.universityId} hint="Helps students near you find it.">
            <UniversitySelect id="universityId" universities={universities} defaultValue={def("universityId", initial?.university_id ?? defaultUniversityId)} emptyLabel="Choose a university" />
          </Field>
          <Field label="Pickup location" htmlFor="pickupLocation" error={err?.pickupLocation} className="sm:col-span-2">
            <Input id="pickupLocation" name="pickupLocation" defaultValue={def("pickupLocation", initial?.pickup_location)} placeholder="Campus library, student residence…" />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Photos</CardTitle>
        </CardHeader>
        <CardBody>
          <ImageUploader name="images" kind="items" userId={userId} initial={initial?.images ?? []} />
          {err?.images ? <p className="mt-2 text-sm text-red-600">{err.images[0]}</p> : null}
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <LinkButton href={initial ? `/marketplace/${initial.id}` : "/marketplace"} variant="ghost">
          Cancel
        </LinkButton>
        <Button type="submit" size="lg" loading={pending}>
          {initial ? "Save changes" : "List item"}
        </Button>
      </div>
    </form>
  );
}
