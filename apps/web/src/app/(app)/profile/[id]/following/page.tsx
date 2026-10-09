import type { Metadata } from "next";
import { FollowList, resolveFollowList } from "@/components/profile/follow-list";

export const metadata: Metadata = { title: "Following" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

/** /profile/[id]/following: the people this person follows, newest first. */
export default async function FollowingPage(props: Props) {
  return <FollowList {...await resolveFollowList(props)} kind="following" />;
}
