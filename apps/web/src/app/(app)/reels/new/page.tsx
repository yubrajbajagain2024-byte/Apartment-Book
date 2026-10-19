import type { Metadata } from "next";
import { createReelAction } from "@/lib/actions/reels";
import { getCurrentProfile, requireUser } from "@/lib/auth";
import { ReelForm } from "@/components/home/reel-form";

export const metadata: Metadata = { title: "Post a reel" };

export default async function NewReelPage() {
  await requireUser("/reels/new");
  const profile = await getCurrentProfile();
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Post a reel</h1>
        <p className="text-sm text-gray-600">A short video for other students: your place, your campus, a tip worth sharing.</p>
      </div>
      <ReelForm action={createReelAction} defaultUniversityId={profile?.university_id} />
    </div>
  );
}
