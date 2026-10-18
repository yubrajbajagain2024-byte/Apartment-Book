import type { Metadata } from "next";
import { listUniversities } from "@apartment-book/shared";
import { createApartmentAction } from "@/lib/actions/apartments";
import { getCurrentProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ApartmentForm } from "@/components/apartments/apartment-form";

export const metadata: Metadata = { title: "Post an apartment" };

export default async function NewApartmentPage() {
  const user = await requireUser("/apartments/new");
  const [profile, universities] = await Promise.all([getCurrentProfile(), listUniversities(await createClient())]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl tracking-tight text-gray-900">Post an apartment</h1>
        <p className="mt-1.5 text-sm text-gray-500">Rent out a room or a whole place to students near your campus.</p>
      </div>
      <ApartmentForm action={createApartmentAction} universities={universities} userId={user.id} defaultUniversityId={profile?.university_id} />
    </div>
  );
}
