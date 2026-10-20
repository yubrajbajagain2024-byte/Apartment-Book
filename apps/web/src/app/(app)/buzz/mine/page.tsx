import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { firstParam } from "@/lib/utils";
import { BuzzMineScreen } from "@/components/buzz/mine-screen";

export const metadata: Metadata = { title: "My buzzes" };

/** My buzzes: your own threads and replies with your private karma. Linked from Settings, never from Home. */
export default async function MyBuzzesPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [sp, user] = await Promise.all([searchParams, getCurrentUser()]);
  const fixtures = process.env.NODE_ENV !== "production" ? (firstParam(sp.buzzFixtures) ?? null) : null;
  return <BuzzMineScreen userId={user?.id ?? null} fixtures={fixtures} />;
}
