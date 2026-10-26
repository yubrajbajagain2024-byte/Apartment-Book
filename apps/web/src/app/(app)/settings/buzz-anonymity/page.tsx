import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, ChevronLeft, VenetianMask } from "lucide-react";
import { BUZZ_ANONYMITY_ANCHOR } from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "How Buzz anonymity works" };

/** Settings → How Buzz anonymity works (UniVerse's BuzzAnonymityPage: the anonymity firewall in plain words). */
export default async function BuzzAnonymityPage() {
  await requireUser("/settings/buzz-anonymity");
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5" data-testid="buzz-anonymity">
      <div className="flex flex-col gap-1">
        <Link href="/settings/profile" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Settings
        </Link>
        <h1 className="text-2xl font-bold">How Buzz anonymity works</h1>
      </div>

      <div data-surface="incognito" className="flex items-center gap-3 rounded-2xl border border-incog-accent-line bg-incog-surface-2 p-4">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-incog-accent-soft text-incog-accent-ink">
          <VenetianMask className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <p className="text-base font-semibold leading-snug text-incog-ink">Anonymous to students. Monitored by the developers.</p>
      </div>

      <article className="flex flex-col gap-4 rounded-xl bg-white p-5 text-[15px] leading-relaxed text-gray-700 shadow-sm ring-1 ring-gray-200 [&_h2]:mt-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-gray-900 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5">
        <h2 className="!mt-0">What other students see</h2>
        <p>
          Every buzz and reply shows an alias like “Anon Comet” instead of your profile. The alias is derived from the thread and your account, so it stays the same inside one thread and cannot be matched
          across threads. Nothing in Buzz links to your name, handle, avatar or campus profile.
        </p>
        <h2>Where Buzz never appears</h2>
        <ul>
          <li>Your public profile, Discover and Orbit never show anything you posted in Buzz.</li>
          <li>Buzz notifications never carry a name — only “Someone replied to your buzz”.</li>
          <li>Following or blocking someone has no effect inside Buzz, in either direction.</li>
        </ul>
        <h2>What the developers can see</h2>
        <p>
          Buzz is monitored under the Community Guidelines. Moderators act on content without seeing who wrote it. Only an admin can connect a buzz to an account, only through a written-reason request
          that is recorded in a permanent audit log, and only for serious safety cases such as threats, harassment campaigns or content involving minors.
        </p>
        <h2>What you control</h2>
        <ul>
          <li>Delete any of your buzzes from My buzzes at any time.</li>
          <li>Hide a thread, or mute an alias inside a thread, when you do not want to see it.</li>
          <li>Report anything that breaks the guidelines — reports are reviewed within a day.</li>
        </ul>
      </article>

      <div className="flex flex-col gap-2 sm:flex-row">
        <LinkButton href={`/guidelines#${BUZZ_ANONYMITY_ANCHOR}`} variant="secondary" className="sm:flex-1">
          <BookOpen className="h-4 w-4" aria-hidden="true" /> Read it in the guidelines
        </LinkButton>
        <LinkButton href="/buzz/mine" variant="ghost" className="sm:flex-1">
          <VenetianMask className="h-4 w-4" aria-hidden="true" /> My buzzes
        </LinkButton>
      </div>
    </div>
  );
}
