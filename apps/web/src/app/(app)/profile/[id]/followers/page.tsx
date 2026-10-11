import type { Metadata } from "next";
import { FollowList, followListTitle, resolveFollowList } from "@/components/profile/follow-list";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: await followListTitle(params, "followers") };
}

/** /profile/[id]/followers: the people following this person, newest first, for them alone; anyone else gets the friends they have in common. */
export default async function FollowersPage(props: Props) {
  return <FollowList {...await resolveFollowList(props)} kind="followers" />;
}
