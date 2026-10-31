"use client";

import { useActionState, useState } from "react";
import { UserPlus } from "lucide-react";
import { assignableStaffRoles, STAFF_ROLES, type StaffAccess, type AdminStaffRole } from "@apartment-book/shared";
import { addStaffAction } from "@/lib/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { roleLabel } from "./role-badge";

/** Add someone by email. Admins can only offer the moderator role; owners any role. */
export function AddStaffForm({ me, emailsEnabled }: { me: StaffAccess; emailsEnabled: boolean }) {
  const [state, action, pending] = useActionState(addStaffAction, null);
  const roles = assignableStaffRoles(me.role);
  const [role, setRole] = useState<AdminStaffRole>(roles[roles.length - 1] ?? "moderator");
  const description = STAFF_ROLES.find((r) => r.value === role)?.description;

  if (roles.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add to team</CardTitle>
      </CardHeader>
      <form action={action} className="flex flex-col gap-4 px-5 py-4">
        <FormMessage error={state?.error} success={state?.success} />
        <Field label="Email" htmlFor="staffEmail" required error={state?.fieldErrors?.email}>
          <Input id="staffEmail" name="email" type="email" required maxLength={320} autoComplete="off" placeholder="name@university.edu" defaultValue={state?.success ? "" : state?.values?.email} />
        </Field>
        <Field label="Role" htmlFor="staffRole" error={state?.fieldErrors?.role} hint={description}>
          <Select id="staffRole" name="role" value={role} onChange={(e) => setRole(e.target.value as AdminStaffRole)}>
            {roles.map((value) => (
              <option key={value} value={value}>
                {roleLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" loading={pending}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Add to team
        </Button>
        <p className="text-xs text-gray-500">
          {emailsEnabled
            ? "Someone with a confirmed account joins at once. Anyone else gets an invitation email: opening its link confirms the address, then they choose a password and set up two-factor authentication. The invitation stays open for 7 days."
            : "Someone with a confirmed account joins at once. Anyone else is only saved as an invitation: this deployment cannot send email yet, so they join by signing up with that address and confirming it."}
        </p>
      </form>
    </Card>
  );
}
