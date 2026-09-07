import type { Metadata } from "next";
import { listUniversities } from "@apartment-book/shared";
import { createItemAction } from "@/lib/actions/items";
import { getCurrentProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ItemForm } from "@/components/marketplace/item-form";

export const metadata: Metadata = { title: "Sell an item" };

export default async function NewItemPage() {
  const user = await requireUser("/marketplace/new");
  const [profile, universities] = await Promise.all([getCurrentProfile(), listUniversities(await createClient())]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Sell an item</h1>
        <p className="text-sm text-gray-600">Mattresses, desks, kitchen gear, textbooks: anything another student could use.</p>
      </div>
      <ItemForm action={createItemAction} universities={universities} userId={user.id} defaultUniversityId={profile?.university_id} />
    </div>
  );
}
