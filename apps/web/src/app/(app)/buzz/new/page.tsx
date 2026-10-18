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
        <h1 className="font-display text-3xl tracking-tight text-gray-900">Start a thread</h1>
        <p className="mt-1 text-sm text-gray-500">Share a thought, an experience, advice or a question. Nobody will know it was you.</p>
      </div>
      <BuzzForm action={createBuzzAction} />
    </div>
  );
}
