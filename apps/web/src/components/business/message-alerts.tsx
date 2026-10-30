"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { BellOff, BellRing, MessageCircle, X } from "lucide-react";
import { getTotalUnread, inquiryMessagePreview, markDeliveredAll } from "@apartment-book/shared";
import { createClient, ensureRealtimeAuth, uniqueChannelName } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { noteInboxMessage, setInboxUnread, useInboxUnread } from "./inbox-live";
import { usePortalHref, usePortalPathname } from "./portal-base";
import { bizButton } from "./ui";

// --- The desktop-alert preference: one per browser, as notifications are -------------------------------------------------

const KEY = "biz-message-alerts";
const EVENT = "biz-message-alerts-change";
type AlertsState = "unsupported" | "blocked" | "off" | "on";

function readAlerts(): AlertsState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  try {
    return localStorage.getItem(KEY) === "on" && Notification.permission === "granted" ? "on" : "off";
  } catch {
    return "off";
  }
}
function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/** Desktop alerts for new messages: whether this browser can show them, and on or off here. */
export function useMessageAlerts(): { state: AlertsState; toggle: () => Promise<void> } {
  const state = useSyncExternalStore(subscribe, readAlerts, () => "off" as AlertsState);
  async function toggle() {
    if (state === "unsupported" || state === "blocked") return;
    let next: "on" | "off" = state === "on" ? "off" : "on";
    if (next === "on" && Notification.permission !== "granted") next = (await Notification.requestPermission()) === "granted" ? "on" : "off";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private windows may refuse storage: the alerts then stay as they were.
    }
    window.dispatchEvent(new Event(EVENT));
  }
  return { state, toggle };
}

/** Settings › Account's switch for desktop alerts, with what the browser allows. */
export function MessageAlertsSetting() {
  const { state, toggle } = useMessageAlerts();
  const note = {
    unsupported: "This browser cannot show desktop alerts. New messages still show in the portal and on the Inbox's badge.",
    blocked: "Alerts are blocked for this site in your browser's settings. Allow notifications there, then turn them on here.",
    off: "Off on this browser. New messages still show in the portal and on the Inbox's badge.",
    on: "On: a desktop alert for each new message from a student, even when this tab is in the background.",
  }[state];
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="max-w-md text-[14px] leading-relaxed text-biz-ink-3" suppressHydrationWarning>
        {note}
      </p>
      {state === "off" || state === "on" ? (
        <button
          type="button"
          role="switch"
          aria-checked={state === "on"}
          onClick={toggle}
          data-testid="message-alerts"
          className={bizButton({ variant: state === "on" ? "secondary" : "primary" })}
        >
          {state === "on" ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
          {state === "on" ? "Turn off desktop alerts" : "Turn on desktop alerts"}
        </button>
      ) : null}
    </div>
  );
}

/** The inbox's own small switch for the same preference. */
export function MessageAlertsButton() {
  const { state, toggle } = useMessageAlerts();
  if (state === "unsupported") return null;
  const on = state === "on";
  const label = state === "blocked" ? "Desktop alerts are blocked in this browser" : on ? "Desktop alerts on: turn off" : "Turn on desktop alerts";
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={state === "blocked"}
      aria-label={label}
      title={label}
      aria-pressed={on}
      className={cn("flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-40", on ? "bg-biz-accent-soft text-biz-accent-ink" : "text-biz-ink-3 hover:bg-biz-line hover:text-biz-ink")}
    >
      {on ? <BellRing className="h-[18px] w-[18px]" /> : <BellOff className="h-[18px] w-[18px]" />}
    </button>
  );
}

// --- New messages as they come in ------------------------------------------------------------------------------------------

type Toast = { id: string; conversationId: string; name: string; text: string };

/** A new row in the messages table, as Realtime delivers it. */
type MessageRow = { id: string; conversation_id: string; sender_id: string | null; content: string | null; image_url: string | null; attachments: unknown; shared_post: unknown; created_at: string };

/**
 * New messages from students, wherever in the portal the team member is: a toast with a Reply link (not for the chat
 * already open on screen), a desktop alert when they turned those on, and the unread count in the tab's title. Only
 * messages the database lets this member read arrive (chats where the student wrote), and the team's own are skipped.
 *
 * This is the shell's one realtime channel for messages and its one unread count (inbox-live.ts): the sidebar's badge
 * reads what is counted here, so a page carries one subscription and one count, not one per place the number shows.
 * The channel is opened once and kept across pages; the count is taken again on every page (opening a chat lowers
 * it) and on every message. The portal being open, every message has reached this device: "Delivered" for the
 * students who sent them (markDeliveredAll), once at the start and again as messages come in.
 */
