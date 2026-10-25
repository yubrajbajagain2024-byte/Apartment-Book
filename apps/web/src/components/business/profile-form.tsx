"use client";

import { useActionState } from "react";
import { BUSINESS_CATEGORIES, type Business, type University } from "@apartment-book/shared";
import { updateBusinessAction } from "@/lib/actions/business";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { AvatarUploader } from "@/components/common/avatar-uploader";

export function BusinessProfileForm({ business, universities, userId }: { business: Business; universities: University[]; userId: string }) {
  const [state, action, pending] = useActionState(updateBusinessAction, null);
  const v = state?.values;
  const err = state?.fieldErrors;
  const def = (key: string, fallback: string | null | undefined) => v?.[key] ?? (fallback ?? "");
  const ticked = new Set(v ? (v.universityIds ?? "").split(",").filter(Boolean) : business.university_ids);

  return (
    <form action={action} className="flex flex-col gap-5">
      <FormMessage error={state?.error} success={state?.success} />
      <Card>
        <CardHeader>
          <CardTitle>About the business</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <AvatarUploader name="logoUrl" userId={userId} initialUrl={v?.logoUrl ?? business.logo_url} displayName={business.name} />
            {err?.logoUrl ? <p className="mt-1 text-sm text-red-600">{err.logoUrl[0]}</p> : null}
          </div>
          <Field label="Business name" htmlFor="name" required error={err?.name}>
            <Input id="name" name="name" required maxLength={120} defaultValue={def("name", business.name)} />
          </Field>
          <Field label="Category" htmlFor="category" required error={err?.category}>
            <Select id="category" name="category" required defaultValue={def("category", business.category)}>
              {BUSINESS_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description" htmlFor="description" error={err?.description} className="sm:col-span-2" hint="A few lines students read on your listings and deals.">
            <Textarea id="description" name="description" maxLength={2000} defaultValue={def("description", business.description)} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Website" htmlFor="website" error={err?.website}>
            <Input id="website" name="website" type="url" defaultValue={def("website", business.website)} placeholder="https://…" />
          </Field>
          <Field label="Phone" htmlFor="phone" error={err?.phone}>
            <Input id="phone" name="phone" type="tel" defaultValue={def("phone", business.phone)} />
          </Field>
          <Field label="Contact email" htmlFor="contactEmail" error={err?.contactEmail} hint="Shown to the CampConnect team; students message you through the app.">
            <Input id="contactEmail" name="contactEmail" type="email" defaultValue={def("contactEmail", business.contact_email)} />
          </Field>
          <Field label="City" htmlFor="city" error={err?.city}>
            <Input id="city" name="city" defaultValue={def("city", business.city)} />
          </Field>
          <Field label="Address" htmlFor="address" error={err?.address} className="sm:col-span-2">
            <Input id="address" name="address" defaultValue={def("address", business.address)} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Campuses you serve</CardTitle>
          <p className="mt-1 text-sm text-gray-600">Ticked for new deals by default. Each listing picks its own campus.</p>
        </CardHeader>
        <CardBody>
          <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-gray-200 p-2 sm:grid-cols-2">
            {universities.map((u) => (
              <Checkbox key={u.id} name="universityIds" value={u.id} label={u.name} defaultChecked={ticked.has(u.id)} />
            ))}
          </div>
          {err?.universityIds ? <p className="mt-1 text-sm text-red-600">{err.universityIds[0]}</p> : null}
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button type="submit" size="lg" loading={pending}>
          Save profile
        </Button>
      </div>
    </form>
  );
}
