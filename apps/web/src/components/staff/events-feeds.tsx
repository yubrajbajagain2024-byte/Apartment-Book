"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Plus, RefreshCw, Rss } from "lucide-react";
import { EVENT_CATEGORIES } from "@apartment-book/shared";
import { deleteEventFeedAction, saveEventFeedAction, syncEventFeedsAction, type EventFeedInput } from "@/lib/staff/actions";
import type { ConsoleFeed } from "@/lib/staff/events";
import type { FeedSyncSummary } from "@/lib/events-server/sync";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Ago } from "@/components/staff/live";
import { EmptyBox, Pill } from "@/components/staff/parts";

const STATUS_TONE = { ok: "green", unchanged: "gray", error: "red" } as const;

/** One sync's outcome in a few words, for the row it ran on. */
function summaryLine(s: FeedSyncSummary): string {
  if (s.status === "error") return `Failed: ${s.error ?? "unknown error"}`;
  if (s.status === "unchanged") return "Unchanged since the last sync.";
  return `${s.itemsSeen} items: ${s.inserted} new, ${s.updated} changed, ${s.cancelled} cancelled${s.duplicates ? `, ${s.duplicates} already listed elsewhere` : ""}${s.skipped ? `, ${s.skipped} left out (${s.error ?? "refused by the database"})` : ""}.`;
}

/**
 * The calendars the sync reads: every staff member sees them and may run a sync; admins add, change and delete them
 * (each change is audited by the database). The form is one for adding and editing; a row's "Edit" fills it.
 */
