"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Maximize2, Minus, X } from "lucide-react";
import { getConversation, listMessages, type ConversationSummary, type MessageWithSender } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { ChatWindow } from "./chat-window";
import { ConversationAvatar } from "./conversation-list";

type DockWindowState = { id: string; minimized: boolean; prefill?: string };
type DockContextValue = {
  openChat: (id: string, opts?: { prefill?: string }) => void;
  closeChat: (id: string) => void;
  toggleMinimize: (id: string) => void;
  windows: DockWindowState[];
};

const DockContext = createContext<DockContextValue | null>(null);
const MAX_WINDOWS = 3;

/** Holds which chats are open in the bottom-right dock; remembered per user in this browser. */
export function ChatDockProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const storageKey = userId ? `ab-chat-dock:${userId}` : null;
  const [windows, setWindows] = useState<DockWindowState[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? (JSON.parse(raw) as DockWindowState[]) : [];
      // Restore via a callback so the state update is not a synchronous effect write.
      const timer = setTimeout(() => {
        setWindows(parsed.filter((w) => typeof w.id === "string").slice(0, MAX_WINDOWS).map((w) => ({ id: w.id, minimized: Boolean(w.minimized) })));
        setLoaded(true);
      }, 0);
      return () => clearTimeout(timer);
    } catch {
      const timer = setTimeout(() => setLoaded(true), 0);
      return () => clearTimeout(timer);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !loaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(windows.map(({ id, minimized }) => ({ id, minimized }))));
    } catch {
      /* ignore */
    }
  }, [storageKey, windows, loaded]);

  const openChat = useCallback((id: string, opts?: { prefill?: string }) => {
    setWindows((prev) => {
      const existing = prev.find((w) => w.id === id);
      const rest = prev.filter((w) => w.id !== id);
      const next: DockWindowState = { id, minimized: false, prefill: existing?.prefill ?? opts?.prefill };
      // Newest on the right; drop the oldest when over the limit.
      return [...rest.slice(-(MAX_WINDOWS - 1)), next];
    });
  }, []);
  const closeChat = useCallback((id: string) => setWindows((prev) => prev.filter((w) => w.id !== id)), []);
  const toggleMinimize = useCallback((id: string) => setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, minimized: !w.minimized } : w))), []);

  const value = useMemo(() => ({ openChat, closeChat, toggleMinimize, windows }), [openChat, closeChat, toggleMinimize, windows]);
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

export function useChatDock(): DockContextValue | null {
  return useContext(DockContext);
}

/** The dock itself: desktop only, hidden while the full Messages page is open. */
export function ChatDock({ userId }: { userId: string | null }) {
  const dock = useChatDock();
  const pathname = usePathname();
  if (!dock || !userId || dock.windows.length === 0 || pathname.startsWith("/messages")) return null;
  return (
    <div className="pointer-events-none fixed bottom-0 right-4 z-40 hidden items-end gap-3 md:flex">
      {dock.windows.map((w) => (
        <DockWindow key={w.id} state={w} userId={userId} onClose={() => dock.closeChat(w.id)} onToggle={() => dock.toggleMinimize(w.id)} />
      ))}
    </div>
  );
}

function DockWindow({ state, userId, onClose, onToggle }: { state: DockWindowState; userId: string; onClose: () => void; onToggle: () => void }) {
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<MessageWithSender[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    Promise.all([getConversation(supabase, state.id, userId), listMessages(supabase, state.id)])
      .then(([c, m]) => {
        if (cancelled) return;
        if (!c) {
          setError("This chat is no longer available.");
          return;
        }
        setConversation(c);
        setMessages(m);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the chat");
      });
    return () => {
      cancelled = true;
    };
  }, [state.id, userId]);

  const title = conversation?.title ?? "Chat";

  return (
    <section
      className={cn("pointer-events-auto flex w-80 flex-col overflow-hidden rounded-t-xl bg-white shadow-[0_-2px_16px_rgba(0,0,0,0.18)] ring-1 ring-gray-200", state.minimized ? "h-11" : "h-[28rem]")}
      aria-label={`Chat with ${title}`}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-gray-200 px-2">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-gray-100" aria-label={state.minimized ? `Expand chat with ${title}` : `Minimize chat with ${title}`}>
          {conversation ? <ConversationAvatar conversation={conversation} size="sm" /> : <span className="h-8 w-8 rounded-full bg-gray-200" />}
          <span className="truncate text-sm font-semibold text-gray-900">{title}</span>
        </button>
        <Link href={`/messages/${state.id}`} className="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100" aria-label="Open in Messages">
          <Maximize2 className="h-4 w-4" />
        </Link>
        <button type="button" onClick={onToggle} className="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100" aria-label={state.minimized ? "Expand" : "Minimize"}>
          <Minus className="h-4 w-4" />
        </button>
        <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100" aria-label="Close chat">
          <X className="h-4 w-4" />
        </button>
      </header>
      {!state.minimized ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {error ? (
            <p className="p-4 text-sm text-red-600">{error}</p>
          ) : conversation && messages ? (
            <ChatWindow key={state.id} conversation={conversation} currentUserId={userId} initialMessages={messages} prefill={messages.length === 0 ? state.prefill : undefined} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-brand-600">
              <Spinner />
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
