"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { assignableRoles, canChangeMember, STAFF_ROLE_VALUES, type StaffAccess, type StaffMember, type StaffRole } from "@apartment-book/shared";
import { removeStaffAction, sendPasswordResetAction, setStaffRoleAction } from "@/lib/actions/admin";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { ConfirmButton } from "@/components/common/confirm-button";
import { Time } from "@/components/common/time";
import { RoleBadge, roleLabel } from "./role-badge";

/** Everyone on the team. Controls only appear where the caller may act (never on their own row); the database re-checks every change anyway. */
export function StaffTable({ members, me, emailsEnabled = false }: { members: StaffMember[]; me: StaffAccess; emailsEnabled?: boolean }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [notices, setNotices] = useState<Record<string, string | undefined>>({});
  const setError = (userId: string, error?: string) => setErrors((cur) => ({ ...cur, [userId]: error }));

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>Team members</CardTitle>
        <span className="text-sm text-gray-500">
          {members.length} {members.length === 1 ? "person" : "people"}
        </span>
      </CardHeader>
      {members.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-gray-600">No staff yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {members.map((member) => (
            <StaffRow
              key={member.userId}
              member={member}
              me={me}
              error={errors[member.userId]}
              notice={notices[member.userId]}
              emailsEnabled={emailsEnabled}
              onNotice={(text) => setNotices((cur) => ({ ...cur, [member.userId]: text }))}
              onError={(error) => setError(member.userId, error)}
              onChanged={() => {
                setError(member.userId);
                router.refresh();
              }}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function StaffRow({
  member,
  me,
  error,
  notice,
  emailsEnabled,
  onNotice,
  onError,
  onChanged,
}: {
  member: StaffMember;
  me: StaffAccess;
  error?: string;
  notice?: string;
  emailsEnabled: boolean;
  onNotice: (text: string) => void;
  onError: (error: string) => void;
  onChanged: () => void;
}) {
  const isMe = member.userId === me.userId;
  const editable = canChangeMember(me, member);
  const allowed = assignableRoles(me.role);
  const options = STAFF_ROLE_VALUES.filter((role) => allowed.includes(role) || role === member.role);
  const [pending, start] = useTransition();
  const name = member.fullName || member.email || "Unnamed";

  function changeRole(role: StaffRole) {
    if (role === member.role) return;
    if (!window.confirm(`Change ${name}'s role from ${roleLabel(member.role)} to ${roleLabel(role)}?`)) return;
    start(async () => {
      const result = await setStaffRoleAction(member.userId, role);
      if (result.error) onError(result.error);
      else onChanged();
    });
  }

  async function sendReset() {
    const result = await sendPasswordResetAction(member.userId);
    if (result.error) onError(result.error);
    else onNotice(result.success ?? "Sent.");
  }

  async function remove() {
    const result = await removeStaffAction(member.userId);
    if (result.error) onError(result.error);
    else onChanged();
  }

  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Avatar name={name} src={member.avatarUrl} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link href={`/users/${member.userId}`} className="truncate font-semibold text-gray-900 hover:underline">
                {name}
              </Link>
              {isMe ? <span className="text-xs font-medium text-gray-500">(you)</span> : null}
              <RoleBadge role={member.role} />
              {member.mfaEnrolled === null ? null : member.mfaEnrolled ? (
                <Badge tone="green">
                  <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
                  2FA on
                </Badge>
              ) : (
                <Badge tone="amber">
                  <ShieldOff className="mr-1 h-3 w-3" aria-hidden="true" />
                  No 2FA yet
                </Badge>
              )}
            </div>
            {member.email ? <p className="truncate text-sm text-gray-600">{member.email}</p> : null}
            <p className="text-xs text-gray-500">
              added <Time iso={member.createdAt} />
              {member.grantedByName ? ` by ${member.grantedByName}` : ""}
            </p>
          </div>
        </div>
        {editable ? (
          <div className="flex shrink-0 items-center gap-2 pl-13 sm:pl-0">
            <Select aria-label={`Role for ${name}`} value={member.role} disabled={pending} onChange={(e) => changeRole(e.target.value as StaffRole)} className="h-8 w-36 py-1">
              {options.map((role) => (
                <option key={role} value={role} disabled={!allowed.includes(role)}>
                  {roleLabel(role)}
                </option>
              ))}
            </Select>
            {emailsEnabled ? (
              <ConfirmButton variant="outline" size="sm" action={sendReset} confirmText={`Email ${name} a link to choose a new password? Two-factor stays required.`}>
                Reset password
              </ConfirmButton>
            ) : null}
            <ConfirmButton variant="danger" size="sm" action={remove} confirmText={`Remove ${name} from the team? They lose access to this app immediately.`}>
              Remove
            </ConfirmButton>
          </div>
        ) : null}
      </div>
      {error || notice ? (
        <div className="mt-2">
          <FormMessage error={error} success={error ? null : notice} />
        </div>
      ) : null}
    </li>
  );
}
