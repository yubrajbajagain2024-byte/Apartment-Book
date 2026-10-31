"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";
import { listUsers, type AdminUserRow, type UsersFilter } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormMessage } from "@/components/ui/field";
import { Time } from "@/components/common/time";
import { RoleBadge } from "@/components/staff/role-badge";

const PAGE = 50;

export function UserRow({ user }: { user: AdminUserRow }) {
  return (
    <li>
      <Link href={`/users/${user.userId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 sm:px-5">
        <Avatar name={user.fullName} src={user.avatarUrl} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-semibold text-gray-900">{user.fullName || "Unnamed"}</span>
            {user.staffRole ? <RoleBadge role={user.staffRole} /> : null}
            {user.suspended ? <Badge tone="red">Suspended</Badge> : null}
          </div>
          <p className="truncate text-sm text-gray-600">{[user.email, user.universityName].filter(Boolean).join(" · ")}</p>
          <p className="text-xs text-gray-500">
            joined <Time iso={user.createdAt} />
            {user.lastSeenAt ? (
              <>
                {" "}
                · last seen <Time iso={user.lastSeenAt} />
              </>
            ) : null}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
      </Link>
    </li>
  );
}

/** People, newest first, with "Load older" paging (browsing) or a fixed set (search results). */
export function UsersList({ initial, filter, pageable, emptyTitle, emptyDescription }: { initial: AdminUserRow[]; filter: UsersFilter; pageable: boolean; emptyTitle: string; emptyDescription: string }) {
  const [items, setItems] = useState(initial);
  const [done, setDone] = useState(!pageable || initial.length < PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last || loading) return;
    setLoading(true);
    setError(null);
    try {
      const older = await listUsers(createClient(), { filter, limit: PAGE, before: last.createdAt });
      setItems((cur) => [...cur, ...older.filter((o) => !cur.some((c) => c.userId === o.userId))]);
      setDone(older.length < PAGE);
    } catch (e) {
      setError(`Could not load more people. ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) return <EmptyState icon={Users} title={emptyTitle} description={emptyDescription} />;

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <ul className="divide-y divide-gray-100">
          {items.map((user) => (
            <UserRow key={user.userId} user={user} />
          ))}
        </ul>
      </Card>
      <FormMessage error={error} />
      {!done ? (
        <Button variant="outline" onClick={loadMore} loading={loading} className="self-center">
          Load older
        </Button>
      ) : null}
    </div>
  );
}
