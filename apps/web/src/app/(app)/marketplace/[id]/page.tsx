import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, School, Tag } from "lucide-react";
import { formatPrice, getItem, isSaved, ITEM_CATEGORIES, ITEM_CONDITIONS, labelFor, photosFor } from "@apartment-book/shared";
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
  const path = `/marketplace/${item.id}`;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/marketplace" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Back to marketplace
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <PhotoHero photos={photosFor(item.images, item.image_meta)} alt={item.title} />
          <Card>
            <CardBody className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="text-2xl font-bold text-gray-900">{item.title}</h1>
                <p className="text-2xl font-bold text-brand-700">{item.price === 0 ? "Free" : formatPrice(item.price, item.currency)}</p>
              </div>
              {item.status !== "available" ? <Badge tone="amber" className="w-fit">This item is {item.status}</Badge> : null}
              <div className="flex flex-wrap gap-2">
                <Badge tone="blue">
                  <Tag className="mr-1 h-3 w-3" /> {labelFor(ITEM_CATEGORIES, item.category)}
                </Badge>
                <Badge>Condition: {labelFor(ITEM_CONDITIONS, item.condition)}</Badge>
                {item.pickup_location ? (
                  <Badge>
                    <MapPin className="mr-1 h-3 w-3" /> {item.pickup_location}
                  </Badge>
                ) : null}
                {item.university ? (
                  <Badge>
                    <School className="mr-1 h-3 w-3" /> {item.university.name}
                  </Badge>
                ) : null}
              </div>
              <div>
                <h2 className="mb-1 font-semibold text-gray-900">Description</h2>
                <p className="whitespace-pre-line text-gray-800">{item.description}</p>
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
                  <p className="truncate font-semibold text-gray-900">{item.seller.full_name}</p>
                  <p className="text-xs text-gray-500">Listed {timeAgo(item.created_at)}</p>
                </div>
              </Link>
              {!isOwner ? (
                <div className="flex flex-col gap-2">
                  <MessageButton userId={item.seller.id} currentUserId={user?.id ?? null} returnTo={path} prefill={`Hi! Is "${item.title}" still available?`} label="Message seller" />
                  <SaveButton targetType="item" targetId={item.id} initialSaved={saved} signedIn={Boolean(user)} />
                </div>
              ) : (
                <ItemOwnerActions item={item} />
              )}
            </CardBody>
          </Card>
          <p className="px-1 text-xs text-gray-500">Meet on campus or in a public place, and check the item before paying.</p>
        </aside>
      </div>
    </div>
  );
}
