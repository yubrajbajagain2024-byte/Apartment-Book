import type { Metadata } from "next";
import { Plus, ShoppingBag } from "lucide-react";
import {
  getSavedIds,
  listItems,
  listUniversities,
  type ItemCondition,
  type ItemFilters as Filters,
  type ItemSort,
} from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { firstParam, numberParam } from "@/lib/utils";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ItemCard } from "@/components/marketplace/item-card";
import { ItemFilters } from "@/components/marketplace/item-filters";

export const metadata: Metadata = { title: "Marketplace" };

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const [user, profile, supabase] = await Promise.all([getCurrentUser(), getCurrentProfile(), createClient()]);

  const values = {
    q: firstParam(params.q),
    university: firstParam(params.university),
    category: firstParam(params.category),
    condition: firstParam(params.condition),
    minPrice: firstParam(params.minPrice),
    maxPrice: firstParam(params.maxPrice),
    sort: firstParam(params.sort),
    page: firstParam(params.page),
  };
  const universityId = values.university === "all" ? undefined : values.university || profile?.university_id || undefined;

  const filters: Filters = {
    q: values.q,
    universityId,
    category: values.category || undefined,
    condition: values.condition ? (values.condition as ItemCondition) : undefined,
    minPrice: numberParam(params.minPrice),
    maxPrice: numberParam(params.maxPrice),
    sort: (values.sort as ItemSort | undefined) ?? "newest",
    page: numberParam(params.page) ?? 1,
    pageSize: 16,
  };

  const [universities, result, savedIds] = await Promise.all([
    listUniversities(supabase),
    listItems(supabase, filters),
    user ? getSavedIds(supabase, user.id, "item") : Promise.resolve(new Set<string>()),
  ]);
  const activeUniversity = universities.find((u) => u.id === universityId);
  const hasFilters = Object.entries(values).some(([key, value]) => key !== "page" && value !== undefined && value !== "");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{activeUniversity ? `Marketplace at ${activeUniversity.name}` : "Marketplace"}</h1>
          <p className="text-sm text-gray-600">{result.count} {result.count === 1 ? "item" : "items"} · second-hand move-in essentials from students</p>
        </div>
        <LinkButton href="/marketplace/new">
          <Plus className="h-5 w-5" /> Sell something
        </LinkButton>
      </div>

      <ItemFilters universities={universities} values={{ ...values, university: universityId ?? "all" }} hasFilters={hasFilters} />

      {result.data.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="Nothing for sale yet"
          description={universityId ? "Try All universities, or list something you no longer need." : "List something you no longer need."}
          action={
            <div className="flex gap-2">
              {universityId ? (
                <LinkButton href="/marketplace?university=all" variant="secondary">
                  Show all universities
                </LinkButton>
              ) : null}
              <LinkButton href="/marketplace/new">Sell something</LinkButton>
            </div>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {result.data.map((item) => (
            <ItemCard key={item.id} item={item} saved={savedIds.has(item.id)} signedIn={Boolean(user)} />
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} basePath="/marketplace" params={{ ...values, university: universityId ?? (values.university === "all" ? "all" : undefined) }} />
    </div>
  );
}
