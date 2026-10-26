import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { firstParam } from "@/lib/utils";
import { BuzzSearchScreen } from "@/components/buzz/search-screen";

export const metadata: Metadata = { title: "Search Buzz" };

/** Search Buzz by keyword, on your campus or in Global. */
export default async function BuzzSearchPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [sp, user] = await Promise.all([searchParams, getCurrentUser()]);
  const fixtures = process.env.NODE_ENV !== "production" ? (firstParam(sp.buzzFixtures) ?? null) : null;
  return <BuzzSearchScreen userId={user?.id ?? null} fixtures={fixtures} />;
}
