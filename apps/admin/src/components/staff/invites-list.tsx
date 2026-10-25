"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { canAssignRole, type StaffAccess, type StaffInvite } from "@apartment-book/shared";
import { revokeInviteAction } from "@/lib/actions/admin";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import { ConfirmButton } from "@/components/common/confirm-button";
import { Time } from "@/components/common/time";
import { RoleBadge } from "./role-badge";

/** Roles promised to addresses that have not confirmed an account yet. */
export function InvitesList({ invites, me }: { invites: StaffInvite[]; me: StaffAccess }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  async function withdraw(invite: StaffInvite) {
    const result = await revokeInviteAction(invite.email);
    setErrors((cur) => ({ ...cur, [invite.email]: result.error }));
    if (!result.error) router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>Pending invitations</CardTitle>
        <span className="text-sm text-gray-500">{invites.length}</span>
      </CardHeader>
      {invites.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-600">No pending invitations.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {invites.map((invite) => {
            const canWithdraw = canAssignRole(me.role, invite.role);
            return (
              <li key={invite.email} className="px-4 py-3 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                      <Mail className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate font-semibold text-gray-900">{invite.email}</span>
                        <RoleBadge role={invite.role} />
                      </div>
                      <p className="text-xs text-gray-500">
                        invited <Time iso={invite.createdAt} />
                        {invite.invitedByName ? ` by ${invite.invitedByName}` : ""}
                      </p>
                    </div>
                  </div>
                  {canWithdraw ? (
                    <div className="flex shrink-0 pl-13 sm:pl-0">
                      <ConfirmButton variant="outline" size="sm" action={() => withdraw(invite)} confirmText={`Withdraw the invitation for ${invite.email}? They will not become staff when they sign up.`}>
                        Withdraw
                      </ConfirmButton>
                    </div>
                  ) : null}
                </div>
                {errors[invite.email] ? (
                  <div className="mt-2">
                    <FormMessage error={errors[invite.email]} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
