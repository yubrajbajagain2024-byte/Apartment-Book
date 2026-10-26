import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { categoryLabel, PRIORITY_LABEL, reasonLabel, SOURCE_LABEL, STAFF_SANCTION_LABELS, surfaceLabel } from "@/lib/staff/constants";
import { dateTime, day } from "@/lib/staff/format";
import { fetchQueueItem, requireStaff, requireUuid, staffMetadata } from "@/lib/staff/server";
import type { StaffQueueItemDetail } from "@/lib/staff/types";
import { Avatar } from "@/components/ui/avatar";
import { ItemActions } from "@/components/staff/item-actions";
import { BuzzContext, MediaStrip } from "@/components/staff/item-content";
import { Ago, SlaChip } from "@/components/staff/live";
import { BlindNote, ExcerptBlock, KeyValue, Panel, Pill, PRIORITY_TONE, ROLE_TONE, Section } from "@/components/staff/parts";
import { StatusChip } from "@/components/staff/queue-card";

export const generateMetadata = () => staffMetadata("Queue item · Trust & Safety");

/**
 * One queue item (UniVerse QueueItemPage, safety 6.3): the content with matched spans, media, the engine's rule hits
 * and signals, the context (Buzz: the blind thread), the reports, the history, the author (public profile, or the
 * blind bucketed standing for Buzz), the ladder suggestion and the actions. Opening it claims it for 10 minutes.
 */
