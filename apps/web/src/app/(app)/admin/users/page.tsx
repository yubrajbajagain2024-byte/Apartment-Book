import Link from "next/link";
import { Search, UserX } from "lucide-react";
import { fetchUsers, requireStaff, staffMetadata } from "@/lib/staff/server";
import { firstParam } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { buttonClasses } from "@/components/ui/button";
import { EmptyBox, Pill, ROLE_TONE } from "@/components/staff/parts";

export const generateMetadata = () => staffMetadata("Users · Trust & Safety");

const PAGE = 20;

/**
 * Account lookup (UniVerse UsersPage): by name or username, admins also by email. A named account's page never
 * carries Buzz text, and for moderators never an anon-origin sanction, strike or count.
 */
export default async function StaffUsersPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const me = await requireStaff();
  const params = await searchParams;
  const q = (firstParam(params.q) ?? "").trim().slice(0, 80);
  const page = Math.max(0, Math.floor(Number(firstParam(params.page)) || 0));
  const list = q.length >= 2 ? await fetchUsers(q, page * PAGE, PAGE) : null;
  const pageHref = (p: number) => `/admin/users?q=${encodeURIComponent(q)}${p ? `&page=${p}` : ""}`;

  return (
    <div className="flex flex-col gap-3">
      <form method="get" action="/admin/users" role="search" className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
        <Input name="q" defaultValue={q} placeholder={me.role === "admin" ? "Name, username or email" : "Name or username"} aria-label="Search accounts" className="h-11 rounded-full pl-9" autoComplete="off" autoFocus />
      </form>
      {list === null ? (
        <EmptyBox icon={Search} title="Search by name or username." description={`Two characters or more.${me.role === "admin" ? " Admins can also search by email." : ""}`} />
      ) : list.items.length === 0 ? (
        <EmptyBox icon={UserX} title="No accounts match." />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.items.map((u) => (
            <li key={u.user.id}>
              <Link href={`/admin/users/${u.user.id}`} prefetch={false} className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200 hover:ring-gray-300">
                <Avatar name={u.user.fullName} src={u.user.avatarUrl} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-gray-900">{u.user.fullName}</span>
                  <span className="block truncate text-xs text-gray-500">
                    {u.user.username ? `@${u.user.username}` : "no username"}
                    {u.email ? ` · ${u.email}` : ""}
                    {u.user.universityName ? ` · ${u.user.universityName}` : ""}
                  </span>
                </span>
                <span className="flex flex-wrap justify-end gap-1.5">
                  {u.role !== "user" ? <Pill tone={ROLE_TONE[u.role]}>{u.role}</Pill> : null}
                  <Pill variant="outline" tone={u.status === "active" ? "green" : "red"}>
                    {u.status}
                  </Pill>
                  {u.strikePoints ? (
                    <Pill variant="outline" tone="amber">
                      {u.strikePoints} strike pts
                    </Pill>
                  ) : null}
                  {u.openQueueItems ? (
                    <Pill variant="outline" tone="blue">
                      {u.openQueueItems} open
                    </Pill>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list && (page > 0 || list.nextOffset !== null) ? (
        <div className="flex justify-between">
          {page > 0 ? (
            <Link href={pageHref(page - 1)} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          {list.nextOffset !== null ? (
            <Link href={pageHref(page + 1)} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
              Next
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
