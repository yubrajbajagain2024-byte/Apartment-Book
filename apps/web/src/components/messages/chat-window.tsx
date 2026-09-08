"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Check, Circle, ImagePlus, Send } from "lucide-react";
import {
  MESSAGES_PAGE_SIZE,
  formatDayLabel,
  getMemberStatus,
  isSameDay,
  listMessages,
  markConversationRead,
  receiptFor,
  sendMessage,
  uploadImage,
  type ConversationMember,
  type ConversationSummary,
  type MemberStatus,
  type Message,
  type MessageReceipt,
  type MessageWithSender,
} from "@apartment-book/shared";
import { useHydrated } from "@/lib/hooks";
import { createClient, ensureRealtimeAuth, uniqueChannelName } from "@/lib/supabase/client";
import { cn, errorMessage, formatMessageTime } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";

type ChatMessage = MessageWithSender & { pending?: boolean; failed?: boolean };

/** Messenger-style state of my newest message: hollow circle (sending), check in a circle (sent), filled check (delivered). */
function ReceiptIcon({ receipt }: { receipt: MessageReceipt }) {
  const label = receipt === "sending" ? "Sending" : receipt === "sent" ? "Sent" : "Delivered";
  return (
    <span className="mb-4 flex h-3.5 w-3.5 shrink-0 items-center justify-center self-end" data-testid="receipt" data-receipt={receipt} aria-label={label} title={label} role="img">
      {receipt === "sending" ? (
        <Circle className="h-3.5 w-3.5 text-gray-400" />
      ) : receipt === "sent" ? (
        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-gray-400">
          <Check className="h-2 w-2 text-gray-400" strokeWidth={3} />
        </span>
      ) : (
        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gray-400">
          <Check className="h-2 w-2 text-white" strokeWidth={3} />
        </span>
      )}
    </span>
  );
}

