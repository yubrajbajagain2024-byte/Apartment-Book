import type { Metadata } from "next";
import { BadgeCheck, Check, Circle, ShieldCheck } from "lucide-react";
import { businessProfileChecklist, standingOf, teamRoleAllows } from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { formatDate } from "@/lib/utils";
import { SettingsTabs } from "@/components/business/section-tabs";
import { BizLink, PageHeader, Panel, PanelHeader, Pill, type Tone } from "@/components/business/ui";

export const metadata: Metadata = { title: "Verification · Settings" };

const STANDING: Record<string, { label: string; tone: Tone; about: string }> = {
  pending: { label: "Waiting for review", tone: "warning", about: "The UniBuzz team reviews every business before students see it. Draft your posts and ads meanwhile." },
  approved: { label: "Approved", tone: "success", about: "Students see your profile, posts and listings, and your approved ads run." },
  rejected: { label: "Not approved", tone: "danger", about: "Update your profile with what the UniBuzz team asked for, then ask them to look again." },
  suspended: { label: "Suspended", tone: "danger", about: "Nothing of your business is shown to students while it is suspended." },
};

/**
 * Verification: the business's review by the UniBuzz team (what it decided and said) and the Verified Partner badge,
 * which the team grants after checking the business. Paying for ads never buys the badge; a complete profile is what
 * the team reads first.
 */
export default async function VerificationPage() {
  const { membership } = await requireBusiness("/settings/verification", ["pending", "approved", "rejected"]);
  const business = membership.business;
  const standing = standingOf(business);
  const s = STANDING[standing];
  const checklist = businessProfileChecklist(business);
  const done = checklist.filter((c) => c.done).length;
  const verified = standing === "approved" && business.verified_partner;
  const canEdit = teamRoleAllows(membership.role, "edit_profile");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <PageHeader title="Verification" subtitle="How the UniBuzz team has reviewed your business, and the Verified Partner badge." />
      <SettingsTabs active="verification" team={standing !== "rejected"} />

      <Panel className="pb-6" data-testid="review">
        <PanelHeader title="Review" subtitle="Every business is reviewed before students see it." action={<Pill tone={s.tone}>{s.label}</Pill>} />
        <div className="flex flex-col gap-3 px-6 pt-4 text-[15px] text-biz-ink-2">
          <p>{s.about}</p>
          {business.reviewed_at ? (
            <p className="text-[13px] text-biz-ink-4" suppressHydrationWarning>
              Last reviewed {formatDate(business.reviewed_at)}
            </p>
          ) : null}
          {business.review_note ? (
            <blockquote className="rounded-2xl bg-biz-surface-3 px-4 py-3 text-[14px] leading-relaxed text-biz-ink-2">
              <span className="block text-[12px] font-medium uppercase tracking-wide text-biz-ink-4">From the UniBuzz team</span>
              {business.review_note}
            </blockquote>
          ) : null}
        </div>
      </Panel>

      <Panel className="pb-6" data-testid="verified-partner">
        <PanelHeader
          title="Verified Partner"
          subtitle="A badge on your profile, posts and listings: the UniBuzz team checked your business is who it says it is."
          action={
            verified ? (
              <Pill tone="accent">
                <BadgeCheck className="h-3.5 w-3.5" /> Verified
              </Pill>
            ) : (
              <Pill>Not yet</Pill>
            )
          }
        />
        <div className="flex flex-col gap-4 px-6 pt-4">
          {verified ? (
            <p className="text-[15px] text-biz-ink-2" suppressHydrationWarning>
              Verified{business.verified_at ? ` on ${formatDate(business.verified_at)}` : ""}. Students see the badge next to your name.
            </p>
          ) : (
            <p className="text-[15px] leading-relaxed text-biz-ink-2">
              The UniBuzz team grants it after checking your business; it is separate from advertising, and paying for ads never buys it.
              {standing === "approved" ? " A complete profile is what they read first." : " It comes after your business is approved."}
            </p>
          )}
          <div>
            <p className="flex items-center gap-2 text-[13px] font-medium text-biz-ink-3">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Your profile: {done} of {checklist.length}
            </p>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2" data-testid="checklist">
              {checklist.map((c) => (
                <li key={c.key} className="flex items-center gap-2 text-[14px]">
                  {c.done ? <Check className="h-4 w-4 shrink-0 text-biz-success" aria-hidden="true" /> : <Circle className="h-4 w-4 shrink-0 text-biz-ink-4" aria-hidden="true" />}
                  <span className={c.done ? "text-biz-ink-2" : "text-biz-ink"}>
                    {c.label}
                    <span className="sr-only">{c.done ? ": done" : ": missing"}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {canEdit && done < checklist.length ? (
            <BizLink href="/profile" variant="secondary" className="self-start">
              Complete the profile
            </BizLink>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
