"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import {
  AD_CAPTION_MAX,
  AD_CTAS,
  AD_HEADLINE_MAX,
  AD_OBJECTIVES,
  AD_PLACEMENTS,
  AD_REELS_MAX_SECONDS,
  checkFairHousing,
  mediaItems,
  type Ad,
  type AdPlacement,
  type BusinessMediaItem,
} from "@apartment-book/shared";
import type { FormState } from "@/lib/actions/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AdPreview, type PreviewAd } from "./ad-preview";
import { MediaField } from "./media-field";
import { PortalLink } from "./portal-base";
import { bizButton, bizField, Notice, Panel } from "./ui";

export type PromotableItem = { value: string; label: string; image: string | null; price?: string | null };

/** yyyy-mm-ddThh:mm in the browser's own time, for a datetime-local input. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The browser's local time from a datetime-local input, as an ISO timestamp the server stores exactly. */
function toIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

type Snapshot = {
  placements: string[];
  headline: string;
  caption: string;
  cta: string;
  promoted: string;
  media: BusinessMediaItem[];
};

/** What the form says right now, the uploaders' hidden inputs included (they change without an input event). */
function readSnapshot(form: HTMLFormElement): Snapshot {
  const data = new FormData(form);
  const json = (v: FormDataEntryValue) => {
    try {
      return JSON.parse(String(v)) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  let media: BusinessMediaItem[] = [];
  if (data.get("mediaMode") === "video") {
    const v = data.getAll("mediaVideo").map(json).find(Boolean);
    if (v && typeof v.media_id === "string") media = mediaItems([{ type: "video", ...v }]);
  } else {
    media = data
      .getAll("mediaPhotoMeta")
      .map(json)
      .flatMap((p) => (p && typeof p.url === "string" ? [{ type: "image" as const, url: p.url }] : []));
  }
  return {
    placements: data.getAll("placements").map(String),
    headline: String(data.get("headline") ?? ""),
    caption: String(data.get("caption") ?? ""),
    cta: String(data.get("cta") ?? "learn_more"),
    promoted: String(data.get("promoted") ?? ""),
    media,
  };
}

function Section({ step, title, subtitle, children }: { step: number; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Panel className="p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-biz-ink text-[13px] font-semibold text-biz-surface">{step}</span>
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-biz-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[13px] leading-relaxed text-biz-ink-3">{subtitle}</p> : null}
        </div>
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </Panel>
  );
}

function Label({ htmlFor, children, hint, error }: { htmlFor?: string; children: React.ReactNode; hint?: React.ReactNode; error?: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-biz-ink-2">
        {children}
      </label>
      {error?.[0] ? <p className="order-last text-[13px] text-biz-danger">{error[0]}</p> : hint ? <p className="order-last text-[13px] text-biz-ink-4">{hint}</p> : null}
    </div>
  );
}

/**
 * The Ads Manager's editor: the campaign, the campuses (campus is the only targeting), where it runs, the creative, the
 * budget and dates, with a live preview of what students will see. It saves a draft; the ad's page says what still
 * stops it from being submitted and submits it. Housing businesses (and ads promoting a listing) run in Housing only,
 * and their words are checked against the Fair Housing rules as they are typed.
 */
export function AdEditor({
  action,
  userId,
  business,
  universities,
  defaultUniversityIds,
  promotable,
  initial,
  cancelHref,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  userId: string;
  business: { name: string; logoUrl: string | null; verified: boolean; category: string };
  universities: { id: string; name: string; featured: boolean }[];
  defaultUniversityIds: string[];
  promotable: PromotableItem[];
  initial?: Ad;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values;
  const err = state?.fieldErrors;
  const formRef = useRef<HTMLFormElement>(null);
  const initialMedia = mediaItems(initial?.media);
  const [snap, setSnap] = useState<Snapshot>(() => ({
    placements: initial?.placements ?? ["for_you"],
    headline: initial?.headline ?? "",
    caption: initial?.caption ?? "",
    cta: initial?.cta ?? "learn_more",
    promoted: initial?.promoted_deal_id ? `deal:${initial.promoted_deal_id}` : initial?.promoted_apartment_id ? `apartment:${initial.promoted_apartment_id}` : "",
    media: initialMedia,
  }));
  const refresh = useCallback(() => {
    if (formRef.current) setSnap(readSnapshot(formRef.current));
  }, []);
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    // The uploaders add and remove hidden inputs as files finish; watch for that as well as typing.
    const observer = new MutationObserver(refresh);
    observer.observe(form, { childList: true, subtree: true, attributes: true, attributeFilter: ["value"] });
    return () => observer.disconnect();
  }, [refresh]);

  const housing = business.category === "housing" || snap.promoted.startsWith("apartment:");
  const placementOptions = AD_PLACEMENTS.filter((p) => (housing ? p.value === "housing" : p.value !== "housing"));
  const chosen: AdPlacement[] = housing ? ["housing"] : (snap.placements.filter((p) => p === "for_you" || p === "reels") as AdPlacement[]);
  const [previewOn, setPreviewOn] = useState<AdPlacement | null>(null);
  const preview: AdPlacement = previewOn && chosen.includes(previewOn) ? previewOn : (chosen[0] ?? (housing ? "housing" : "for_you"));

  // Dates: shown in the browser's time, sent as exact timestamps.
  const defaultStart = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  })();
  const [starts, setStarts] = useState(() => toLocalInput(v?.startsAt || initial?.starts_at || defaultStart));
  const [ends, setEnds] = useState(() => toLocalInput(v?.endsAt || initial?.ends_at || new Date(new Date(defaultStart).getTime() + 7 * 86_400_000).toISOString()));

  // Fair Housing, as the business types (housing only; the reviewer sees the same flags).
  const [flags, setFlags] = useState<string[]>(initial?.fair_housing_flags ?? []);
  useEffect(() => {
    if (!housing) return;
    const text = `${snap.headline} ${snap.caption}`;
    const timer = setTimeout(() => {
      checkFairHousing(createClient(), text)
        .then(setFlags)
        .catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [housing, snap.headline, snap.caption]);

  const selected = new Set(v ? (v.universityIds ?? "").split(",").filter(Boolean) : (initial?.university_ids ?? defaultUniversityIds));
  const promotedItem = promotable.find((p) => p.value === snap.promoted) ?? null;
  const cta = AD_CTAS.find((c) => c.value === snap.cta) ?? AD_CTAS[0];
  const needsUrl = cta.needsUrl || (cta.value === "get_offer" && !snap.promoted.startsWith("deal:"));
  const previewAd: PreviewAd = {
    businessName: business.name,
    logoUrl: business.logoUrl,
    verified: business.verified,
    headline: snap.headline || null,
    caption: snap.caption,
    cta: snap.cta,
    media: snap.media,
    promoted: promotedItem ? { title: promotedItem.label, image: promotedItem.image, price: promotedItem.price ?? null } : null,
  };
  const def = (key: string, fallback: string | null | undefined) => v?.[key] ?? fallback ?? "";

  return (
    <form ref={formRef} action={formAction} onInput={refresh} onChange={refresh} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-6">
        {state?.error ? <Notice tone="danger" title={state.error} /> : null}

        <Section step={1} title="Campaign" subtitle="What you want students to do. It shapes how your results read; it never changes who sees the ad.">
          <Label htmlFor="name" hint="Only your team sees this name." error={err?.name}>
            Ad name
          </Label>
          <input id="name" name="name" required maxLength={80} defaultValue={def("name", initial?.name)} placeholder="Fall latte week" className={cn(bizField, "-mt-3 h-11")} />
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-biz-ink-2">Objective</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {AD_OBJECTIVES.map((o) => (
                <label key={o.value} className="group relative flex cursor-pointer flex-col gap-0.5 rounded-2xl bg-biz-surface-3 p-4 ring-1 ring-inset ring-transparent transition-[box-shadow,background-color] has-[:checked]:bg-biz-accent-soft has-[:checked]:ring-2 has-[:checked]:ring-biz-accent">
                  <input type="radio" name="objective" value={o.value} defaultChecked={def("objective", initial?.objective ?? "awareness") === o.value} className="sr-only" />
                  <span className="text-[15px] font-semibold text-biz-ink">{o.label}</span>
                  <span className="text-[13px] leading-snug text-biz-ink-3">{o.description}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </Section>

        <Section step={2} title="Campuses" subtitle="Students at the campuses you choose see the ad. That is the only targeting: UniBuzz never targets anyone by age, gender, interests or what they did.">
          <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto rounded-2xl bg-biz-surface-3 p-2 sm:grid-cols-2" data-testid="ad-campuses">
            {universities.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-biz-ink-2 transition-colors hover:bg-biz-surface has-[:checked]:bg-biz-surface has-[:checked]:font-medium has-[:checked]:text-biz-ink">
                <input type="checkbox" name="universityIds" value={u.id} defaultChecked={selected.has(u.id)} className="h-4 w-4 rounded accent-[var(--biz-accent)]" />
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                {u.featured ? <span className="text-[11px] text-biz-ink-4">Open now</span> : null}
              </label>
            ))}
          </div>
          {err?.universityIds ? <p className="-mt-3 text-[13px] text-biz-danger">{err.universityIds[0]}</p> : null}
        </Section>

        <Section step={3} title="Placement" subtitle={housing ? undefined : "Where in the app students meet your ad. Every ad is labelled Sponsored, and appears at most once every nine posts."}>
          {housing ? (
            <>
              <input type="hidden" name="placements" value="housing" />
              <Notice tone="accent" title="Housing ads run in Explore › Housing only">
                Ads from housing businesses, and ads promoting a listing, appear between listings in Housing and nowhere else. They are checked against the Fair Housing Act before they run.
              </Notice>
            </>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {placementOptions.map((p) => (
                <label key={p.value} className="flex cursor-pointer items-start gap-3 rounded-2xl bg-biz-surface-3 p-4 ring-1 ring-inset ring-transparent transition-[box-shadow,background-color] has-[:checked]:bg-biz-accent-soft has-[:checked]:ring-2 has-[:checked]:ring-biz-accent">
                  <input type="checkbox" name="placements" value={p.value} defaultChecked={(v ? (v.placements ?? "").split(",") : (initial?.placements ?? ["for_you"])).includes(p.value)} className="mt-0.5 h-4 w-4 rounded accent-[var(--biz-accent)]" />
                  <span>
                    <span className="block text-[15px] font-semibold text-biz-ink">{p.label}</span>
                    <span className="block text-[13px] leading-snug text-biz-ink-3">{p.description}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </Section>

        <Section step={4} title="Creative" subtitle="Look like a post, not a billboard: a real photo, a short caption, one clear button.">
          {promotable.length ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="promoted" hint={housing ? "A listing's photos and rent stand in when you add no media of your own." : "Its photos stand in when you add no media of your own."}>
                Promote one of your posts or listings (optional)
              </Label>
              <select id="promoted" name="promoted" defaultValue={snap.promoted} className={cn(bizField, "h-11")}>
                <option value="">Nothing: this ad stands on its own</option>
                {promotable.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="headline" hint={`Optional, ${AD_HEADLINE_MAX} characters at most.`} error={err?.headline}>
              Headline
            </Label>
            <input id="headline" name="headline" maxLength={AD_HEADLINE_MAX} defaultValue={def("headline", initial?.headline)} placeholder="Half-price lattes, all week" className={cn(bizField, "h-11")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="caption" error={err?.caption} hint={`${snap.caption.length} / ${AD_CAPTION_MAX}`}>
              Caption
            </Label>
            <textarea id="caption" name="caption" rows={4} maxLength={AD_CAPTION_MAX} defaultValue={def("caption", initial?.caption)} placeholder="Show your student ID at the counter. Monday to Friday, 7 to 11." className={cn(bizField, "resize-y py-3 leading-relaxed")} />
          </div>
          {housing && flags.length ? (
            <Notice tone="warning" title="These words may break the Fair Housing Act">
              <ul className="mt-1 list-disc pl-5">
                {flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="mt-1">Describe the home, not who should live there. The UniBuzz team reviews every housing ad and rejects discriminatory wording.</p>
            </Notice>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-biz-ink-2">Photos or video</span>
            <MediaField userId={userId} initial={initialMedia} videoHint={`For Reels: vertical (taller than wide), ${AD_REELS_MAX_SECONDS} seconds at most.`} />
          </div>
          <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cta" error={err?.cta}>
                Button
              </Label>
              <select id="cta" name="cta" defaultValue={def("cta", initial?.cta ?? "learn_more")} className={cn(bizField, "h-11")}>
                {AD_CTAS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={cn("flex flex-col gap-1.5 transition-opacity", needsUrl ? "opacity-100" : "opacity-50")}>
              <Label htmlFor="ctaUrl" error={err?.ctaUrl} hint={needsUrl ? "Where the button opens." : cta.value === "message" ? "Students write first; you reply from your inbox." : "Not needed for this button."}>
                Link
              </Label>
              <input id="ctaUrl" name="ctaUrl" type="url" inputMode="url" defaultValue={def("ctaUrl", initial?.cta_url)} placeholder="https://" className={cn(bizField, "h-11")} />
            </div>
          </div>
        </Section>

        <Section step={5} title="Budget and dates" subtitle="Your ad starts on its start date once the UniBuzz team approves it and its payment is recorded, and stops by itself on its end date.">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="budget" error={err?.budget} hint="$10 at least. Invoiced after review.">
                Budget (USD)
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-biz-ink-3">$</span>
                <input id="budget" name="budget" inputMode="decimal" defaultValue={def("budget", initial?.budget_cents ? String(initial.budget_cents / 100) : "")} placeholder="50" className={cn(bizField, "h-11 pl-7 tabular-nums")} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="startsLocal" error={err?.startsAt}>
                Starts
              </Label>
              <input id="startsLocal" type="datetime-local" required value={starts} onChange={(e) => setStarts(e.target.value)} className={cn(bizField, "h-11")} />
              <input type="hidden" name="startsAt" value={toIso(starts)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="endsLocal" error={err?.endsAt} hint="Required: 90 days at most.">
                Ends
              </Label>
              <input id="endsLocal" type="datetime-local" required value={ends} min={starts || undefined} onChange={(e) => setEnds(e.target.value)} className={cn(bizField, "h-11")} />
              <input type="hidden" name="endsAt" value={toIso(ends)} />
            </div>
          </div>
        </Section>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="mr-auto flex items-center gap-1.5 text-[13px] text-biz-ink-3">
            <Info className="h-4 w-4" /> Saving keeps a draft. You review and submit it on the next screen.
          </p>
          <PortalLink href={cancelHref} className={bizButton({ variant: "ghost" })}>
            Cancel
          </PortalLink>
          <button type="submit" disabled={pending} className={bizButton({ variant: "primary", size: "lg" })} data-testid="ad-save">
            {pending ? "Saving…" : "Save draft"}
          </button>
        </div>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="Preview">
        <Panel className="p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-biz-ink">Preview</h2>
            {chosen.length > 1 ? (
              <div role="tablist" aria-label="Placement" className="inline-flex rounded-full bg-biz-surface-3 p-0.5">
                {chosen.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="tab"
                    aria-selected={preview === p}
                    onClick={() => setPreviewOn(p)}
                    className={cn("h-7 rounded-full px-3 text-xs font-medium transition-colors", preview === p ? "bg-biz-surface text-biz-ink shadow-biz" : "text-biz-ink-3")}
                  >
                    {AD_PLACEMENTS.find((x) => x.value === p)?.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <AdPreview ad={previewAd} placement={preview} />
          {preview === "reels" && snap.media[0]?.type !== "video" ? (
            <p className="mt-4 flex items-start gap-2 text-[13px] text-biz-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Reels needs one vertical video.
            </p>
          ) : null}
        </Panel>
      </aside>
    </form>
  );
}
