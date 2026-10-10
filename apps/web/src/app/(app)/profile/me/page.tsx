import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isProfileTab, profileTabHref } from "@/lib/profile";
import { firstParam } from "@/lib/utils";

/** /profile/me: your own profile (log in first). /profile/me?tab=saved opens that tab. */
export default async function MyProfilePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const tab = firstParam((await searchParams).tab);
  const user = await requireUser(isProfileTab(tab) ? `/profile/me?tab=${tab}` : "/profile/me");
  redirect(isProfileTab(tab) ? profileTabHref(user.id, tab) : `/profile/${user.id}`);
}
