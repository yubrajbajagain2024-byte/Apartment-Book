import { Pencil } from "lucide-react";
import type { Apartment } from "@apartment-book/shared";
import { deleteApartmentAction, setApartmentStatusAction } from "@/lib/actions/apartments";
import { LinkButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/common/confirm-button";

export function ApartmentOwnerActions({ apartment }: { apartment: Apartment }) {
  const nextStatus = apartment.status === "active" ? "rented" : "active";
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Manage your listing</p>
      <LinkButton href={`/apartments/${apartment.id}/edit`} variant="secondary">
        <Pencil className="h-4 w-4" /> Edit listing
      </LinkButton>
      <ConfirmButton variant="outline" action={setApartmentStatusAction.bind(null, apartment.id, nextStatus)}>
        {apartment.status === "active" ? "Mark as rented" : "Mark as available"}
      </ConfirmButton>
      <ConfirmButton
        variant="danger"
        confirmText="Delete this listing? This cannot be undone."
        action={deleteApartmentAction.bind(null, apartment.id)}
      >
        Delete listing
      </ConfirmButton>
    </div>
  );
}
