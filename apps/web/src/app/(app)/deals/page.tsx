import type { Metadata } from "next";
import Link from "next/link";
import { Tag } from "lucide-react";
import { listDeals, listUniversities } from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { FormMessage } from "@/components/ui/field";
import { DealCard } from "@/components/deals/deal-card";

export const metadata: Metadata = { title: "Student deals" };

/** Offers from approved local businesses, for the student's campus (deals that name no campus show everywhere). */
export default async function DealsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const [user, profile, supabase] = await Promise.all([getCurrentUser(), getCurrentProfile(), createClient()]);
  const all = firstParam(params.university) === "all";
  const universityId = all ? null : (profile?.university_id ?? null);
  const [deals, universities] = await Promise.all([listDeals(supabase, { universityId }), listUniversities(supabase).catch(() => [])]);
  const campus = universities.find((u) => u.id === universityId);
  const pill = (active: boolean) => cn("inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold", active ? "bg-brand-600 text-white" : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50");

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{campus ? `Deals near ${campus.name}` : "Student deals"}</h1>
        <p className="text-sm text-gray-600">Offers from local businesses the UniBuzz team approved. Message a business to ask anything.</p>
      </div>
      {profile?.university_id ? (
        <div className="flex gap-2" role="group" aria-label="Campus">
          <Link href="/deals" className={pill(!all)} aria-current={!all ? "page" : undefined}>
            My campus
          </Link>
          <Link href="/deals?university=all" className={pill(all)} aria-current={all ? "page" : undefined}>
            Every campus
          </Link>
        </div>
      ) : null}
      {firstParam(params.error) ? <FormMessage error={firstParam(params.error)} /> : null}
      {deals.length === 0 ? (
        <EmptyState icon={Tag} title="No deals right now" description={all || !universityId ? "Check back soon: local businesses post offers for students here." : "Nothing for your campus yet. Try every campus."} />
      ) : (
        <div className="flex flex-col gap-3" data-testid="deals">
          {deals.map((d) => (
            <DealCard key={d.id} deal={d} signedIn={Boolean(user)} />
          ))}
        </div>
      )}
    </div>
  );
}
