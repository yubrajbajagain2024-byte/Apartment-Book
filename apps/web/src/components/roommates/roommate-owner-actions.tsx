import { Pencil } from "lucide-react";
import type { RoommatePost } from "@apartment-book/shared";
import { deleteRoommatePostAction, setRoommatePostActiveAction } from "@/lib/actions/roommates";
import { LinkButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/common/confirm-button";

export function RoommateOwnerActions({ post }: { post: RoommatePost }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Manage your post</p>
      <LinkButton href={`/roommates/${post.id}/edit`} variant="secondary">
        <Pencil className="h-4 w-4" /> Edit post
      </LinkButton>
      <ConfirmButton variant="outline" action={setRoommatePostActiveAction.bind(null, post.id, !post.is_active)}>
        {post.is_active ? "Mark as found" : "Reactivate post"}
      </ConfirmButton>
      <ConfirmButton variant="danger" confirmText="Delete this post? This cannot be undone." action={deleteRoommatePostAction.bind(null, post.id)}>
        Delete post
      </ConfirmButton>
    </div>
  );
}
