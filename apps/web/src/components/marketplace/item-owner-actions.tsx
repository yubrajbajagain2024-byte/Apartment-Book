import { Pencil } from "lucide-react";
import type { Item } from "@apartment-book/shared";
import { deleteItemAction, setItemStatusAction } from "@/lib/actions/items";
import { LinkButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/common/confirm-button";

export function ItemOwnerActions({ item }: { item: Item }) {
  const nextStatus = item.status === "available" ? "sold" : "available";
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Manage your item</p>
      <LinkButton href={`/marketplace/${item.id}/edit`} variant="secondary">
        <Pencil className="h-4 w-4" /> Edit item
      </LinkButton>
      <ConfirmButton variant="outline" action={setItemStatusAction.bind(null, item.id, nextStatus)}>
        {item.status === "available" ? "Mark as sold" : "Mark as available"}
      </ConfirmButton>
      <ConfirmButton variant="danger" confirmText="Delete this item? This cannot be undone." action={deleteItemAction.bind(null, item.id)}>
        Delete item
      </ConfirmButton>
    </div>
  );
}
