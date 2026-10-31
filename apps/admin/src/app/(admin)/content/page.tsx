import type { Metadata } from "next";
import Link from "next/link";
import { isMissingFunctionError, listHiddenContent, MODERATION_TARGET_TYPES, type HiddenContentRow, type ModerationTargetType } from "@apartment-book/shared";
import { requireStaff } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam } from "@/lib/utils";
import { FormMessage } from "@/components/ui/field";
import { SetupNotice } from "@/components/ui/setup-notice";
import { ContentLookup } from "@/components/content/content-lookup";
import { HiddenList } from "@/components/content/hidden-list";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Content" };

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireStaff("/content");
  const params = await searchParams;
  const requested = firstParam(params.type);
  const type = (MODERATION_TARGET_TYPES.find((t) => t.value === requested)?.value ?? null) as ModerationTargetType | null;

  let hidden: HiddenContentRow[] = [];
  let needsMigration = false;
  try {
    hidden = await listHiddenContent(await createClient(), { type, limit: 50 });
  } catch (error) {
    if (!isMissingFunctionError(error)) throw error;
    needsMigration = true;
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Content"
        description="Listings, posts, reels, comments, messages and Buzz. Hiding is reversible and the owner keeps seeing their own row with the reason; deleting is permanent and for admins only."
      />
      {firstParam(params.deleted) ? <FormMessage success="The content was deleted permanently. Its files and videos are being removed." /> : null}
      <ContentLookup />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Hidden right now</h2>
          <nav aria-label="Content kind" className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-gray-200/60 p-1">
            <Link href="/content" aria-current={type === null ? "page" : undefined} className={cn("rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap", type === null ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")}>
              All
            </Link>
            {MODERATION_TARGET_TYPES.map((t) => (
              <Link
                key={t.value}
                href={`/content?type=${t.value}`}
                aria-current={type === t.value ? "page" : undefined}
                className={cn("rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap", type === t.value ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
        {needsMigration ? <SetupNotice migration="16" what="The list of hidden content" /> : <HiddenList key={type ?? "all"} initial={hidden} type={type} />}
      </div>
    </div>
  );
}
