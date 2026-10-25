"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, UserMinus, UserPlus, X } from "lucide-react";
import { createInviteAction, removeMemberAction, revokeInviteAction } from "@/lib/actions/business";
import { formatDate } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Member = { userId: string; role: "owner" | "staff"; name: string; avatarUrl: string | null; joinedAt: string };
type Invite = { id: string; email: string; link: string; expiresAt: string };

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt("Copy this link", text);
        }
      }}
      className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-600 hover:bg-brand-50"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy link"}
    </button>
  );
}

/** The members, the pending invites with their join links, and (for the owner) the form that makes a new one. */
export function TeamPanel({ members, invites, currentUserId, isOwner }: { members: Member[]; invites: Invite[]; currentUserId: string; isOwner: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createInviteAction, null);
  const [working, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      const result = await work();
      setError(result.error ?? null);
      router.refresh();
    });
  const link = state?.values?.link;

  return (
    <div className="flex flex-col gap-4">
      {error ? <FormMessage error={error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="divide-y divide-gray-100" data-testid="team-members">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 py-2.5">
                <Avatar name={m.name} src={m.avatarUrl} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {m.name} {m.userId === currentUserId ? <span className="font-normal text-gray-500">(you)</span> : null}
                  </p>
                  <p className="text-xs text-gray-500">Joined {formatDate(m.joinedAt)}</p>
                </div>
                <Badge tone={m.role === "owner" ? "blue" : "gray"}>{m.role === "owner" ? "Owner" : "Staff"}</Badge>
                {isOwner && m.role === "staff" ? (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => {
                      if (!window.confirm(`Remove ${m.name} from the team? They leave every inquiry at once.`)) return;
                      run(() => removeMemberAction(m.userId));
                    }}
                    className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    <UserMinus className="h-3.5 w-3.5" /> Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite a teammate</CardTitle>
            <p className="mt-1 text-sm text-gray-600">
              Enter their work email. You get a join link to send them; it works for that address only, for 14 days. Staff need an address that is not on CampConnect yet.
            </p>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="Email" htmlFor="invite-email" error={state?.fieldErrors?.email} className="flex-1">
                <Input id="invite-email" name="email" type="email" required defaultValue={state?.values?.email} placeholder="colleague@yourbusiness.com" />
              </Field>
              <Button type="submit" loading={pending}>
                <UserPlus className="h-4 w-4" /> Create invite
              </Button>
            </form>
            {state?.error ? <FormMessage error={state.error} /> : null}
            {link ? (
              <div className="flex flex-col gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900" data-testid="invite-link">
                <p className="font-semibold">{state?.success}</p>
                <p className="flex flex-wrap items-center gap-2">
                  <Link2 className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 break-all font-mono text-xs">{link}</span>
                  <CopyButton text={link} />
                </p>
                <p className="text-xs opacity-80">Send this link to them; the sign-up page it opens is theirs alone.</p>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {isOwner && invites.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-gray-100" data-testid="team-invites">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{i.email}</p>
                    <p className="text-xs text-gray-500">Expires {formatDate(i.expiresAt)}</p>
                  </div>
                  <CopyButton text={i.link} />
                  <button type="button" disabled={working} onClick={() => run(() => revokeInviteAction(i.id))} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-red-600 hover:bg-red-50">
                    <X className="h-3.5 w-3.5" /> Revoke
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
