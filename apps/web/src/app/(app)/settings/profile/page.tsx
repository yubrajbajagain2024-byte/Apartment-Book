import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listUniversities } from "@apartment-book/shared";
import { getCurrentProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/utils";
import { AddUniversityForm, ProfileForm } from "@/components/profile/profile-form";
import { DeleteAccount } from "@/components/profile/delete-account";

export const metadata: Metadata = { title: "Profile settings" };

export default async function ProfileSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireUser("/settings/profile");
  const params = await searchParams;
  const welcome = firstParam(params.welcome) === "1";
  const [profile, universities] = await Promise.all([getCurrentProfile(), listUniversities(await createClient())]);
  if (!profile) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Settings</p>
        <h1 className="font-display text-3xl tracking-tight text-gray-900">{welcome ? `Welcome, ${profile.full_name.split(" ")[0]}!` : "Profile settings"}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
          {welcome ? "Pick your university so we can show you apartments, roommates and items near campus." : "Update how other students see you."}
        </p>
      </div>
      <ProfileForm profile={profile} universities={universities} welcome={welcome} />
      <AddUniversityForm />
      <DeleteAccount />
    </div>
  );
}
