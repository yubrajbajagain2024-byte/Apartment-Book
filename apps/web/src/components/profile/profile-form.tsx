"use client";

import { useActionState } from "react";
import { PROFILE_SECTION_NOUNS, PROFILE_VISIBILITY_OPTIONS, USERNAME_RULES, type ProfileSection, type ProfileWithUniversity, type University } from "@apartment-book/shared";
import { addUniversityAction, updateProfileAction } from "@/lib/actions/profile";
import { profileHandle, sectionVisibility } from "@/lib/profile";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { AvatarUploader } from "@/components/common/avatar-uploader";
import { UniversitySelect } from "@/components/common/university-select";

/** The three privacy choices: the form field for each tab. */
const PRIVACY_FIELDS: { section: ProfileSection; name: string }[] = [
  { section: "classes", name: "classesVisibility" },
  { section: "saved", name: "savedVisibility" },
  { section: "liked", name: "likedVisibility" },
];

export function ProfileForm({ profile, universities, welcome }: { profile: ProfileWithUniversity; universities: University[]; welcome: boolean }) {
  const [state, action, pending] = useActionState(updateProfileAction, null);
  const v = state?.values;
  const def = (key: string, fallback: string | number | null | undefined) => v?.[key] ?? (fallback ?? "").toString();
  const err = state?.fieldErrors;
  const visibility = sectionVisibility(profile);

  return (
    <form action={action} className="flex flex-col gap-5">
      <FormMessage error={state?.error} success={state?.success} />
      {welcome ? <input type="hidden" name="redirectTo" value="home" /> : null}
      <Card>
        <CardHeader>
          <CardTitle>Your profile</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <AvatarUploader name="avatarUrl" userId={profile.id} initialUrl={profile.avatar_url} displayName={profile.full_name} />
          </div>
          <Field label="Full name" htmlFor="fullName" required error={err?.fullName}>
            <Input id="fullName" name="fullName" required maxLength={80} defaultValue={def("fullName", profile.full_name)} />
          </Field>
          <Field label="Username" htmlFor="username" error={err?.username} hint={USERNAME_RULES}>
            <div className="relative">
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-500">
                @
              </span>
              <Input
                id="username"
                name="username"
                maxLength={31}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={err?.username ? true : undefined}
                defaultValue={def("username", profileHandle(profile))}
                placeholder="yourname"
                className="pl-7"
              />
            </div>
          </Field>
          <Field label="University" htmlFor="universityId" error={err?.universityId} hint="Listings near your university show first." className="sm:col-span-2">
            <UniversitySelect id="universityId" universities={universities} defaultValue={def("universityId", profile.university_id)} emptyLabel="Choose your university" />
          </Field>
          <Field label="Program / major" htmlFor="program" error={err?.program}>
            <Input id="program" name="program" defaultValue={def("program", profile.program)} placeholder="Computer Science" />
          </Field>
          <Field label="Graduation year" htmlFor="graduationYear" error={err?.graduationYear}>
            <Input id="graduationYear" name="graduationYear" type="number" min={2000} max={2100} defaultValue={def("graduationYear", profile.graduation_year)} />
          </Field>
          <Field label="Bio" htmlFor="bio" error={err?.bio} className="sm:col-span-2" hint="A few words about you help roommates and sellers trust you.">
            <Textarea id="bio" name="bio" maxLength={600} defaultValue={def("bio", profile.bio)} />
          </Field>
          <div className="sm:col-span-2">
            <Checkbox name="notifyNearbyListings" label="Notify me when a new place is posted within 2 miles of my campus" defaultChecked={v ? v.notifyNearbyListings === "on" : profile.notify_nearby_listings} />
            <Checkbox name="showActiveStatus" label="Show when I'm active (green dot and 'Active now' in chats)" defaultChecked={v ? v.showActiveStatus === "on" : profile.show_active_status} />
          </div>
        </CardBody>
      </Card>
      <Card>
        <fieldset className="min-w-0" data-testid="privacy-settings">
          <legend className="px-5 pt-4 text-lg font-semibold text-gray-900">Privacy</legend>
          <p className="px-5 pt-1 text-sm text-gray-600">Choose who can open the Classes, Saved and Liked tabs on your profile. Friends are people you follow who follow you back.</p>
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
            {PRIVACY_FIELDS.map(({ section, name }) => (
              <Field key={name} label={`Who can see your ${PROFILE_SECTION_NOUNS[section]}`} htmlFor={name} error={err?.[name]}>
                <Select id={name} name={name} defaultValue={def(name, visibility[section])}>
                  {PROFILE_VISIBILITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
        </fieldset>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" size="lg" loading={pending}>
          {welcome ? "Save and continue" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

export function AddUniversityForm() {
  const [state, action, pending] = useActionState(addUniversityAction, null);
  return (
    <details className="rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
      <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-gray-800">Can&apos;t find your university? Add it</summary>
      <form action={action} className="grid gap-3 border-t border-gray-100 px-5 py-4 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <FormMessage error={state?.error} success={state?.success} />
        </div>
        <Field label="University name" htmlFor="uniName" required error={state?.fieldErrors?.name} className="sm:col-span-3">
          <Input id="uniName" name="name" required defaultValue={state?.success ? "" : state?.values?.name} />
        </Field>
        <Field label="City" htmlFor="uniCity" error={state?.fieldErrors?.city}>
          <Input id="uniCity" name="city" defaultValue={state?.success ? "" : state?.values?.city} />
        </Field>
        <Field label="Country" htmlFor="uniCountry" error={state?.fieldErrors?.country}>
          <Input id="uniCountry" name="country" defaultValue={state?.success ? "" : state?.values?.country} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="secondary" loading={pending}>
            Add university
          </Button>
        </div>
      </form>
    </details>
  );
}
