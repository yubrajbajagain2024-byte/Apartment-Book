import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getItem, listUniversities } from "@apartment-book/shared";
import { updateItemAction } from "@/lib/actions/items";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ItemForm } from "@/components/marketplace/item-form";

export const metadata: Metadata = { title: "Edit item" };

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/marketplace/${id}/edit`);
  const supabase = await createClient();
  const [item, universities] = await Promise.all([getItem(supabase, id), listUniversities(supabase)]);
  if (!item) notFound();
  if (item.seller_id !== user.id) redirect(`/marketplace/${id}`);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-bold">Edit item</h1>
      <ItemForm action={updateItemAction.bind(null, id)} universities={universities} userId={user.id} initial={item} />
    </div>
  );
}
