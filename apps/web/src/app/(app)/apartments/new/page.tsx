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
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Post an apartment</h1>
        <p className="text-sm text-gray-600">Rent out a room or a whole place to students near your campus.</p>
      </div>
      <ApartmentForm action={createApartmentAction} universities={universities} userId={user.id} defaultUniversityId={profile?.university_id} />
    </div>
  );
}
