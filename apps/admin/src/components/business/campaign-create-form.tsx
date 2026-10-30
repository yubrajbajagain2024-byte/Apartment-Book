"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { AD_CTAS, AD_OBJECTIVES, AD_PLACEMENTS, zonedInputToMs } from "@apartment-book/shared";
import { createAdForBusinessAction } from "@/lib/console/business-actions";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { ErrorNote } from "./advertiser-actions";

const CT = "America/Chicago";
const field = "flex flex-col gap-1 text-xs font-medium text-gray-600";

/**
 * A draft campaign prepared for an approved business, from what it sent the team. It has no photos of its own: the
 * business adds them in its Ads Manager, or the ad promotes one of its posts or listings. The business is told, and
 * submits it when it agrees: the spend stays its decision.
 */
export function CampaignCreateForm({ businessId, housing, campuses, defaultCampusIds, promotable }: {
  businessId: string;
  housing: boolean;
  campuses: { id: string; name: string }[];
  defaultCampusIds: string[];
  promotable: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [placements, setPlacements] = useState<string[]>(housing ? ["housing"] : ["for_you"]);
  const [campusIds, setCampusIds] = useState<string[]>(defaultCampusIds);
  const [cta, setCta] = useState("learn_more");
  const needsUrl = AD_CTAS.find((c) => c.value === cta)?.needsUrl ?? false;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const text = (k: string) => String(f.get(k) ?? "");
        const startsAt = text("startsAt") ? zonedInputToMs(text("startsAt"), CT) : null;
        const endsAt = text("endsAt") ? zonedInputToMs(text("endsAt"), CT) : null;
        setError(null);
        start(async () => {
          const res = await createAdForBusinessAction({
            businessId,
            name: text("name"),
            objective: text("objective"),
            placements,
            universityIds: campusIds,
            headline: text("headline"),
            caption: text("caption"),
            cta,
            ctaUrl: needsUrl ? text("ctaUrl") : "",
            promoted: text("promoted"),
            budget: text("budget"),
            startsAt,
            endsAt,
            note: text("note"),
          });
          if (!res.ok) setError(res.error);
          else router.push(`/business/campaigns/${res.data.id}`);
        });
      }}
    >
      <ErrorNote error={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>
          Campaign name
          <Input name="name" required minLength={2} maxLength={80} placeholder="Fall welcome week" />
        </label>
        <label className={field}>
          Objective
          <Select name="objective" defaultValue="awareness">
            {AD_OBJECTIVES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs font-medium text-gray-600">Where it runs</legend>
        {housing ? (
          <p className="text-sm text-gray-700">Housing only: this is a housing business (Fair Housing rules; a team member checks it before it runs).</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {AD_PLACEMENTS.filter((p) => p.value !== "housing").map((p) => (
              <label key={p.value} className="flex items-center gap-1.5 text-sm text-gray-800">
                <input type="checkbox" checked={placements.includes(p.value)} onChange={() => setPlacements((l) => toggle(l, p.value))} className="h-4 w-4 accent-brand-600" />
                {p.label}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs font-medium text-gray-600">Campuses (campus is the only targeting)</legend>
        <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg p-2 ring-1 ring-gray-200 sm:grid-cols-2">
          {campuses.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 text-sm text-gray-800">
              <input type="checkbox" checked={campusIds.includes(c.id)} onChange={() => setCampusIds((l) => toggle(l, c.id))} className="h-4 w-4 accent-brand-600" />
              <span className="truncate">{c.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className={field}>
        Headline (optional)
        <Input name="headline" maxLength={80} />
      </label>
      <label className={field}>
        Caption
        <Textarea name="caption" rows={3} maxLength={2200} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>
          Button
          <Select value={cta} onChange={(e) => setCta(e.target.value)}>
            {AD_CTAS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </label>
        {needsUrl ? (
          <label className={field}>
            Button link (https://)
            <Input name="ctaUrl" type="url" pattern="https://.*" maxLength={2000} placeholder="https://" />
          </label>
        ) : null}
      </div>
      <label className={field}>
        Promote one of its posts or listings (optional; its photo then shows)
        <Select name="promoted" defaultValue="">
          <option value="">Nothing</option>
          {promotable.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={field}>
          Budget (USD)
          <Input name="budget" inputMode="decimal" placeholder="250" className="tabular-nums" />
        </label>
        <label className={field}>
          Starts (Central time)
          <Input name="startsAt" type="datetime-local" />
        </label>
        <label className={field}>
          Ends (Central time)
          <Input name="endsAt" type="datetime-local" />
        </label>
      </div>
      <label className={field}>
        Message to the business (optional; the default says the draft is ready to check and submit)
        <Textarea name="note" rows={2} maxLength={1000} />
      </label>
      <Button type="submit" disabled={pending || placements.length === 0 || campusIds.length === 0} className="self-start">
        <FilePlus2 className="h-4 w-4" aria-hidden /> Save the draft and tell the business
      </Button>
    </form>
  );
}
