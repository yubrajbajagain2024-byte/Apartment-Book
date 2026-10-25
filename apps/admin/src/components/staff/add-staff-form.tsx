"use client";

import { useActionState, useState } from "react";
import { UserPlus } from "lucide-react";
import { assignableRoles, STAFF_ROLES, type StaffAccess, type StaffRole } from "@apartment-book/shared";
import { addStaffAction } from "@/lib/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { roleLabel } from "./role-badge";

/** Add someone by email. Admins can only offer the moderator role; owners any role. */
export function AddStaffForm({ me }: { me: StaffAccess }) {
  const [state, action, pending] = useActionState(addStaffAction, null);
  const roles = assignableRoles(me.role);
  const [role, setRole] = useState<StaffRole>(roles[roles.length - 1] ?? "moderator");
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
          <Select id="staffRole" name="role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
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
          People who have not signed up yet are invited and become staff when they sign up and confirm that address. An address outside the university can be invited too; that
          person signs in with Google.
        </p>
      </form>
    </Card>
  );
}
