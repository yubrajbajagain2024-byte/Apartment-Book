import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { isMissingFunctionError, listRestrictions, listUsers, searchUsers, type AdminUserRow, type UsersFilter } from "@apartment-book/shared";
import { requireStaff } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SetupNotice } from "@/components/ui/setup-notice";
import { UsersList } from "@/components/users/users-list";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Users" };

const FILTERS: { value: UsersFilter; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "suspended", label: "Suspended" },
  { value: "staff", label: "Staff" },
];

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireStaff("/users");
  const params = await searchParams;
  const q = (firstParam(params.q) ?? "").trim();
  const filter = FILTERS.find((f) => f.value === firstParam(params.filter))?.value ?? "all";
  const supabase = await createClient();

  let rows: AdminUserRow[] = [];
  let needsMigration = false;
  if (q) {
    rows = (await searchUsers(supabase, q, 50)).map((u) => ({ ...u, lastSeenAt: null }));
  } else {
    try {
      rows = await listUsers(supabase, { filter, limit: 50 });
    } catch (error) {
      if (!isMissingFunctionError(error)) throw error;
      needsMigration = true;
      // Older database: at least the suspended people are listable through migration 15.
      rows = (await listRestrictions(supabase, { activeOnly: true, limit: 200 })).map((r) => ({
        userId: r.userId,
        fullName: r.fullName,
        email: r.email,
        avatarUrl: null,
        universityName: null,
        createdAt: r.createdAt,
        lastSeenAt: null,
        suspended: true,
        staffRole: null,
      }));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Users" description="Find a person, see what they posted and were reported for, and suspend or unsuspend their account. Suspensions apply to the website and the app at once." />
      <form action="/users" className="flex gap-2">
        <Input name="q" defaultValue={q} placeholder="Search by name or email" aria-label="Search people" className="max-w-md" />
        <Button type="submit" variant="secondary">
          <Search className="h-4 w-4" aria-hidden="true" />
          Search
        </Button>
        {q ? (
          <Link href="/users" className="self-center text-sm font-medium text-gray-600 hover:underline">
            Clear
          </Link>
        ) : null}
      </form>
      {q ? (
        <UsersList key={`q:${q}`} initial={rows} filter="all" pageable={false} emptyTitle={`Nobody matches “${q}”`} emptyDescription="Try part of the name or the exact email address." />
      ) : (
        <>
          <nav aria-label="People filter" className="flex gap-1 self-start rounded-lg bg-gray-200/60 p-1">
            {FILTERS.map((f) => (
              <Link
                key={f.value}
                href={f.value === "all" ? "/users" : `/users?filter=${f.value}`}
                aria-current={f.value === filter ? "page" : undefined}
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium", f.value === filter ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")}
              >
                {f.label}
              </Link>
            ))}
          </nav>
          {needsMigration ? <SetupNotice migration="16" what="Browsing everyone (search and the suspended list still work)" /> : null}
          <UsersList
            key={filter}
            initial={rows}
            filter={filter}
            pageable={!needsMigration}
            emptyTitle={filter === "suspended" ? "No suspended accounts" : filter === "staff" ? "No staff" : "No people yet"}
            emptyDescription={filter === "suspended" ? "Suspend someone from their account page; they show up here while it lasts." : "People appear here as they sign up."}
          />
        </>
      )}
    </div>
  );
}