export function EventFeedsPanel({ feeds, universities, admin }: { feeds: ConsoleFeed[]; universities: { id: string; name: string }[]; admin: boolean }) {
  const [editing, setEditing] = useState<ConsoleFeed | "new" | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function note(id: string, text: string) {
    setNotes((n) => ({ ...n, [id]: text }));
  }

  function sync(feedId?: string) {
    const key = feedId ?? "all";
    setBusy(key);
    start(async () => {
      const res = await syncEventFeedsAction(feedId);
      if (!res.ok) note(key, res.error);
      else if (feedId) note(feedId, res.data[0] ? summaryLine(res.data[0]) : "Nothing to sync.");
      else {
        const failed = res.data.filter((s) => s.status === "error").length;
        note("all", `${res.data.length} feeds synced${failed ? `, ${failed} failed` : ""}.`);
        for (const s of res.data) note(s.id, summaryLine(s));
      }
      setBusy(null);
    });
  }

  function remove(id: string) {
    setBusy(id);
    start(async () => {
      const res = await deleteEventFeedAction(id);
      if (!res.ok) note(id, res.error);
      setConfirmDelete(null);
      setBusy(null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => sync()}>
          <RefreshCw className={cn("h-4 w-4", busy === "all" && "animate-spin")} /> Sync all
        </Button>
        {admin ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(editing === "new" ? null : "new")}>
            <Plus className="h-4 w-4" /> Add a feed
          </Button>
        ) : null}
        {notes.all ? <span className="text-xs text-gray-600">{notes.all}</span> : null}
      </div>

      {editing ? <FeedForm key={editing === "new" ? "new" : editing.id} feed={editing === "new" ? null : editing} universities={universities} onDone={() => setEditing(null)} /> : null}

      {feeds.length === 0 ? (
        <EmptyBox icon={Rss} title="No calendar feeds yet." description={admin ? "Add the university's ICS or RSS calendar and the sync fills the Events tab." : "An admin adds the university's calendars here."} />
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
          {feeds.map((f) => (
            <li key={f.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">{f.name}</span>
                <Pill variant="outline">{f.kind.toUpperCase()}</Pill>
                {!f.enabled ? <Pill tone="amber">off</Pill> : null}
                {f.last_status ? <Pill tone={STATUS_TONE[f.last_status]}>{f.last_status}</Pill> : <Pill>never synced</Pill>}
                <span className="ml-auto flex items-center gap-1">
                  <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => sync(f.id)} aria-label={`Sync ${f.name} now`}>
                    <RefreshCw className={cn("h-4 w-4", busy === f.id && "animate-spin")} /> Sync now
                  </Button>
                  {admin ? (
                    <>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(editing !== "new" && editing?.id === f.id ? null : f)}>
                        Edit
                      </Button>
                      {confirmDelete === f.id ? (
                        <>
                          <Button type="button" variant="danger" size="sm" disabled={pending} onClick={() => remove(f.id)}>
                            Delete feed and its {f.upcoming} upcoming events
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
                            Keep
                          </Button>
                        </>
                      ) : (
                        <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setConfirmDelete(f.id)}>
                          Delete
                        </Button>
                      )}
                    </>
                  ) : null}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                <span>{f.university_name}</span>
                {f.organization_name ? <span>for {f.organization_name}</span> : null}
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="truncate font-mono hover:underline">
                  {f.url}
                </a>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
                <span>
                  {f.last_synced_at ? (
                    <>
                      synced <Ago ms={Date.parse(f.last_synced_at)} />
                    </>
                  ) : (
                    "not synced yet"
                  )}
                </span>
                <span>{f.items_seen} items last time</span>
                <span>{f.upcoming} upcoming</span>
                <span>default category {f.default_category}</span>
              </div>
              {f.last_error ? <p className="text-xs text-red-600">{f.last_error}</p> : null}
              {notes[f.id] ? <p className="text-xs text-gray-700">{notes[f.id]}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The add / edit form: plain inputs, read on submit, so the page holds no form state of its own. */
function FeedForm({ feed, universities, onDone }: { feed: ConsoleFeed | null; universities: { id: string; name: string }[]; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const input: EventFeedInput = {
      id: feed?.id ?? null,
      universityId: get("university_id"),
      organizationId: get("organization_id") || null,
      name: get("name"),
      url: get("url"),
      kind: get("kind") === "rss" ? "rss" : "ics",
      enabled: data.get("enabled") === "on",
      defaultCategory: get("default_category") || "other",
    };
    setError(null);
    start(async () => {
      const res = await saveEventFeedAction(input);
      if (!res.ok) setError(res.error);
      else onDone();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200 sm:grid-cols-2">
      <h3 className="text-sm font-semibold text-gray-900 sm:col-span-2">{feed ? `Edit ${feed.name}` : "New calendar feed"}</h3>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        Name
        <Input name="name" defaultValue={feed?.name ?? ""} placeholder="Campus calendar" required maxLength={80} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        University
        <Select name="university_id" defaultValue={feed?.university_id ?? universities[0]?.id ?? ""} required>
          {universities.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 sm:col-span-2">
        Address (https)
        <Input name="url" type="url" defaultValue={feed?.url ?? ""} placeholder="https://events.example.edu/calendar.ics" required pattern="https://.*" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        Kind
        <Select name="kind" defaultValue={feed?.kind ?? "ics"}>
          <option value="ics">ICS calendar</option>
          <option value="rss">RSS feed</option>
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        Default category
        <Select name="default_category" defaultValue={feed?.default_category ?? "other"}>
          {EVENT_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 sm:col-span-2">
        Organization id (optional: the feed&apos;s events then belong to that organization)
        <Input name="organization_id" defaultValue={feed?.organization_id ?? ""} placeholder="00000000-0000-0000-0000-000000000000" />
      </label>
      <Checkbox name="enabled" label="Enabled" defaultChecked={feed ? feed.enabled : true} />
      <div className="flex items-center justify-end gap-2 sm:col-span-2">
        {error ? <span className="mr-auto text-xs text-red-600">{error}</span> : null}
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={pending}>
          {feed ? "Save changes" : "Add feed"}
        </Button>
      </div>
    </form>
  );
}