export default async function QueueItemPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  const { id } = await params;
  const d = await fetchQueueItem(requireUuid(id));
  const actorName = me.username ? `@${me.username}` : me.name;

  return (
    <div className="flex flex-col gap-4" data-testid="staff-queue-item">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/admin" prefetch={false} className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Queue
        </Link>
        <span className="ml-auto font-mono text-xs text-gray-500">{d.id}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={PRIORITY_TONE[d.priority]}>{PRIORITY_LABEL[d.priority]}</Pill>
        <Pill variant="outline">{surfaceLabel(d.surface)}</Pill>
        <Pill variant="outline">{SOURCE_LABEL[d.source] ?? d.source}</Pill>
        {d.label === "wellbeing" ? <Pill tone="blue">Wellbeing</Pill> : null}
        {d.appealId ? <Pill tone="violet">Appeal</Pill> : null}
        {d.legalHold ? <Pill tone="red">Legal hold</Pill> : null}
        <span className="text-sm text-gray-800">{categoryLabel(d.category)}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <SlaChip dueAt={d.slaDueAt} closed={d.status === "closed"} p0={d.priority === "p0"} />
          <StatusChip item={d} />
        </span>
      </div>
      <div className="-mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span>{d.universityShortName}</span>
        <span>
          · created <Ago ms={d.createdAt} />
        </span>
        {d.closedAt ? (
          <span>
            · closed <Ago ms={d.closedAt} />
          </span>
        ) : null}
        {d.contentStatus ? (
          <Pill variant="outline" tone={d.contentStatus === "active" ? "green" : "amber"}>
            {d.contentStatus}
          </Pill>
        ) : d.entityId === null ? (
          <Pill variant="outline" tone="red">
            blocked, never posted
          </Pill>
        ) : (
          <Pill variant="outline">gone</Pill>
        )}
        {d.locked ? <Pill tone="amber">Thread locked</Pill> : null}
        {d.href && d.contentStatus ? (
          <Link href={d.href} prefetch={false} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
            Open {d.anon ? "the thread" : "it"} <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        ) : null}
        {d.reference ? <span>· ref {d.reference}</span> : null}
      </div>

      {d.anon ? <BlindNote /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section title="Content" hint={d.fields.length ? `${d.fields.length} ${d.fields.length === 1 ? "field" : "fields"}` : undefined}>
            {d.fields.length === 0 ? <p className="text-sm text-gray-500">No text on this item.</p> : null}
            {d.fields.map((f) => (
              <div key={f.field} className="flex flex-col gap-1">
                {d.fields.length > 1 ? <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{f.field}</div> : null}
                <ExcerptBlock text={f.text} anon={d.anon} spans={f.spans} />
              </div>
            ))}
            <MediaStrip media={d.media} />
          </Section>

          {d.ruleHits.length || d.signals ? (
            <Section title="Engine">
              {d.ruleHits.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {d.ruleHits.map((h) => (
                    <Pill key={`${h.ruleId}:${h.subcode}`} variant="outline" tone={h.severity === "critical" || h.severity === "high" ? "red" : h.severity === "medium" ? "amber" : "gray"}>
                      <span className="font-mono">{h.ruleId}</span>
                      {h.subcode ? <span className="text-gray-500">{h.subcode}</span> : null}
                    </Pill>
                  ))}
                </div>
              ) : null}
              <EngineSignals d={d} />
            </Section>
          ) : null}

          {d.anon && d.entityId ? (
            <Section title="Context">
              <BuzzContext context={d.context} entityId={d.entityId} />
            </Section>
          ) : null}

          <Section title="Reports" hint={d.reports.length}>
            {d.reports.length === 0 ? <p className="text-sm text-gray-500">No reports on this item.</p> : null}
            {d.reports.map((r) => (
              <Panel key={r.id} className="p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill>{reasonLabel(r.reason)}</Pill>
                  {r.subReason ? <span className="text-xs text-gray-500">{r.subReason}</span> : null}
                  <Pill variant="outline" tone={r.reporterTrust === "high" ? "green" : r.reporterTrust === "low" ? "amber" : "gray"}>
                    trust {r.reporterTrust}
                  </Pill>
                  <Ago ms={r.createdAt} className="ml-auto text-xs text-gray-500" />
                </div>
                {r.note ? <p className="mt-2 text-sm text-gray-700">“{r.note}”</p> : null}
                {r.reporter ? (
                  <Link href={`/admin/users/${r.reporter.id}`} prefetch={false} className="mt-2 flex items-center gap-2 text-sm text-gray-800 hover:underline">
                    <Avatar name={r.reporter.fullName} src={r.reporter.avatarUrl} size="xs" />
                    {r.reporter.fullName}
                    {r.reporter.username ? <span className="text-gray-500">@{r.reporter.username}</span> : null}
                    <span className="text-xs text-gray-400">(admins only, logged)</span>
                  </Link>
                ) : null}
              </Panel>
            ))}
          </Section>

          <Section title="History" hint={d.history.length}>
            {d.history.length === 0 ? <p className="text-sm text-gray-500">No actions yet.</p> : null}
            <ol className="flex flex-col gap-2">
              {d.history.map((h, i) => (
                <li key={i} className="rounded-lg bg-white p-3 ring-1 ring-gray-200">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={h.action.startsWith("remove") || h.action === "ban" || h.action.startsWith("suspend") ? "red" : "gray"}>{h.action}</Pill>
                    <Pill variant="outline" tone={ROLE_TONE[h.actorRole] ?? "gray"}>
                      {h.actorName ?? h.actorRole}
                    </Pill>
                    <span className="ml-auto text-xs text-gray-500" title={dateTime(h.createdAt)}>
                      <Ago ms={h.createdAt} />
                    </span>
                  </div>
                  {h.note ? <p className="mt-1.5 text-sm text-gray-700">{h.note}</p> : null}
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <Section title="Author">
            <AuthorPanel d={d} />
          </Section>
          <ItemActions
            item={{
              id: d.id, entityType: d.entityType, entityId: d.entityId, status: d.status, claimedByMe: d.claimedByMe, claimedByOther: d.claimedByOther, anon: d.anon,
              category: d.category, label: d.label, canUnmask: d.canUnmask, suggestion: d.suggestion, locked: d.locked,
            }}
            role={me.role}
            actorName={actorName}
          />
        </aside>
      </div>
    </div>
  );
}

function EngineSignals({ d }: { d: StaffQueueItemDetail }) {
  const s = d.signals;
  if (!s && !d.aiVerdict) return null;
  const rows: { k: string; v: ReactNode }[] = [{ k: "Severity", v: d.severity }];
  if (s) {
    rows.push({ k: "Evasion", v: s.evasion ? "yes" : "no" });
    rows.push({
      k: "Signals",
      v: `${s.urls ?? 0} urls · ${s.mentions ?? 0} mentions · caps ${Math.round((s.capsRatio ?? 0) * 100)}% · ${s.homoglyphs ?? 0} homoglyphs · ${s.invisibleChars ?? 0} invisible${s.hasFullName ? " · names a person" : ""}`,
    });
  }
  if (d.aiVerdict) rows.push({ k: "AI verdict", v: JSON.stringify(d.aiVerdict) });
  return <KeyValue rows={rows} />;
}

function AuthorPanel({ d }: { d: StaffQueueItemDetail }) {
  const a = d.author;
  if (a.kind === "public") {
    return (
      <Panel className="flex flex-col gap-2 p-3">
        <Link href={`/admin/users/${a.user.id}`} prefetch={false} className="flex items-center gap-2 hover:underline">
          <Avatar name={a.user.fullName} src={a.user.avatarUrl} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-gray-900">{a.user.fullName}</span>
            {a.user.username ? <span className="block truncate text-xs text-gray-500">@{a.user.username}</span> : null}
          </span>
        </Link>
        <div className="flex flex-wrap gap-1.5">
          <Pill variant="outline">{a.accountAgeDays}d old</Pill>
          <Pill variant="outline" tone={a.strikePoints ? "amber" : "gray"}>
            {a.strikePoints} strike pts
          </Pill>
          {a.sanctions.slice(0, 4).map((s) => (
            <Pill key={s.id} tone={s.kind === "ban" || s.kind === "suspension" ? "red" : "gray"}>
              {STAFF_SANCTION_LABELS[s.kind] ?? s.kind}
              {s.until ? ` · until ${day(s.until)}` : ""}
            </Pill>
          ))}
        </div>
      </Panel>
    );
  }
  const prior = Object.entries(a.priorByCategory);
  return (
    <Panel className="p-3">
      <div className="mb-2 text-xs text-gray-500">Blind standing · bucketed, no identifier of any kind</div>
      <KeyValue
        rows={[
          { k: "Account age", v: a.accountAge },
          { k: "Strike points", v: a.strikePoints },
          { k: "Prior by guideline", v: prior.length ? prior.map(([c, n]) => `${categoryLabel(c)} ${n}`).join(" · ") : "none" },
          { k: "Current sanction", v: a.sanction ? (STAFF_SANCTION_LABELS[a.sanction] ?? a.sanction) : "none" },
          { k: "Other open items", v: a.otherOpenItems },
        ]}
      />
    </Panel>
  );
}
