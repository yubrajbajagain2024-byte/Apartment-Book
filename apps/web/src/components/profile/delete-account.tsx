"use client";

import { useState, useTransition } from "react";
import { deleteAccountAction } from "@/lib/actions/profile";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/input";

/** Account deletion with a typed confirmation, required by the app stores. */
export function DeleteAccount() {
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  return (
    <section className="rounded-xl bg-red-50 p-5 ring-1 ring-red-200">
      <h2 className="font-display text-xl tracking-tight text-red-700">Delete account</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-gray-700">This permanently removes your profile, posts, comments, messages and saved items. Type <strong>DELETE</strong> to confirm.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" className={cn(inputClasses, "h-11 w-44 bg-white")} />
        <Button type="button" variant="danger" disabled={confirm !== "DELETE" || pending} onClick={() => start(() => deleteAccountAction())}>
          {pending ? "Deleting…" : "Delete my account"}
        </Button>
      </div>
    </section>
  );
}
