"use client";

import { useState, useTransition } from "react";
import { deleteAccountAction } from "@/lib/actions/profile";
import { Button } from "@/components/ui/button";

/** Account deletion with a typed confirmation, required by the app stores. */
export function DeleteAccount() {
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  return (
    <section className="rounded-xl border border-red-200 bg-red-50/50 p-4">
      <h2 className="font-semibold text-red-800">Delete account</h2>
      <p className="mt-1 text-sm text-red-900/80">This permanently removes your profile, posts, comments, messages and saved items. Type <strong>DELETE</strong> to confirm.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" className="h-10 rounded-lg border border-red-300 px-3 text-sm" />
        <Button type="button" variant="danger" disabled={confirm !== "DELETE" || pending} onClick={() => start(() => deleteAccountAction())}>
          {pending ? "Deleting…" : "Delete my account"}
        </Button>
      </div>
    </section>
  );
}
