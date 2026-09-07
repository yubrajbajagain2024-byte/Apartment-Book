import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getApartment, listUniversities } from "@apartment-book/shared";
import { updateApartmentAction } from "@/lib/actions/apartments";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ApartmentForm } from "@/components/apartments/apartment-form";

export const metadata: Metadata = { title: "Edit apartment" };

export default async function EditApartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/apartments/${id}/edit`);
  const supabase = await createClient();
  const [apartment, universities] = await Promise.all([getApartment(supabase, id), listUniversities(supabase)]);
  if (!apartment) notFound();
  if (apartment.owner_id !== user.id) redirect(`/apartments/${id}`);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-bold">Edit listing</h1>
      <ApartmentForm action={updateApartmentAction.bind(null, id)} universities={universities} userId={user.id} initial={apartment} />
    </div>
  );
}
