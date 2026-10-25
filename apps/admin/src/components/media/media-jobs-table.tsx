"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Film } from "lucide-react";
import { MEDIA_JOB_KINDS, MODERATION_TARGET_TYPE_VALUES, type MediaJob } from "@apartment-book/shared";
import { retryMediaJobAction } from "@/lib/actions/media";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormMessage } from "@/components/ui/field";
import { ConfirmButton } from "@/components/common/confirm-button";
import { Time } from "@/components/common/time";

function kindLabel(kind: string): string {
  return MEDIA_JOB_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

function targetHref(job: MediaJob): string | null {
  if (!job.targetType || !job.targetId) return null;
  if ((MODERATION_TARGET_TYPE_VALUES as readonly string[]).includes(job.targetType)) return `/content/${job.targetType}/${job.targetId}`;
  if (job.targetType === "profile") return `/users/${job.targetId}`;
  return null;
}

/** The clean-up queue. Pending jobs can be retried at once; finished ones are history. */
export function MediaJobsTable({ jobs }: { jobs: MediaJob[] }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<number, string | undefined>>({});

  if (jobs.length === 0) return <EmptyState icon={Film} title="Queue is empty" description="Hiding, restoring or deleting content with photos or videos adds jobs here." />;

  return (
    <Card>
      <ul className="divide-y divide-gray-100">
        {jobs.map((job) => {
          const pending = !job.doneAt;
          const failing = pending && job.attempts >= 3;
          const href = targetHref(job);
          return (
            <li key={job.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-gray-500">#{job.id}</span>
                  <span className="text-sm font-semibold text-gray-900">{kindLabel(job.kind)}</span>
                  {!pending ? (
                    <Badge tone={job.lastError === "superseded" ? "gray" : "green"}>{job.lastError === "superseded" ? "Superseded" : "Done"}</Badge>
                  ) : failing ? (
                    <Badge tone="red">Failing</Badge>
                  ) : job.attempts > 0 ? (
                    <Badge tone="amber">Retrying</Badge>
                  ) : (
                    <Badge tone="blue">Pending</Badge>
                  )}
                </div>
                <p className="truncate font-mono text-xs text-gray-600" title={job.ref}>
                  {job.ref}
                </p>
                <p className="text-xs text-gray-500">
                  {job.attempts} {job.attempts === 1 ? "attempt" : "attempts"} · queued <Time iso={job.createdAt} />
                  {pending ? (
                    <>
                      {" "}
                      · next try <Time iso={job.nextAttemptAt} />
                    </>
                  ) : (
                    <>
                      {" "}
                      · finished <Time iso={job.doneAt} />
                    </>
                  )}
                  {href ? (
                    <>
                      {" "}
                      ·{" "}
                      <Link href={href} className="font-medium text-brand-600 hover:underline">
                        {job.targetType}
                      </Link>
                    </>
                  ) : null}
                </p>
                {pending && job.lastError ? <p className="mt-1 break-words text-xs text-red-700">{job.lastError}</p> : null}
                {errors[job.id] ? (
                  <div className="mt-2">
                    <FormMessage error={errors[job.id]} />
                  </div>
                ) : null}
              </div>
              {pending ? (
                <ConfirmButton
                  variant="outline"
                  size="sm"
                  action={async () => {
                    const result = await retryMediaJobAction(job.id);
                    setErrors((cur) => ({ ...cur, [job.id]: result.error }));
                    if (!result.error) router.refresh();
                  }}
                >
                  Retry now
                </ConfirmButton>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
