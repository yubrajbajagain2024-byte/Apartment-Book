import type { Metadata } from "next";
import { FollowList, resolveFollowList } from "@/components/profile/follow-list";

export const metadata: Metadata = { title: "Followers" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

/** /profile/[id]/followers: the people following this person, newest first. */
export default async function FollowersPage(props: Props) {
  return <FollowList {...await resolveFollowList(props)} kind="followers" />;
}
