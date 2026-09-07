import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

export default async function MyProfilePage() {
  const user = await requireUser("/profile/me");
  redirect(`/profile/${user.id}`);
}
