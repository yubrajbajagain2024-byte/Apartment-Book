"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, UserMinus, UserPlus, X } from "lucide-react";
import { BUSINESS_TEAM_ROLES, assignableRoles, canManageMember, teamRoleAllows, teamRoleLabel, type BusinessTeamRole } from "@apartment-book/shared";
import { createInviteAction, removeMemberAction, revokeInviteAction, setMemberRoleAction } from "@/lib/actions/business";
import { cn, formatDate } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { bizButton, bizField, Notice, Panel, PanelHeader, Pill } from "./ui";

type Member = { userId: string; role: BusinessTeamRole; name: string; avatarUrl: string | null; joinedAt: string };
type Invite = { id: string; email: string; role: BusinessTeamRole; link: string; expiresAt: string };

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
      className={bizButton({ variant: "ghost", size: "sm" })}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy link"}
    </button>
  );
}

/**
 * The team: who is on it and as what, the pending invites with their join links, and (for the owner and admins) the
 * invite form and each member's role. Only the owner makes or changes admins; nobody changes the owner (the database
 * holds the same rules). A role change moves the person in or out of the inquiry chats at once.
 */
export function TeamPanel({ members, invites, currentUserId, myRole }: { members: Member[]; invites: Invite[]; currentUserId: string; myRole: BusinessTeamRole }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createInviteAction, null);
  const [working, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const run = (work: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      const result = await work();
      setError(result.error ?? null);
      router.refresh();
    });
  const manages = teamRoleAllows(myRole, "manage_team");
  const roles = assignableRoles(myRole);
  const link = state?.values?.link;

  return (
    <div className="flex flex-col gap-6">
      {error ? <Notice tone="danger" title={error} /> : null}

      <Panel className="pb-2">
        <PanelHeader title="Members" subtitle={`${members.length} on the team`} />
        <ul className="mt-3 divide-y divide-biz-line" data-testid="team-members">
          {members.map((m) => {
            const manageable = manages && m.userId !== currentUserId && canManageMember(myRole, m.role);
            return (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-6 py-3.5">
                <Avatar name={m.name} src={m.avatarUrl} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-biz-ink">
                    {m.name}
                    {m.userId === currentUserId ? <span className="text-biz-ink-4"> (you)</span> : null}
                  </span>
                  <span className="block text-[13px] text-biz-ink-4">Joined {formatDate(m.joinedAt)}</span>
                </span>
                {manageable ? (
                  <select
                    aria-label={`${m.name}'s role`}
                    value={m.role}
                    disabled={working}
                    onChange={(e) => run(() => setMemberRoleAction(m.userId, e.target.value as Exclude<BusinessTeamRole, "owner">))}
                    className={cn(bizField, "h-9 w-auto py-0 pr-8 text-[13px]")}
                  >
                    {Array.from(new Set([m.role, ...roles])).map((r) => (
                      <option key={r} value={r}>
                        {teamRoleLabel(r)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Pill tone={m.role === "owner" ? "accent" : "neutral"}>{teamRoleLabel(m.role)}</Pill>
                )}
                {manageable ? (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => {
                      if (confirm !== m.userId) return setConfirm(m.userId);
                      setConfirm(null);
                      run(() => removeMemberAction(m.userId));
                    }}
                    className={bizButton({ variant: confirm === m.userId ? "danger" : "ghost", size: "sm" })}
                  >
                    <UserMinus className="h-3.5 w-3.5" /> {confirm === m.userId ? "Remove?" : "Remove"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Panel>

      {manages ? (
        <Panel className="p-6">
          <h2 className="text-[17px] font-semibold text-biz-ink">Invite someone</h2>
          <p className="mt-0.5 text-[13px] text-biz-ink-3">They need an address with no UniBuzz account yet. Send them the link; it works for 14 days.</p>
          <form action={action} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex-1">
              <label htmlFor="invite-email" className="sr-only">
                Email
              </label>
              <input id="invite-email" name="email" type="email" required placeholder="name@yourbusiness.com" defaultValue={state?.values?.email ?? ""} className={cn(bizField, "h-11")} />
              {state?.fieldErrors?.email ? <p className="mt-1 text-[13px] text-biz-danger">{state.fieldErrors.email[0]}</p> : null}
            </div>
            <label htmlFor="invite-role" className="sr-only">
              Role
            </label>
            <select id="invite-role" name="role" defaultValue={state?.values?.role ?? "editor"} className={cn(bizField, "h-11 sm:w-40")}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {teamRoleLabel(r)}
                </option>
              ))}
            </select>
            <button type="submit" disabled={pending} className={bizButton({ variant: "primary", className: "h-11" })}>
              <UserPlus className="h-4 w-4" /> {pending ? "Creating…" : "Create invite"}
            </button>
          </form>
          {state?.error ? <p className="mt-3 text-[13px] text-biz-danger">{state.error}</p> : null}
          {link ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-biz-success-soft px-4 py-3 text-[13px] text-biz-success" role="status">
              <span className="min-w-0 flex-1 break-all">{state?.success} {link}</span>
              <CopyButton text={link} />
            </div>
          ) : null}
        </Panel>
      ) : null}

      {manages && invites.length ? (
        <Panel className="pb-2">
          <PanelHeader title="Pending invites" />
          <ul className="mt-3 divide-y divide-biz-line">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-6 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-biz-ink">{i.email}</span>
                  <span className="block text-[13px] text-biz-ink-4">
                    {teamRoleLabel(i.role)} · until {formatDate(i.expiresAt)}
                  </span>
                </span>
                <CopyButton text={i.link} />
                <button type="button" disabled={working} onClick={() => run(() => revokeInviteAction(i.id))} className={bizButton({ variant: "ghost", size: "sm" })}>
                  <X className="h-3.5 w-3.5" /> Revoke
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel className="p-6">
        <h2 className="text-[17px] font-semibold text-biz-ink">Who can do what</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {BUSINESS_TEAM_ROLES.map((r) => (
            <div key={r.value} className="rounded-2xl bg-biz-surface-3 p-4">
              <dt className="text-[15px] font-semibold text-biz-ink">{r.label}</dt>
              <dd className="mt-0.5 text-[13px] leading-relaxed text-biz-ink-3">{r.description}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
