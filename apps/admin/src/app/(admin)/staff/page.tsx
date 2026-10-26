import type { Metadata } from "next";
import { listStaff, listStaffInvites } from "@apartment-book/shared";
import { hasRole, requireStaff } from "@/lib/admin";
import { invitationEmailsConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { AddStaffForm } from "@/components/staff/add-staff-form";
import { InvitesList } from "@/components/staff/invites-list";
import { RolesLegend } from "@/components/staff/roles-legend";
import { StaffTable } from "@/components/staff/staff-table";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const access = await requireStaff("/staff");
  const supabase = await createClient();
  // Pending invites are admin-only in SQL (admin_invites_list raises "Not allowed" for moderators).
  const canManage = hasRole(access, "admin");
  const [members, invites] = await Promise.all([listStaff(supabase), canManage ? listStaffInvites(supabase) : []]);
  const emailsEnabled = invitationEmailsConfigured();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Staff" description="Who can open this app and what each person may do. Every change is re-checked in the database and written to the audit log." />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <StaffTable members={members} me={access} emailsEnabled={emailsEnabled} />
          {canManage ? <InvitesList invites={invites} me={access} emailsEnabled={emailsEnabled} /> : null}
        </div>
        <div className="flex flex-col gap-4">
          {canManage ? <AddStaffForm me={access} emailsEnabled={emailsEnabled} /> : null}
          <RolesLegend />
        </div>
      </div>
    </div>
  );
}
