import type { Metadata } from "next";
import { listUniversities } from "@apartment-book/shared";
import { createRoommatePostAction } from "@/lib/actions/roommates";
import { getCurrentProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RoommateForm } from "@/components/roommates/roommate-form";

export const metadata: Metadata = { title: "Create roommate post" };

export default async function NewRoommatePostPage() {
  const user = await requireUser("/roommates/new");
  const [profile, universities] = await Promise.all([getCurrentProfile(), listUniversities(await createClient())]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Create a roommate post</h1>
        <p className="text-sm text-gray-600">Tell other students what you are looking for.</p>
      </div>
      <RoommateForm action={createRoommatePostAction} universities={universities} userId={user.id} defaultUniversityId={profile?.university_id} />
    </div>
  );
}
