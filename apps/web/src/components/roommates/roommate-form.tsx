"use client";

import { useActionState, useState } from "react";
import {
  CLEANLINESS_LEVELS,
  CURRENCIES,
  GENDER_PREFERENCES,
  photosFor,
  ROOMMATE_POST_TYPES,
  SLEEP_SCHEDULES,
  type RoommatePost,
  type University,
} from "@apartment-book/shared";
import type { FormState } from "@/lib/actions/types";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { ImageUploader } from "@/components/common/image-uploader";
import { LocationPicker } from "@/components/map/location-picker";
import { UniversitySelect } from "@/components/common/university-select";

export function RoommateForm({
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
  initial?: RoommatePost;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values;
  const def = (key: string, fallback: string | number | null | undefined) => v?.[key] ?? (fallback ?? "").toString();
  const defBool = (key: string, fallback: boolean | undefined) => (v ? v[key] === "on" : Boolean(fallback));
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
          <CardTitle>What are you looking for?</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <fieldset className="sm:col-span-2">
            <div className="grid gap-2 sm:grid-cols-2">
              {ROOMMATE_POST_TYPES.map((t) => (
                <label key={t.value} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-300 px-3 py-3 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                  <input type="radio" name="postType" value={t.value} defaultChecked={def("postType", initial?.post_type ?? "needs_room") === t.value} className="text-brand-600" />
                  {t.label}
                </label>
              ))}
            </div>
            {err?.postType ? <p className="mt-1 text-sm text-red-600">{err.postType[0]}</p> : null}
          </fieldset>
          <Field label="Title" htmlFor="title" required error={err?.title} className="sm:col-span-2">
            <Input id="title" name="title" required maxLength={120} defaultValue={def("title", initial?.title)} placeholder="2nd-year CS student looking for a quiet roommate" />
          </Field>
          <Field label="About you and what you want" htmlFor="description" required error={err?.description} className="sm:col-span-2" hint="Your program, habits, what the place is like, what matters to you.">
            <Textarea id="description" name="description" required defaultValue={def("description", initial?.description)} />
          </Field>
          <Field label="University" htmlFor="universityId" error={err?.universityId}>
            <UniversitySelect id="universityId" universities={universities} defaultValue={def("universityId", initial?.university_id ?? defaultUniversityId)} emptyLabel="Choose a university" onChange={setUniversityId} />
          </Field>
          <Field label="Preferred area" htmlFor="location" error={err?.location}>
            <Input id="location" name="location" defaultValue={def("location", initial?.location)} placeholder="Near campus, downtown…" />
          </Field>
          <Field label="Budget per month" error={err?.budgetMin ?? err?.budgetMax} className="sm:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select name="currency" defaultValue={def("currency", initial?.currency ?? "USD")} className="w-28" aria-label="Currency">
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
              <Input name="budgetMin" type="number" min={0} placeholder="Min" className="w-32" defaultValue={def("budgetMin", initial?.budget_min)} aria-label="Minimum budget" />
              <span className="text-gray-500">to</span>
              <Input name="budgetMax" type="number" min={0} placeholder="Max" className="w-32" defaultValue={def("budgetMax", initial?.budget_max)} aria-label="Maximum budget" />
            </div>
          </Field>
          <Field label="Move-in date" htmlFor="moveInDate" error={err?.moveInDate}>
            <Input id="moveInDate" name="moveInDate" type="date" defaultValue={def("moveInDate", initial?.move_in_date)} />
          </Field>
          <Field label="Pin the area on the map (optional)" error={err?.latitude ?? err?.longitude} className="sm:col-span-2" hint="If you already have a place, pin it so people can see how far it is from campus.">
            <LocationPicker initial={initialPin} campus={campus} addressFieldIds={["location"]} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Roommate gender" htmlFor="genderPreference" error={err?.genderPreference}>
            <Select id="genderPreference" name="genderPreference" defaultValue={def("genderPreference", initial?.gender_preference ?? "any")}>
              {GENDER_PREFERENCES.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sleep schedule" htmlFor="sleepSchedule" error={err?.sleepSchedule}>
            <Select id="sleepSchedule" name="sleepSchedule" defaultValue={def("sleepSchedule", initial?.sleep_schedule)}>
              <option value="">Not specified</option>
              {SLEEP_SCHEDULES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cleanliness" htmlFor="cleanliness" error={err?.cleanliness}>
            <Select id="cleanliness" name="cleanliness" defaultValue={def("cleanliness", initial?.cleanliness)}>
              <option value="">Not specified</option>
              {CLEANLINESS_LEVELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-5 sm:col-span-3">
            <Checkbox name="smokingOk" label="Smoking is okay" defaultChecked={defBool("smokingOk", initial?.smoking_ok)} />
            <Checkbox name="petsOk" label="Pets are okay" defaultChecked={defBool("petsOk", initial?.pets_ok)} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Photos (optional)</CardTitle>
        </CardHeader>
        <CardBody>
          <ImageUploader kind="roommates" userId={userId} initial={initial ? photosFor(initial.images, initial.image_meta) : []} max={6} />
          {err?.images ? <p className="mt-2 text-sm text-red-600">{err.images[0]}</p> : null}
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <LinkButton href={initial ? `/roommates/${initial.id}` : "/roommates"} variant="ghost">
          Cancel
        </LinkButton>
        <Button type="submit" size="lg" loading={pending}>
          {initial ? "Save changes" : "Publish post"}
        </Button>
      </div>
    </form>
  );
}
