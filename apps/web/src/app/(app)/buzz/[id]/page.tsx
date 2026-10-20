import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { firstParam } from "@/lib/utils";
import { BuzzThreadScreen } from "@/components/buzz/thread-screen";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Buzz is anonymous: a thread's page title never carries its words (link previews, history, shared screens).
export const metadata: Metadata = { title: "Buzz thread" };

/** A Buzz thread. Everything is loaded in the browser after the guidelines gate, through the buzz_v2_* functions. */
export default async function BuzzThreadPage({ params, searchParams }: Props) {
  const [{ id }, sp, user] = await Promise.all([params, searchParams, getCurrentUser()]);
  if (!UUID.test(id)) notFound();
  // Development only: ?buzzFixtures=… renders the screen from fixtures (components/buzz/fixtures.ts).
  const fixtures = process.env.NODE_ENV !== "production" ? (firstParam(sp.buzzFixtures) ?? null) : null;
  return <BuzzThreadScreen key={id} threadId={id} userId={user?.id ?? null} fixtures={fixtures} />;
}