export function ChatWindow({
  conversation,
  currentUserId,
  initialMessages,
  prefill,
}: {
  conversation: ConversationSummary;
  currentUserId: string;
  initialMessages: MessageWithSender[];
  prefill?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [memberStatus, setMemberStatus] = useState<Record<string, MemberStatus>>(conversation.memberStatus);
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [text, setText] = useState(prefill ?? "");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(initialMessages.length >= MESSAGES_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hydrated = useHydrated();
  const membersById = useMemo(() => new Map(conversation.members.map((m) => [m.id, m])), [conversation.members]);
  const me = membersById.get(currentUserId) ?? { id: currentUserId, full_name: "You", avatar_url: null };
  const isGroup = conversation.type === "group";

  // Live updates + mark as read.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    markConversationRead(supabase, conversation.id).catch(() => {});

    ensureRealtimeAuth(supabase).then((authed) => {
      if (cancelled || !authed) return;
      channel = supabase
        // wait: true holds SUBSCRIBED until the server's change listener is streaming,
        // so a message sent in that first second is not missed.
        .channel(uniqueChannelName(`conversation:${conversation.id}`), { config: { postgres_changes_options: { wait: true } } })
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversation.id}` },
          (payload) => {
            const row = payload.new as Message;
            setMessages((prev) => {
              if (prev.some((m) => m.id === row.id)) return prev;
              const sender = row.sender_id ? (membersById.get(row.sender_id) ?? null) : null;
              // Replace an optimistic copy of our own message if one is pending.
              const withoutTemp = row.sender_id === currentUserId
                ? prev.filter((m) => !(m.pending && m.content === row.content))
                : prev;
              return [...withoutTemp, { ...row, sender }];
            });
            if (row.sender_id !== currentUserId) markConversationRead(supabase, conversation.id).catch(() => {});
          },
        )
        // Other members' read/delivered times, for the receipts under my messages.
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "conversation_members", filter: `conversation_id=eq.${conversation.id}` },
          (payload) => {
            const row = payload.new as ConversationMember;
            setMemberStatus((prev) => ({
              ...prev,
              [row.user_id]: { lastReadAt: row.last_read_at, lastDeliveredAt: row.last_delivered_at, lastSeenAt: prev[row.user_id]?.lastSeenAt ?? null },
            }));
          },
        )
        .subscribe((status) => {
          if (status !== "SUBSCRIBED" || cancelled) return;
          // Receipts that changed before this subscription was streaming.
          getMemberStatus(supabase, conversation.id)
            .then((fresh) => {
              if (!cancelled) setMemberStatus((prev) => ({ ...prev, ...fresh }));
            })
            .catch(() => {});
          // Anything sent between the page render and this subscription would otherwise be missed.
          const newest = [...messagesRef.current].reverse().find((m) => !m.pending && !m.failed)?.created_at;
          listMessages(supabase, conversation.id, newest ? { after: newest } : {})
            .then((rows) => {
              if (cancelled || rows.length === 0) return;
              setMessages((prev) => {
                const fresh = rows.filter((r) => !prev.some((m) => m.id === r.id));
                if (fresh.length === 0) return prev;
                const withoutTemp = prev.filter((m) => !(m.pending && fresh.some((f) => f.sender_id === currentUserId && f.content === m.content)));
                return [...withoutTemp, ...fresh].sort((a, b) => a.created_at.localeCompare(b.created_at));
              });
              if (rows.some((r) => r.sender_id !== currentUserId)) markConversationRead(supabase, conversation.id).catch(() => {});
            })
            .catch(() => {});
        });
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [conversation.id, currentUserId, membersById]);

  // Receipts: where each other member has read up to, and the state of my newest message.
  const others = conversation.otherMembers.map((m) => ({ member: m, status: memberStatus[m.id] })).filter((x): x is { member: (typeof conversation.otherMembers)[number]; status: MemberStatus } => Boolean(x.status));
  const seenAt = new Map<string, typeof conversation.otherMembers>();
  for (const { member, status } of others) {
    let target: ChatMessage | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      // Messenger shows "seen" only under messages the reader did not send themselves.
      if (!m.pending && !m.failed && m.sender_id !== member.id && m.created_at <= status.lastReadAt) {
        target = m;
        break;
      }
    }
    if (target) seenAt.set(target.id, [...(seenAt.get(target.id) ?? []), member]);
  }
  const lastMine = [...messages].reverse().find((m) => m.sender_id === currentUserId && !m.failed);
  const lastMineReceipt: MessageReceipt | null = lastMine ? (lastMine.pending ? "sending" : receiptFor(lastMine.created_at, others.map((o) => o.status))) : null;

  // Scroll to the newest message.
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  async function send(content: string, imageUrl?: string) {
    const trimmed = content.trim();
    if (!trimmed && !imageUrl) return;
    const body = trimmed || "📷 Photo";
    const tempId = `temp-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: tempId,
      conversation_id: conversation.id,
      sender_id: currentUserId,
      content: body,
      image_url: imageUrl ?? null,
      created_at: new Date().toISOString(),
      sender: me,
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setText("");
    setError(null);
    setSending(true);
    try {
      const saved = await sendMessage(createClient(), { conversationId: conversation.id, senderId: currentUserId, content: body, imageUrl });
      setMessages((prev) => {
        if (prev.some((m) => m.id === saved.id)) return prev.filter((m) => m.id !== tempId);
        return prev.map((m) => (m.id === tempId ? { ...saved, sender: saved.sender ?? me } : m));
      });
    } catch (e) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)));
      setError(errorMessage(e, "Message could not be sent."));
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  async function loadMore() {
    const oldest = messages[0];
    if (!oldest || loadingMore) return;
    setLoadingMore(true);
    const list = listRef.current;
    const previousHeight = list?.scrollHeight ?? 0;
    try {
      const older = await listMessages(createClient(), conversation.id, { before: oldest.created_at });
      setMessages((prev) => [...older.filter((o) => !prev.some((p) => p.id === o.id)), ...prev]);
      setHasMore(older.length >= MESSAGES_PAGE_SIZE);
      requestAnimationFrame(() => {
        if (list) list.scrollTop = list.scrollHeight - previousHeight;
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  async function attachImage(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadImage(createClient(), { kind: "messages", userId: currentUserId, file, fileName: file.name });
      await send(text, url);
    } catch (e) {
      setError(errorMessage(e, "Photo upload failed."));
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <div ref={listRef} className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        {hasMore ? (
          <div className="mb-4 flex justify-center">
            <button type="button" onClick={loadMore} disabled={loadingMore} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50">
              {loadingMore ? "Loading…" : "Load earlier messages"}
            </button>
          </div>
        ) : null}
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-gray-500">
            <p className="font-medium text-gray-700">This is the start of your conversation.</p>
            <p className="text-sm">Say hello 👋</p>
          </div>
        ) : null}
        <ol className="flex flex-col gap-1">
          {messages.map((m, index) => {
            const previous = messages[index - 1];
            const mine = m.sender_id === currentUserId;
            const showDay = !previous || !isSameDay(previous.created_at, m.created_at);
            const continued = previous && previous.sender_id === m.sender_id && !showDay;
            return (
              <li key={m.id} className="flex flex-col">
                {showDay && hydrated ? <p className="my-3 text-center text-[11px] font-medium uppercase tracking-wide text-gray-400">{formatDayLabel(m.created_at)}</p> : null}
                <div className={cn("flex items-end gap-2", mine ? "flex-row-reverse" : "flex-row", continued && "mt-0")}>
                  {!mine ? (
                    <span className="w-8 shrink-0">
                      {!continued ? <Avatar name={m.sender?.full_name ?? "?"} src={m.sender?.avatar_url} size="sm" /> : null}
                    </span>
                  ) : null}
                  <div className={cn("flex max-w-[75%] flex-col", mine ? "items-end" : "items-start")}>
                    {!mine && isGroup && !continued ? <span className="mb-0.5 ml-1 text-[11px] text-gray-500">{m.sender?.full_name ?? "Unknown"}</span> : null}
                    {m.image_url ? (
                      <a href={m.image_url} target="_blank" rel="noopener noreferrer" className="relative mb-1 block h-48 w-48 overflow-hidden rounded-2xl bg-gray-100">
                        <Image src={m.image_url} alt="Shared photo" fill sizes="192px" className="object-cover" />
                      </a>
                    ) : null}
                    {m.content && !(m.image_url && m.content === "📷 Photo") ? (
                      <div
                        className={cn(
                          "whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                          mine ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-900",
                          m.pending && "opacity-60",
                          m.failed && "bg-red-100 text-red-800",
                        )}
                        title={hydrated ? formatMessageTime(m.created_at) : undefined}
                      >
                        {m.content}
                      </div>
                    ) : null}
                    <span className="mt-0.5 px-1 text-[10px] text-gray-400">
                      {m.failed ? "Failed to send" : m.pending ? "Sending…" : hydrated ? formatMessageTime(m.created_at) : "\u00a0"}
                    </span>
                  </div>
                  {mine && m.id === lastMine?.id && lastMineReceipt && lastMineReceipt !== "seen" ? <ReceiptIcon receipt={lastMineReceipt} /> : null}
                </div>
                {seenAt.has(m.id) ? (
                  <div className="flex justify-end gap-0.5 pr-0.5" data-testid="seen-by" aria-label={`Seen by ${seenAt.get(m.id)!.map((p) => p.full_name).join(", ")}`} title={`Seen by ${seenAt.get(m.id)!.map((p) => p.full_name).join(", ")}`}>
                    {seenAt.get(m.id)!.map((p) => (
                      <Avatar key={p.id} name={p.full_name} src={p.avatar_url} size="xs" className="h-4 w-4 text-[8px]" />
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-gray-200 px-3 py-3 sm:px-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-brand-600 hover:bg-brand-50" aria-label="Send a photo">
          {uploading ? <Spinner className="h-5 w-5" /> : <ImagePlus className="h-5 w-5" />}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" disabled={uploading} onChange={(e) => attachImage(e.target.files)} />
        </label>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Aa"
          aria-label="Message"
          className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl bg-gray-100 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        <button type="submit" disabled={sending || uploading || text.trim().length === 0} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40" aria-label="Send">
          <Send className="h-5 w-5" />
        </button>
      </form>
      {error ? <p className="px-4 pb-2 text-xs text-red-600">{error}</p> : null}
    </>
  );
}
