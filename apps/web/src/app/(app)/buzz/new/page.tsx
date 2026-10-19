import type { Metadata } from "next";
import { createBuzzAction } from "@/lib/actions/buzz";
import { requireUser } from "@/lib/auth";
import { BuzzForm } from "@/components/home/buzz-form";

export const metadata: Metadata = { title: "Start a Buzz thread" };

export default async function NewBuzzPage() {
  await requireUser("/buzz/new");
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Start a thread</h1>
        <p className="text-sm text-gray-600">Share a thought, an experience, advice or a question. Nobody will know it was you.</p>
      </div>
      <BuzzForm action={createBuzzAction} />
    </div>
  );
}
