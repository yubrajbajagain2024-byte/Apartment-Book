"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  INQUIRY_FILTERS,
  inboxAfterMessage,
  inboxAfterRead,
  inboxReflects,
  inquiryKindLabel,
  inquiryMatches,
  markConversationsRead,
  type ConversationSummary,
  type InboxMessageEvent,
  type InquiryFilter,
  type InquiryTarget,
} from "@apartment-book/shared";
import { createClient, ensureRealtimeAuth, uniqueChannelName } from "@/lib/supabase/client";
import { cn, timeAgo } from "@/lib/utils";
import { ConversationAvatar } from "@/components/messages/conversation-list";
import { useMessagesPaths } from "@/components/messages/messages-paths";
import { readInboxLive, setInboxUnread } from "./inbox-live";
import { INQUIRY_ICONS } from "./inquiry-icons";
import { MessageAlertsButton } from "./message-alerts";

/** One inquiry as the inbox lists it: the chat (titled after the student), what it is about, and who wrote last. */
export type InquiryItem = {
  conversation: ConversationSummary;
  target: InquiryTarget | null;
  /** The student wrote last. */
  needsReply: boolean;
  /** "You" or a teammate's first name when the team wrote last; null when the student did. */
  lastBy: string | null;
};

/** A team member as the list needs them: to tell a teammate's reply from a student's, and to name it. */
export type InquiryTeammate = { id: string; firstName: string };

/**
 * The business's inbox list, Instagram style: the student's photo and name, the newest message ("You:" when the team
 * wrote it), what the chat is about, unread counts, and filters (unread, needing a reply, by what it came from) with a
 * search. Students always start these chats.
 *
 * It keeps itself current without the server: a message moves its chat to the top with the new preview and count, a
 * read receipt clears a count (inboxAfterMessage, inboxAfterRead), at once and with no re-render of the page. Only
 * what it cannot know, a chat it has not seen (a student's first message, which has a context to look up), is read
 * from the server. A message that arrived while another page was open is caught up on when the list mounts.
 */
