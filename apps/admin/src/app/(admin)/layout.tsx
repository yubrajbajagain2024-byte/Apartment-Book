import { requireStaff } from "@/lib/admin";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { AdminShell } from "@/components/shell/admin-shell";

/**
 * Everything inside this group is staff only. Signed-out visitors go to login and
 * people who are not staff to /no-access, without ever seeing the shell. The second
 * factor is not required for the shell itself so staff can reach /security to set it
 * up; every page and action checks it on its own (layouts do not re-run on navigation).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await requireStaff("/", { mfa: false });
  const [user, profile] = await Promise.all([getCurrentUser(), getCurrentProfile()]);
  const name = profile?.full_name || user?.email?.split("@")[0] || "You";
  return (
    <AdminShell access={access} name={name} email={user?.email ?? null} avatarUrl={profile?.avatar_url ?? null}>
      {children}
    </AdminShell>
  );
}
