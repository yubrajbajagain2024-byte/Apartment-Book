import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { formatPrice, getItem, getListingStats, isSaved, ITEM_CATEGORIES, ITEM_CONDITIONS, labelFor, photosFor } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { PhotoHero } from "@/components/photos/photo-hero";
import { MessageButton } from "@/components/common/message-button";
import { SaveButton } from "@/components/common/save-button";
import { ItemOwnerActions } from "@/components/marketplace/item-owner-actions";
import { ListingStatsPanel } from "@/components/stats/listing-stats-panel";
import { ViewTracker } from "@/components/stats/view-tracker";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const item = await getItem(await createClient(), id).catch(() => null);
  if (!item) return { title: "Item not found" };
  return { title: item.title, description: item.description.slice(0, 160), openGraph: { images: item.images.slice(0, 1) } };
}

export default async function ItemPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const [item, user] = await Promise.all([getItem(supabase, id), getCurrentUser()]);
  if (!item) notFound();

  const saved = user ? await isSaved(supabase, user.id, "item", item.id) : false;
  const isOwner = user?.id === item.seller_id;
  const stats = isOwner ? await getListingStats(supabase, "item", item.id).catch(() => null) : null;
  const path = `/marketplace/${item.id}`;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/marketplace" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> Back to marketplace
      </Link>

      <ViewTracker targetType="item" targetId={item.id} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <PhotoHero photos={photosFor(item.images, item.image_meta)} alt={item.title} />
          <Card>
            <CardBody className="flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6">
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <h1 className="min-w-0 flex-1 font-display text-2xl tracking-tight text-gray-900 sm:text-3xl">{item.title}</h1>
                <p className="font-display text-2xl tracking-tight text-gray-900 sm:text-3xl">{item.price === 0 ? "Free" : formatPrice(item.price, item.currency)}</p>
              </div>
              {item.status !== "available" ? <Badge tone="amber" className="w-fit">This item is {item.status}</Badge> : null}
              {/* The facts as a hairline grid: the gap shows the line colour between the white cells. */}
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] bg-gray-200 ring-1 ring-gray-200 sm:grid-cols-4">
                {[
                  { label: "Category", value: labelFor(ITEM_CATEGORIES, item.category) },
                  { label: "Condition", value: labelFor(ITEM_CONDITIONS, item.condition) },
                  item.pickup_location ? { label: "Pickup", value: item.pickup_location } : null,
                  item.university ? { label: "Campus", value: item.university.name } : null,
                ]
                  .filter((f): f is { label: string; value: string } => f !== null)
                  .map((f) => (
                    <div key={f.label} className="min-w-0 bg-white px-3.5 py-3">
                      <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">{f.label}</dt>
                      <dd className="mt-1 truncate text-sm font-medium text-gray-900" title={f.value}>
                        {f.value}
                      </dd>
                    </div>
                  ))}
              </dl>
              <div className="border-t border-gray-100 pt-5">
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Description</h2>
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-gray-800">{item.description}</p>
              </div>
            </CardBody>
          </Card>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardBody className="flex flex-col gap-4">
              <Link href={`/profile/${item.seller.id}`} className="flex items-center gap-3">
                <Avatar name={item.seller.full_name} src={item.seller.avatar_url} size="lg" />
                <div className="min-w-0">
                  <p className="truncate font-display text-lg leading-tight tracking-tight text-gray-900">{item.seller.full_name}</p>
                  <p className="mt-0.5 text-xs text-gray-500">Listed {timeAgo(item.created_at)}</p>
                </div>
              </Link>
              {!isOwner ? (
                <div className="flex flex-col gap-2">
                  <MessageButton userId={item.seller.id} currentUserId={user?.id ?? null} returnTo={path} prefill={`Hi! Is "${item.title}" still available?`} label="Message seller" target={{ type: "item", id: item.id }} />
                  <SaveButton targetType="item" targetId={item.id} initialSaved={saved} signedIn={Boolean(user)} />
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {stats ? <ListingStatsPanel stats={stats} /> : null}
                  <ItemOwnerActions item={item} />
                </div>
              )}
            </CardBody>
          </Card>
          <p className="px-1 text-xs leading-relaxed text-gray-500">Meet on campus or in a public place, and check the item before paying.</p>
        </aside>
      </div>
    </div>
  );
}