export function InquiryList({ items, userId, team }: { items: InquiryItem[]; userId: string; team: InquiryTeammate[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const paths = useMessagesPaths();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [filter, setFilter] = useState<InquiryFilter>("all");
  const [query, setQuery] = useState("");
  const [marking, setMarking] = useState(false);
  // The list as it stands: the server's, then patched as messages and receipts arrive; the server's again after any refresh.
  const [rows, setRows] = useState(items);
  const [synced, setSynced] = useState(items);
  if (items !== synced) {
    setSynced(items);
    setRows(items);
  }
  // What the realtime handlers read: the list as it stands, who the viewer is, and which chat is open on screen.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const openId = pathname.startsWith(`${paths.base}/`) ? pathname.slice(paths.base.length + 1) : null;
  const me = useRef({ userId, team: new Map(team.map((t) => [t.id, t.firstName])), openConversationId: openId });
  const teamKey = team.map((t) => `${t.id}\t${t.firstName}`).join("\n");
  useEffect(() => {
    const members = teamKey ? teamKey.split("\n").map((line) => line.split("\t") as [string, string]) : [];
    me.current = { userId, team: new Map(members), openConversationId: openId };
  }, [userId, teamKey, openId]);

  const shown = rows
    .map((i) => {
      const c = i.conversation;
      const about = i.target ? [inquiryKindLabel(i.target.kind), i.target.title].filter(Boolean).join(" · ") : null;
      return { ...i, about, state: { unreadCount: c.unreadCount, needsReply: i.needsReply, kind: i.target?.kind ?? null, text: [c.title, c.lastMessagePreview, about].filter(Boolean).join(" ") } };
    });
  const visible = shown.filter((r) => inquiryMatches(r.state, filter, query));
  const unreadIds = rows.filter((i) => i.conversation.unreadCount > 0).map((i) => i.conversation.id);

  async function markAllRead() {
    if (marking || unreadIds.length === 0) return;
    setMarking(true);
    try {
      await markConversationsRead(createClient(), unreadIds);
      // The counts are 0 at once, here and on the sidebar; the read receipts the database sends agree.
      setRows((prev) => prev.map((r) => (r.conversation.unreadCount > 0 ? { ...r, conversation: { ...r.conversation, unreadCount: 0 } } : r)));
      setInboxUnread(0);
    } catch {
      // The counts stay as they are; the next refresh tells the truth.
    } finally {
      setMarking(false);
    }
  }

  // A message that came in while another page was open is not in the server's list if the page was rendered (or
  // prefetched) before it: ask once. Compared by the database's own times, so the clocks here and there do not matter.
  useEffect(() => {
    if (!inboxReflects(rowsRef.current, readInboxLive().lastMessage)) router.refresh();
    // On mount only: the list the server sent is what is being checked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    };
    ensureRealtimeAuth(supabase).then((authed) => {
      if (cancelled || !authed) return;
      channel = supabase
        .channel(uniqueChannelName("inquiry-list"), { config: { postgres_changes_options: { wait: true } } })
        // Chats and memberships coming and going (a role change, a chat removed): the server knows what to list.
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversations" }, refresh)
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "conversations" }, refresh)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversation_members" }, refresh)
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "conversation_members" }, refresh)
        // My own read receipt (this tab, another device): the count clears here.
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversation_members" }, (payload) => {
          const row = payload.new as { conversation_id: string; user_id: string; last_read_at: string | null };
          if (row.user_id !== me.current.userId) return;
          setRows((prev) => inboxAfterRead(prev, row));
        })
        // A message: the chat moves up with it; a chat not listed yet comes from the server with what it is about.
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
          const row = payload.new as InboxMessageEvent;
          if (!rowsRef.current.some((r) => r.conversation.id === row.conversation_id)) {
            refresh();
            return;
          }
          setRows((prev) => inboxAfterMessage(prev, row, me.current) ?? prev);
        })
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [router]);

  return (
    <div className="flex h-full flex-col bg-biz-surface" data-testid="inquiry-list">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
        <h1 className="flex items-baseline gap-2 text-[22px] font-semibold tracking-[-0.02em] text-biz-ink">
          Inbox
          {unreadIds.length ? <span className="text-[13px] font-medium text-biz-accent-ink">{unreadIds.length} unread</span> : null}
        </h1>
        <div className="flex items-center gap-1">
          {unreadIds.length ? (
            <button type="button" onClick={markAllRead} disabled={marking} className="h-9 rounded-full px-3 text-[13px] font-medium text-biz-accent-ink hover:bg-biz-accent-soft disabled:opacity-50">
              Mark all read
            </button>
          ) : null}
          <MessageAlertsButton />
        </div>
      </div>
      <div className="px-4 pb-2">
        <label className="flex h-10 items-center gap-2 rounded-xl bg-biz-surface-3 px-3 text-biz-ink-3 focus-within:ring-2 focus-within:ring-biz-accent">
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search students and messages"
            aria-label="Search inquiries"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-biz-ink outline-none placeholder:text-biz-ink-4"
          />
        </label>
      </div>
      <nav aria-label="Filter inquiries" className="flex gap-1.5 overflow-x-auto px-4 pb-3 no-scrollbar">
        {INQUIRY_FILTERS.map((f) => {
          const count = shown.filter((r) => inquiryMatches(r.state, f.value)).length;
          if (f.value !== "all" && f.value !== "unread" && f.value !== "needs_reply" && count === 0) return null;
          const active = f.value === filter;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={active}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium transition-colors",
                active ? "bg-biz-ink text-biz-surface" : "bg-biz-surface-3 text-biz-ink-2 hover:text-biz-ink",
              )}
            >
              {f.label}
              <span className={cn("tabular-nums", active ? "opacity-70" : "text-biz-ink-4")}>{count}</span>
            </button>
          );
        })}
      </nav>
      <ul className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-2">
        {rows.length === 0 ? <li className="px-4 py-10 text-center text-[14px] text-biz-ink-3">{paths.emptyText}</li> : null}
        {rows.length > 0 && visible.length === 0 ? <li className="px-4 py-10 text-center text-[14px] text-biz-ink-3">No inquiries match.</li> : null}
        {visible.map((r) => {
          const c = r.conversation;
          const active = pathname === `${paths.base}/${c.id}`;
          const unread = c.unreadCount > 0;
          const Icon = r.target ? INQUIRY_ICONS[r.target.kind] : null;
          return (
            <li key={c.id}>
              <Link
                href={`${paths.base}/${c.id}`}
                aria-current={active ? "page" : undefined}
                data-testid="inquiry"
                className={cn("flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors", active ? "bg-biz-accent-soft" : "hover:bg-biz-surface-2")}
              >
                <ConversationAvatar conversation={c} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cn("truncate text-[15px]", unread ? "font-semibold text-biz-ink" : "font-medium text-biz-ink-2")}>{c.title}</span>
                    {/* Rendered on the server too, so the column never starts empty; the browser's own wording wins on hydration. */}
                    <span className="shrink-0 text-[11px] text-biz-ink-4" suppressHydrationWarning>
                      {timeAgo(c.lastMessageAt)}
                    </span>
                  </span>
                  <span className={cn("block truncate text-[13px]", unread ? "font-semibold text-biz-ink" : "text-biz-ink-3")}>
                    {r.lastBy ? `${r.lastBy}: ` : ""}
                    {c.lastMessagePreview ?? "New inquiry"}
                  </span>
                  {r.about && Icon ? (
                    <span className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-biz-ink-4">
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{r.about}</span>
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {unread ? (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-biz-accent px-1.5 text-[11px] font-bold text-biz-on-accent" aria-label={`${c.unreadCount} unread`}>
                      {c.unreadCount > 99 ? "99+" : c.unreadCount}
                    </span>
                  ) : r.needsReply ? (
                    <span className="h-2.5 w-2.5 rounded-full bg-biz-accent" aria-label="Needs a reply" title="Needs a reply" />
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