export function InboxAlerts({ userId, teamIds, initialUnread }: { userId: string; teamIds: string[]; initialUnread: number }) {
  const pathname = usePortalPathname();
  const href = usePortalHref();
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const unread = useInboxUnread(initialUnread);
  const where = useRef({ pathname, href, router });
  const team = useRef(new Set(teamIds));
  const teamKey = teamIds.join(",");

  useEffect(() => {
    where.current = { pathname, href, router };
  }, [pathname, href, router]);
  useEffect(() => {
    team.current = new Set(teamKey ? teamKey.split(",") : []);
  }, [teamKey]);

  // The server counted as it rendered the page (after a refresh too): that number stands until the next count here.
  useEffect(() => {
    setInboxUnread(initialUnread);
  }, [initialUnread]);

  // The tab's title carries the count ("(3) Inbox · UniBuzz Business"). Each page sets its own title as it arrives, so
  // the count goes on again after every page, and once more a moment later in case the page's title came after.
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(/^\(\d+\+?\) /, "");
      document.title = unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${base}` : base;
    };
    apply();
    const later = setTimeout(apply, 400);
    return () => clearTimeout(later);
  }, [unread, pathname]);

  // Opening a chat lowers the count: count again on every page, once for the whole shell.
  useEffect(() => {
    let cancelled = false;
    getTotalUnread(createClient())
      .then((n) => {
        if (!cancelled) setInboxUnread(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const recount = () =>
      getTotalUnread(supabase)
        .then((n) => {
          if (!cancelled) setInboxUnread(n);
        })
        .catch(() => {});
    ensureRealtimeAuth(supabase).then((authed) => {
      if (cancelled || !authed) return;
      // Only once the session is loaded, or the call would run anonymously and touch nothing.
      markDeliveredAll(supabase).catch(() => {});
      channel = supabase
        .channel(uniqueChannelName(`inbox-alerts:${userId}`), { config: { postgres_changes_options: { wait: true } } })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (payload) => {
          const row = payload.new as MessageRow;
          noteInboxMessage({ conversationId: row.conversation_id, createdAt: row.created_at });
          if (!row.sender_id || row.sender_id === userId) return;
          // A teammate's reply counts as unread for everyone else on the team until they open the chat.
          recount();
          markDeliveredAll(supabase).catch(() => {});
          if (team.current.has(row.sender_id)) return;
          const { pathname: now, href: to, router: nav } = where.current;
          const open = now === `/inbox/${row.conversation_id}` && document.visibilityState === "visible";
          const { data } = await supabase.from("profiles").select("full_name").eq("id", row.sender_id).maybeSingle();
          if (cancelled) return;
          const name = data?.full_name || "A student";
          const text = inquiryMessagePreview(row);
          if (!open) {
            setToasts((prev) => [...prev.filter((t) => t.conversationId !== row.conversation_id).slice(-2), { id: row.id, conversationId: row.conversation_id, name, text }]);
            setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== row.id)), 8000);
          }
          if (readAlerts() === "on" && (!open || document.visibilityState === "hidden")) {
            const alert = new Notification(`${name} · UniBuzz Business`, { body: text, tag: row.conversation_id });
            alert.onclick = () => {
              window.focus();
              nav.push(to(`/inbox/${row.conversation_id}`));
              alert.close();
            };
          }
        })
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId]);

  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 print:hidden">
      {toasts.map((t) => (
        <div key={t.id} className="ab-sheet-in pointer-events-auto flex items-start gap-3 rounded-2xl bg-biz-surface p-3.5 shadow-biz-lift ring-1 ring-biz-line" data-testid="message-toast">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-biz-accent-soft text-biz-accent-ink">
            <MessageCircle className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold text-biz-ink">{t.name}</span>
            <span className="line-clamp-2 text-[13px] text-biz-ink-3">{t.text}</span>
            <button
              type="button"
              onClick={() => {
                setToasts((prev) => prev.filter((x) => x.id !== t.id));
                router.push(href(`/inbox/${t.conversationId}`));
              }}
              className="mt-1 text-[13px] font-semibold text-biz-accent-ink hover:underline"
            >
              Reply
            </button>
          </span>
          <button type="button" aria-label="Dismiss" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} className="rounded-full p-1 text-biz-ink-4 hover:bg-biz-line hover:text-biz-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
