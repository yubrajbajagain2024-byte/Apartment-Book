"use client";

import { useActionState, useState } from "react";
import type { ProfileSummary } from "@apartment-book/shared";
import { createConversationAction } from "@/lib/actions/messages";
import { Button } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MemberPicker } from "./member-picker";

export function NewConversationForm({ currentUserId }: { currentUserId: string }) {
  const [state, action, pending] = useActionState(createConversationAction, null);
  const [selected, setSelected] = useState<ProfileSummary[]>([]);
  const [group, setGroup] = useState(false);
  const isGroup = group || selected.length > 1;

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormMessage error={state?.error} />
      {selected.map((p) => (
        <input key={p.id} type="hidden" name="memberIds" value={p.id} />
      ))}
      <Field label="To" required>
        <MemberPicker selected={selected} onChange={setSelected} excludeIds={[currentUserId]} autoFocus />
      </Field>
      {isGroup ? (
        <Field label="Group name" htmlFor="name" required error={state?.fieldErrors?.name}>
          <Input id="name" name="name" required maxLength={80} defaultValue={state?.values?.name} placeholder="Apartment hunting crew" />
        </Field>
      ) : (
        <button type="button" onClick={() => setGroup(true)} className="self-start text-sm font-medium text-brand-600 hover:underline">
          Make this a group chat
        </button>
      )}
      <Button type="submit" size="lg" loading={pending} disabled={selected.length === 0}>
        {isGroup ? "Create group" : "Start chat"}
      </Button>
    </form>
  );
}
