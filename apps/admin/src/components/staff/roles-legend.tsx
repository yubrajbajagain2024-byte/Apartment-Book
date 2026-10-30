import { STAFF_ROLES } from "@apartment-book/shared";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { RoleBadge } from "./role-badge";

/** What each role may do. The same rules are enforced in SQL; this only explains them. */
export function RolesLegend() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Roles</CardTitle>
      </CardHeader>
      <CardBody>
        <ul className="flex flex-col gap-3">
          {STAFF_ROLES.map((role) => (
            <li key={role.value} className="flex flex-col gap-1">
              <RoleBadge role={role.value} className="self-start" />
              <p className="text-sm text-gray-600">{role.description}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-gray-500">Nobody can change their own role or remove themselves, and the last owner cannot be removed. Only admins and owners delete content permanently.</p>
      </CardBody>
    </Card>
  );
}
