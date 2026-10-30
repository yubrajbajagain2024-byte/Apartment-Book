import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { formatDate, getUserDetail, type UserDetail } from "@apartment-book/shared";
import { canModerateUser, requireStaff } from "@/lib/admin";
import { siteUrlFor } from "@/lib/site-links";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, firstParam, isUuid } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Time } from "@/components/common/time";
import { RoleBadge } from "@/components/staff/role-badge";
import { LiftForm, SuspendForm } from "@/components/users/restriction-forms";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "User" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

const COUNTS: { key: keyof UserDetail["counts"]; label: string }[] = [
  { key: "apartments", label: "Apartments" },
  { key: "items", label: "Items" },
  { key: "roommatePosts", label: "Roommate posts" },
  { key: "posts", label: "Posts and reels" },
  { key: "comments", label: "Comments" },
  { key: "reportsFiled", label: "Reports filed" },
  { key: "reportsAgainst", label: "Reports against" },
];

export default async function UserPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const access = await requireStaff(`/users/${id}`);
  const query = await searchParams;
  const reportId = isUuid(firstParam(query.report)) ? firstParam(query.report) : undefined;

  let user: UserDetail;
  try {
    user = await getUserDetail(await createClient(), id);
  } catch (error) {
    if (errorMessage(error, "") === "User not found") notFound();
    throw error;
  }
  const name = user.fullName || user.email || "Unnamed";
  const active = user.activeRestriction;
  const mayModerate = canModerateUser(access, { userId: user.userId, staffRole: user.staffRole });
  const isMe = user.userId === access.userId;
  const profileUrl = siteUrlFor("profile", user.userId);

  return (
    <div className="flex flex-col gap-4">
      <Link href={reportId ? `/reports/${reportId}` : "/users"} className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {reportId ? "Back to the report" : "Users"}
      </Link>
      <PageHeader
        title={name}
        description={[user.email, user.university, user.program].filter(Boolean).join(" · ") || "No details on file."}
        actions={
          profileUrl ? (
            <a href={profileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
              Profile on site
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardBody className="flex items-start gap-4">
              <Avatar name={name} src={user.avatarUrl} size="xl" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold text-gray-900">{name}</span>
                  {isMe ? <span className="text-xs font-medium text-gray-500">(you)</span> : null}
                  {user.staffRole ? <RoleBadge role={user.staffRole} /> : null}
                  {active ? <Badge tone="red">Suspended</Badge> : null}
                </div>
                {user.bio ? <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{user.bio}</p> : null}
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-gray-500">Joined</dt>
                    <dd className="text-gray-900">
                      <Time iso={user.createdAt} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Last seen</dt>
                    <dd className="text-gray-900">
                      <Time iso={user.lastSeenAt} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Sign-in</dt>
                    <dd className="text-gray-900">{user.bannedUntil && new Date(user.bannedUntil) > new Date() ? `blocked until ${formatDate(user.bannedUntil)}` : "allowed"}</dd>
                  </div>
                </dl>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {COUNTS.map((c) => (
                  <div key={c.key} className="rounded-lg bg-gray-50 px-3 py-2 ring-1 ring-gray-200">
                    <dt className="text-xs text-gray-500">{c.label}</dt>
                    <dd className="text-xl font-bold tabular-nums text-gray-900">{user.counts[c.key]}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-gray-500">Buzz is not counted: anonymous threads are only ever tied to a person on the review screen of one thread, and that look is logged.</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Suspension history</CardTitle>
            </CardHeader>
            {user.restrictions.length === 0 ? (
              <p className="px-5 py-6 text-sm text-gray-600">Never suspended.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {user.restrictions.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      {r.active ? <Badge tone="red">Active</Badge> : r.liftedAt ? <Badge tone="gray">Lifted</Badge> : <Badge tone="gray">Expired</Badge>}
                      <span className="text-gray-500">
                        <Time iso={r.createdAt} /> by {r.createdByName || "staff"}
                        {r.expiresAt ? ` · until ${formatDate(r.expiresAt)}` : " · until lifted"}
                      </span>
                    </div>
                    <p className="text-gray-900">“{r.reason}”</p>
                    {r.internalNote ? <p className="text-gray-600">Staff note: {r.internalNote}</p> : null}
                    {r.liftedAt ? (
                      <p className="text-gray-600">
                        Lifted <Time iso={r.liftedAt} /> by {r.liftedByName || "staff"}
                        {r.liftNote ? `: ${r.liftNote}` : ""}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {active ? (
            <Card className="ring-red-200">
              <CardHeader>
                <CardTitle className="text-base text-red-700">Currently suspended</CardTitle>
              </CardHeader>
              <CardBody className="flex flex-col gap-2 text-sm">
                <p className="text-gray-900">“{active.reason}”</p>
                <p className="text-gray-600">
                  Since <Time iso={active.createdAt} /> by {active.createdByName || "staff"} · {active.expiresAt ? `ends ${formatDate(active.expiresAt)}` : "until lifted"}
                </p>
                {active.internalNote ? <p className="text-gray-600">Staff note: {active.internalNote}</p> : null}
              </CardBody>
            </Card>
          ) : null}
          {mayModerate ? (
            active ? (
              <LiftForm userId={user.userId} name={name} />
            ) : (
              <SuspendForm userId={user.userId} name={name} reportId={reportId} />
            )
          ) : (
            <Card>
              <CardBody className="text-sm text-gray-600">
                {isMe ? "You cannot suspend your own account." : "Only a staff member with a higher role than this person can suspend or unsuspend them."}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
