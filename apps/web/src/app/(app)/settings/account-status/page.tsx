import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, ShieldAlert, ShieldCheck } from "lucide-react";
import { listMySanctions, type SanctionNotice } from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { NoticeCard } from "./notice-card";

export const metadata: Metadata = { title: "Account status" };

/** The headline over the notices: the strictest thing in force right now. */
function standingOf(notices: SanctionNotice[]): { tone: "ok" | "warn"; text: string } {
  const now = Date.now();
  const inForce = notices.filter((n) => n.startsAt <= now && (n.until === null || n.until > now));
  const ban = inForce.find((n) => n.kind === "ban");
  if (ban) return { tone: "warn", text: "Your account is permanently banned." };
  const suspension = inForce.find((n) => n.kind === "suspension");
  if (suspension) return { tone: "warn", text: "Your account is suspended. You can read, but you can't post, comment, list or message." };
  const mute = inForce.find((n) => n.kind === "mute");
  if (mute) return { tone: "warn", text: `You're muted${mute.scope === "buzz_only" ? " on Buzz" : mute.scope === "requests" ? " for new message requests" : ""}. You can still read, vote and reply in your chats.` };
  if (notices.some((n) => n.kind === "warning" && n.acknowledgedAt === null && n.until === null)) {
    return { tone: "warn", text: "There's a warning below. Read it and tap Got it before you post again." };
  }
  return { tone: "ok", text: "Your account is in good standing." };
}

/**
 * Account status (UniVerse AccountStatusPage): warnings, mutes, suspensions, bans and removed content on your own
 * account, newest first, quoting your own words back to you (this is the only place that does). Acknowledge a
 * warning, appeal anything else once within 14 days.
 */
export default async function AccountStatusPage() {
  await requireUser("/settings/account-status");
  let notices: SanctionNotice[] | null = null;
  try {
    notices = await listMySanctions(await createClient());
  } catch {
    notices = null;
  }
  const standing = notices ? standingOf(notices) : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4" data-testid="account-status">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Account status</h1>
        <p className="text-sm text-gray-600">Notices from the safety team about your own content and account appear here. Nobody else can see them.</p>
      </div>

      {standing ? (
        <div className={standing.tone === "ok" ? "flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200" : "flex items-center gap-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200"}>
          <span className={standing.tone === "ok" ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-700" : "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800"} aria-hidden>
            {standing.tone === "ok" ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
          </span>
          <p className="text-base font-semibold text-gray-900">{standing.text}</p>
        </div>
      ) : null}

      {notices === null ? (
        <div className="rounded-xl bg-white p-4 text-sm text-red-600 shadow-sm ring-1 ring-gray-200" role="alert">
          Your account status didn&apos;t load. Refresh the page to try again.
        </div>
      ) : notices.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nothing on your record." description="Warnings, removals and restrictions would show up here." />
      ) : (
        <div className="flex flex-col gap-3">
          {notices.map((n) => (
            <NoticeCard key={n.id} notice={n} />
          ))}
        </div>
      )}

      <Link href="/guidelines" className="inline-flex items-center gap-2 self-start rounded-lg px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50">
        <BookOpen className="h-4 w-4" aria-hidden />
        Community Guidelines
      </Link>
    </div>
  );
}
