"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock, Mail, MailCheck, MailX } from "lucide-react";
import { canAssignRole, formatDate, type StaffAccess, type StaffInvite } from "@apartment-book/shared";
import { resendInviteAction, revokeInviteAction } from "@/lib/actions/admin";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import { ConfirmButton } from "@/components/common/confirm-button";
import { Time } from "@/components/common/time";
import { RoleBadge } from "./role-badge";

/** The email part of an invitation's state, in words. */
function EmailState({ invite }: { invite: StaffInvite }) {
  if (invite.emailStatus === "sent") {
    return (
      <Badge tone="green">
        <MailCheck className="mr-1 h-3 w-3" aria-hidden="true" />
        Email sent <Time iso={invite.emailSentAt} className="ml-1" />
        {invite.emailAttempts > 1 ? ` (${invite.emailAttempts} times)` : ""}
      </Badge>
    );
  }
  if (invite.emailStatus === "failed") {
    return (
      <Badge tone="red">
        <MailX className="mr-1 h-3 w-3" aria-hidden="true" />
        Email failed
      </Badge>
    );
  }
  return (
    <Badge tone="amber">
      <Mail className="mr-1 h-3 w-3" aria-hidden="true" />
      No email sent
    </Badge>
  );
}

/** Roles promised to addresses that have not accepted yet, with what happened to their email. */
export function InvitesList({ invites, me, emailsEnabled }: { invites: StaffInvite[]; me: StaffAccess; emailsEnabled: boolean }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Record<string, { error?: string; success?: string } | undefined>>({});

  async function run(invite: StaffInvite, action: (email: string) => Promise<{ error?: string; success?: string }>) {
    const result = await action(invite.email);
    setMessages((cur) => ({ ...cur, [invite.email]: result }));
    router.refresh();
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
            // Owners may act on any invitation; admins only on moderator ones. SQL re-checks this.
            const canManage = canAssignRole(me.role, invite.role);
            const message = messages[invite.email];
            return (
              <li key={invite.email} className="px-4 py-3 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                      <Mail className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate font-semibold text-gray-900">{invite.email}</span>
                        <RoleBadge role={invite.role} />
                        <EmailState invite={invite} />
                        {invite.expired ? (
                          <Badge tone="gray">
                            <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />
                            Expired
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-gray-500">
                        invited <Time iso={invite.createdAt} />
                        {invite.invitedByName ? ` by ${invite.invitedByName}` : ""}
                        {invite.expiresAt ? (
                          <>
                            {" · "}
                            <Clock className="inline h-3 w-3" aria-hidden="true" /> {invite.expired ? "expired" : "open until"} {formatDate(invite.expiresAt)}
                          </>
                        ) : null}
                        {invite.accountCreated ? " · waiting for them to open the link" : ""}
                      </p>
                      {invite.emailStatus === "failed" && invite.emailError ? <p className="mt-1 text-xs break-words text-red-700">{invite.emailError}</p> : null}
                    </div>
                  </div>
                  {canManage ? (
                    <div className="flex shrink-0 flex-wrap gap-2 pl-13 sm:pl-0">
                      {emailsEnabled ? (
                        <ConfirmButton
                          variant="outline"
                          size="sm"
                          action={() => run(invite, resendInviteAction)}
                          confirmText={`Send the invitation email to ${invite.email}${invite.emailStatus === "sent" ? " again" : ""}? The invitation is renewed for 7 days.`}
                        >
                          {invite.emailStatus === "sent" ? "Send again" : "Send email"}
                        </ConfirmButton>
                      ) : null}
                      <ConfirmButton
                        variant="outline"
                        size="sm"
                        action={() => run(invite, revokeInviteAction)}
                        confirmText={`Withdraw the invitation for ${invite.email}? The link in any email already sent stops working.`}
                      >
                        Withdraw
                      </ConfirmButton>
                    </div>
                  ) : null}
                </div>
                {message ? (
                  <div className="mt-2">
                    <FormMessage error={message.error} success={message.success} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {!emailsEnabled && invites.length > 0 ? (
        <p className="border-t border-gray-100 px-5 py-3 text-xs text-amber-800">
          This deployment cannot send email yet (SUPABASE_SERVICE_ROLE_KEY is not set on the admin app), so invitations are only saved. See the README, “Invitation emails”.
        </p>
      ) : null}
    </Card>
  );
}
