import { STAFF_ROLES, type StaffRole } from "@apartment-book/shared";
import { Badge } from "@/components/ui/badge";

const TONES: Record<StaffRole, "blue" | "green" | "gray"> = { owner: "blue", admin: "green", moderator: "gray" };

/** "Owner", "Admin" or "Moderator". */
export function roleLabel(role: StaffRole): string {
  return STAFF_ROLES.find((r) => r.value === role)?.label ?? role;
}

/** Role pill: owner indigo, admin green, moderator gray. Works in server and client components. */
export function RoleBadge({ role, className }: { role: StaffRole; className?: string }) {
  return (
    <Badge tone={TONES[role]} className={className}>
      {roleLabel(role)}
    </Badge>
  );
}
