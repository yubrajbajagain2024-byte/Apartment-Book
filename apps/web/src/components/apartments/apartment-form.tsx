"use client";

import { useActionState, useState } from "react";
import { AMENITIES, CURRENCIES, photosFor, type Apartment, type University } from "@apartment-book/shared";
import type { FormState } from "@/lib/actions/types";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { ImageUploader } from "@/components/common/image-uploader";
import { LocationPicker } from "@/components/map/location-picker";
import { UniversitySelect } from "@/components/common/university-select";

export function ApartmentForm({
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
  initial?: Apartment;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values;
  const def = (key: string, fallback: string | number | null | undefined) => v?.[key] ?? (fallback ?? "").toString();
  const defBool = (key: string, fallback: boolean | undefined) => (v ? v[key] === "on" : Boolean(fallback));
  const selectedAmenities = new Set(v ? (v.amenities ?? "").split(",").filter(Boolean) : (initial?.amenities ?? []));
  const err = state?.fieldErrors;
  const [universityId, setUniversityId] = useState(def("universityId", initial?.university_id ?? defaultUniversityId));
  const campusUniversity = universities.find((u) => u.id === universityId);
  const campus =
    campusUniversity && campusUniversity.latitude !== null && campusUniversity.longitude !== null
      ? { latitude: campusUniversity.latitude, longitude: campusUniversity.longitude, name: campusUniversity.name }
      : null;
  const initialPin =
    v?.latitude && v?.longitude
      ? { latitude: Number(v.latitude), longitude: Number(v.longitude) }
      : initial?.latitude != null && initial?.longitude != null
        ? { latitude: initial.latitude, longitude: initial.longitude }
        : null;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormMessage error={state?.error} />

      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="title" required error={err?.title} className="sm:col-span-2">
            <Input id="title" name="title" required maxLength={120} defaultValue={def("title", initial?.title)} placeholder="Sunny 2-bed near campus, utilities included" />
          </Field>
          <Field label="Description" htmlFor="description" required error={err?.description} className="sm:col-span-2" hint="What is included, who you are looking for, house rules…">
            <Textarea id="description" name="description" required defaultValue={def("description", initial?.description)} />
          </Field>
          <Field label="Rent per month" htmlFor="pricePerMonth" required error={err?.pricePerMonth}>
            <div className="flex gap-2">
              <Select name="currency" defaultValue={def("currency", initial?.currency ?? "USD")} className="w-28" aria-label="Currency">
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
              <Input id="pricePerMonth" name="pricePerMonth" type="number" min={0} step="0.01" required defaultValue={def("pricePerMonth", initial?.price_per_month)} />
            </div>
          </Field>
          <Field label="Nearest university" htmlFor="universityId" error={err?.universityId}>
            <UniversitySelect id="universityId" universities={universities} defaultValue={def("universityId", initial?.university_id ?? defaultUniversityId)} emptyLabel="Choose a university" onChange={setUniversityId} />
          </Field>
          <Field label="Address" htmlFor="address" required error={err?.address} className="sm:col-span-2">
            <Input id="address" name="address" required defaultValue={def("address", initial?.address)} placeholder="Street and number" />
          </Field>
          <Field label="City / area" htmlFor="city" error={err?.city}>
            <Input id="city" name="city" defaultValue={def("city", initial?.city)} />
          </Field>
          <Field label="Map link" htmlFor="mapUrl" error={err?.mapUrl} hint="Paste a Google Maps link (optional)." >
            <Input id="mapUrl" name="mapUrl" type="url" defaultValue={def("mapUrl", initial?.map_url)} placeholder="https://maps.google.com/…" />
          </Field>
          <Field
            label="Pin the location on the map"
            error={err?.latitude ?? err?.longitude}
            className="sm:col-span-2"
            hint="Students can filter by distance from campus and find your place on the map. The distance is calculated from the pin."
          >
            <LocationPicker initial={initialPin} campus={campus} addressFieldIds={["address", "city"]} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Bedrooms" htmlFor="bedrooms" required error={err?.bedrooms} hint="0 for a studio.">
            <Input id="bedrooms" name="bedrooms" type="number" min={0} max={20} required defaultValue={def("bedrooms", initial?.bedrooms ?? 1)} />
          </Field>
          <Field label="Bathrooms" htmlFor="bathrooms" required error={err?.bathrooms}>
            <Input id="bathrooms" name="bathrooms" type="number" min={0} max={20} step="0.5" required defaultValue={def("bathrooms", initial?.bathrooms ?? 1)} />
          </Field>
          <Field label="Available from" htmlFor="availableFrom" error={err?.availableFrom}>
            <Input id="availableFrom" name="availableFrom" type="date" defaultValue={def("availableFrom", initial?.available_from)} />
          </Field>
          <Field label="Lease length (months)" htmlFor="leaseMonths" error={err?.leaseMonths}>
            <Input id="leaseMonths" name="leaseMonths" type="number" min={1} max={60} defaultValue={def("leaseMonths", initial?.lease_months)} />
          </Field>
          <div className="flex flex-wrap gap-5 sm:col-span-2">
            <Checkbox name="furnished" label="Furnished" defaultChecked={defBool("furnished", initial?.furnished)} />
            <Checkbox name="utilitiesIncluded" label="Utilities included" defaultChecked={defBool("utilitiesIncluded", initial?.utilities_included)} />
            <Checkbox name="petsAllowed" label="Pets allowed" defaultChecked={defBool("petsAllowed", initial?.pets_allowed)} />
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium text-gray-800">Amenities</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {AMENITIES.map((a) => (
                <Checkbox key={a.value} name="amenities" value={a.value} label={a.label} defaultChecked={selectedAmenities.has(a.value)} />
              ))}
            </div>
          </fieldset>
          <Field label="Contact phone (optional)" htmlFor="contactPhone" error={err?.contactPhone} hint="Shown publicly on the listing. Messaging works without it.">
            <Input id="contactPhone" name="contactPhone" type="tel" defaultValue={def("contactPhone", initial?.contact_phone)} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Photos</CardTitle>
        </CardHeader>
        <CardBody>
          <ImageUploader kind="apartments" userId={userId} initial={initial ? photosFor(initial.images, initial.image_meta) : []} />
          {err?.images ? <p className="mt-2 text-sm text-red-600">{err.images[0]}</p> : null}
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <LinkButton href={initial ? `/apartments/${initial.id}` : "/"} variant="ghost">
          Cancel
        </LinkButton>
        <Button type="submit" size="lg" loading={pending}>
          {initial ? "Save changes" : "Publish listing"}
        </Button>
      </div>
    </form>
  );
}
