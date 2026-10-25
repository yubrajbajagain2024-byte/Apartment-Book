import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Keyboard, KeyboardAvoidingView, LayoutAnimation, Platform, Text, TextInput, View, useWindowDimensions, type ListRenderItem, type TextInputInstance, type ViewInstance } from "react-native";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import {
  MESSAGE_ATTACHMENT_LIMITS,
  MESSAGES_PAGE_SIZE,
  REPORT_REASONS,
  getConversation,
  getMemberStatus,
  isBlocked,
  formatMessageTime,
  isSameDay,
  listMessages,
  markConversationRead,
  parseAttachments,
  receiptFor,
  recordContact,
  deleteSnap,
  replyOf,
  replySnapshotOf,
  reportContent,
  sendMessage,
  signMessageMedia,
  snapDelivered,
  snapOf,
  snapState,
  unblockUser,
  currentCall,
  type CallRecord,
  type ConversationMember,
  type ConversationSummary,
  type MemberStatus,
  type Message,
  type MessageAttachment,
  type MessageCall,
  type MessageReply,
  type ProfileSummary,
} from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { CallBanner } from "@/components/calls/call-banner";
import { useCalls } from "@/components/calls/call-provider";
import { CALLS_PAUSED } from "@/lib/calls";
import { ChatHeader } from "@/components/messages/chat-header";
import { shareVideoThumbnail } from "@/components/messages/attachment-thumb";
import { Composer, ComposerNotice, type ComposerReply } from "@/components/messages/composer";
import { MediaViewer, type MediaViewerItem } from "@/components/messages/media-viewer";
import { MessageRow, messageMedia, type MediaResolver } from "@/components/messages/message-bubble";
import type { ReplyContext } from "@/components/messages/reply-quote";
import { SnapActivitySheet } from "@/components/snap/snap-activity-sheet";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { reduceMotionEnabled } from "@/lib/accessibility";
import { hapticTap, alertWithHaptic } from "@/lib/haptics";
import { errorText, useQuery } from "@/lib/hooks";
import { openMessageFile, removeUploadedFiles, uploadAttachment, type ChatMessage, type OutgoingFiles, type PendingAttachment, type UploadStatus } from "@/lib/message-attachments";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { motion } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";
import { useChatActivity } from "@/lib/use-activity-status";
import { onSnapChange } from "@/lib/snap-events";

/** Messages from one person this close together form one run: hugging bubbles, one name. */
const RUN_GAP_MS = 5 * 60 * 1000;
/** Quiet for this long, and the next message gets a day and time stamp above it, as a new day's first message does. */
const STAMP_GAP_MS = 30 * 60 * 1000;
/** Jumping to an older message (from search, or a reply's quote) loads pages this big, at most this many of them. */
const JUMP_PAGE_SIZE = 100;
const JUMP_MAX_PAGES = 10;
/** Signed photo and video links last an hour and are renewed well before that; a failed one is retried after a minute. */
const SIGNED_FOR_S = 3600;
const RESIGN_AFTER_MS = 45 * 60 * 1000;
const RETRY_UNSIGNED_MS = 60 * 1000;
/** Big files go up one at a time (each is held in memory while it uploads); small ones three at a time. */
const BIG_FILE_BYTES = 15 * 1024 * 1024;
/** A message that just arrived rises in; one drawn again later (scrolled away and back) simply appears. */
const APPEAR_FOR_MS = 2500;

type BlockState = "none" | "byMe" | "byThem";
type SignedUrl = { url: string | null; at: number };

export default function ChatScreen() {
  const { id, prefill, targetType, targetId, at } = useLocalSearchParams<{ id: string; prefill?: string; targetType?: string; targetId?: string; at?: string }>();
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();
  const navigation = useNavigation();
  const styles = useStyles();
  const userId = user?.id ?? "";
  const { data: conversation, loading } = useQuery(() => (userId ? getConversation(supabase, id, userId) : Promise.resolve(null)), [id, userId]);
  useEffect(() => {
    if (!sessionLoading && !user) router.replace("/(auth)/login");
  }, [sessionLoading, user, router]);
  const back = useCallback(() => {
    if (navigation.canGoBack()) router.back();
    else router.replace("/(tabs)/messages");
  }, [navigation, router]);
  if (sessionLoading || loading || !conversation) {
    return (
      <View style={styles.screen}>
        {sessionLoading || loading || !user ? <Loading /> : <EmptyState icon="chatbubbles-outline" title="Conversation not found" />}
        <ChatHeader conversation={null} subtitle="" activeNow={false} keepSubtitleRoom={false} onBack={back} onOpenInfo={() => {}} onHeight={() => {}} />
      </View>
    );
  }
  return (
    <Chat
      key={conversation.id}
      conversation={conversation}
      userId={userId}
      prefill={prefill}
      contact={targetType && targetId ? { type: targetType as "apartment" | "item" | "roommate", id: targetId } : null}
      jumpTo={typeof at === "string" && at ? at : null}
      onBack={back}
    />
  );
}

/** A row from the API or from realtime (where attachments are raw JSON) as the chat keeps it. */
function chatMessageOf(row: Omit<Message, "attachments"> & { attachments?: unknown }, membersById: Map<string, ProfileSummary>): ChatMessage {
  return { ...row, attachments: parseAttachments(row.attachments), sender: row.sender_id ? (membersById.get(row.sender_id) ?? null) : null };
}

/** True when `row` is the server's copy of a message still sending from this device (files are matched by path). */
function isOptimisticCopy(m: ChatMessage, row: ChatMessage): boolean {
  if (!m.pending || m.sender_id !== row.sender_id) return false;
  const sent = row.attachments ?? [];
  if (m.outgoing && m.outgoing.items.length > 0) {
    const mine = Object.values(m.outgoing.uploaded).map((a) => a.path);
    return sent.length === m.outgoing.items.length && sent.every((a) => mine.includes(a.path));
  }
  return sent.length === 0 && m.content === row.content;
}

function allDone(outgoing: OutgoingFiles): OutgoingFiles {
  return { ...outgoing, status: Object.fromEntries(outgoing.items.map((item) => [item.id, "done" as UploadStatus])) };
}

/** The server's copy in place of the one sending from here, keeping the picked files on screen (no reload, no flicker). */
function settle(row: ChatMessage, local: ChatMessage): ChatMessage {
  return { ...row, sender: row.sender ?? local.sender, outgoing: local.outgoing ? allDone(local.outgoing) : undefined };
}

const byTime = (a: ChatMessage, b: ChatMessage) => a.created_at.localeCompare(b.created_at);

/** Newer messages from the server (realtime or a catch-up), merged in order; mine replace their sending copies. */
function addFromServer(prev: ChatMessage[], rows: ChatMessage[], userId: string): ChatMessage[] {
  let next = prev;
  const fresh: ChatMessage[] = [];
  for (const row of rows) {
    if (next.some((m) => m.id === row.id) || fresh.some((m) => m.id === row.id)) continue;
    const i = row.sender_id === userId ? next.findIndex((m) => isOptimisticCopy(m, row)) : -1;
    if (i >= 0) next = [...next.slice(0, i), settle(row, next[i]), ...next.slice(i + 1)];
    else fresh.push(row);
  }
  if (fresh.length === 0) return next;
  // Messages still sending (or not sent) stay at the bottom, after everything the server has.
  const settled = [...next.filter((m) => !m.pending && !m.failed), ...fresh].sort(byTime);
  return [...settled, ...next.filter((m) => m.pending || m.failed)];
}

/** An older page in front of what is loaded. */
function prependOlder(prev: ChatMessage[], rows: ChatMessage[]): ChatMessage[] {
  const fresh = rows.filter((r) => !prev.some((m) => m.id === r.id));
  return fresh.length > 0 ? [...fresh, ...prev] : prev;
}

/** Runs `work` over `items`, at most `limit` at a time. */
async function runPool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  });
  await Promise.all(lanes);
}

function sendErrorText(e: unknown): string {
  const text = errorText(e, "The message could not be sent.");
  if (/row-level security/i.test(text)) return "You can't send messages in this chat.";
  if (/network request failed|failed to fetch/i.test(text)) return "No connection. Check your internet and try again.";
  return text;
}

/** Two messages in one run: same person, close together. */
const sameRun = (a: ChatMessage, b: ChatMessage) => a.sender_id === b.sender_id && Math.abs(Date.parse(b.created_at) - Date.parse(a.created_at)) <= RUN_GAP_MS;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "this person";

/** The bar growing or shrinking (a reply or files appearing above the field) moves the messages up or down smoothly. */
function animateLayout() {
  if (reduceMotionEnabled()) return;
  LayoutAnimation.configureNext(LayoutAnimation.create(motion.base, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
}

function Chat({
  conversation,
  userId,
  prefill,
  contact,
  jumpTo,
  onBack,
}: {
  conversation: ConversationSummary;
  userId: string;
  prefill?: string;
  contact: { type: "apartment" | "item" | "roommate"; id: string } | null;
  jumpTo: string | null;
  onBack: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles();
  const router = useRouter();
  // This screen's own navigation (not whichever screen is on top), to clear ?at= once it has been used.
  const navigation = useNavigation<{ setParams: (params: Record<string, string | undefined>) => void }>();
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const show = useActionSheet();
  const { width: windowWidth } = useWindowDimensions();
  const mediaWidth = Math.min(Math.round(windowWidth * 0.66), 300);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [memberStatus, setMemberStatus] = useState<Record<string, MemberStatus>>(conversation.memberStatus);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<PendingAttachment[]>([]);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [signed, setSigned] = useState<Record<string, SignedUrl>>({});
  const [signTick, setSignTick] = useState(0);
  const [block, setBlock] = useState<BlockState>("none");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /** The message whose exact time shows under it (tapped); one at a time. */
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ items: MediaViewerItem[]; index: number } | null>(null);
  /** The Snap whose story is open in the activity sheet. */
  const [activityFor, setActivityFor] = useState<ChatMessage | null>(null);
  /** Snaps this device has already said it received. */
  const delivered = useRef(new Set<string>());
  const [windowTop, setWindowTop] = useState<number | null>(null);
  const [jumpTick, setJumpTick] = useState(0);
  // How much of the list the floating header and bar cover: the list keeps that much clear at each end.
  const [headerHeight, setHeaderHeight] = useState(0);
  const [barHeight, setBarHeight] = useState(0);

  const rootRef = useRef<ViewInstance>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const inputRef = useRef<TextInputInstance>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const hasOlderRef = useRef(hasOlder);
  hasOlderRef.current = hasOlder;
  const signedRef = useRef(signed);
  signedRef.current = signed;
  const signing = useRef(new Set<string>());
  const olderBusy = useRef(false);
  const offsetRef = useRef(0);
  const pendingJump = useRef<string | null>(null);
  /** Set while a jump is paging back, so scrolling does not load the same pages at the same time. */
  const jumping = useRef<symbol | null>(null);
  const scrollAttempts = useRef(0);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Messages that came in (or went out) while the chat was open, each for a moment: they rise in rather than appear. */
  const arriving = useRef(new Map<string, number>());
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const membersById = useMemo(() => new Map(conversation.members.map((m) => [m.id, m])), [conversation.members]);
  const other = conversation.otherMembers[0];
  const otherId = other?.id ?? null;
  const isGroup = conversation.type === "group";
  // Under the other person's name: "Active now" or when they were last active, when that may be shown.
  const activity = useChatActivity(isGroup ? null : otherId, conversation.id);
  const activeNow = Boolean(activity.line?.online);
  // For the realtime handler below, which outlives renders.
  const refreshActivity = useRef(activity.refresh);
  refreshActivity.current = activity.refresh;

  function noteArrival(ids: string[]) {
    const now = Date.now();
    for (const id of ids) arriving.current.set(id, now);
  }

  // ---------------------------------------------------------------------------
  // Keyboard: the bar sits right on top of the keyboard. KeyboardAvoidingView measures the overlap from the top of the
  // window, so it needs how far down the window this screen starts: measured (it draws its own header, so normally 0).
  // ---------------------------------------------------------------------------
  const measure = useCallback(() => {
    rootRef.current?.measureInWindow((_x, y) => {
      if (typeof y === "number" && Number.isFinite(y) && y >= 0) setWindowTop(Math.round(y));
    });
  }, []);
  useFocusEffect(
    useCallback(() => {
      // Again once the push animation has settled.
      const timer = setTimeout(measure, 450);
      return () => clearTimeout(timer);
    }, [measure]),
  );
  const keyboardOffset = windowTop ?? 0;

  // Opening the keyboard keeps the newest message in view (the list is inverted: offset 0 is the bottom).
  useEffect(() => {
    const sub = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => {
      if (offsetRef.current < 160) listRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
    return () => sub.remove();
  }, []);

  // ---------------------------------------------------------------------------
  // Loading, realtime and catching up.
  // ---------------------------------------------------------------------------
  const loadInitial = useCallback(async () => {
    setLoadError(null);
    try {
      const rows = await listMessages(supabase, conversation.id);
      setMessages((prev) => addFromServer(prev, rows, userId));
      setHasOlder(rows.length >= MESSAGES_PAGE_SIZE);
      if (rows.length === 0 && prefill) setText((t) => t || prefill);
    } catch (e) {
      setLoadError(errorText(e, "Couldn't load the messages."));
    } finally {
      setLoaded(true);
    }
  }, [conversation.id, userId, prefill]);

  useEffect(() => {
    void loadInitial();
    markConversationRead(supabase, conversation.id).catch(() => {});
    if (contact) recordContact(supabase, contact.type, contact.id).catch(() => {});
    const channel = supabase
      .channel(`conversation:${conversation.id}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversation.id}` }, (payload) => {
        // Realtime rows carry attachments as raw JSON.
        const row = chatMessageOf(payload.new as Message & { attachments?: unknown }, membersById);
        if (row.sender_id !== userId) noteArrival([row.id]);
        setMessages((prev) => addFromServer(prev, [row], userId));
        if (row.sender_id !== userId) {
          markConversationRead(supabase, conversation.id).catch(() => {});
          // They are active right now (and their first message is what lets you see their status): ask again.
          refreshActivity.current();
        }
      })
      // A Snap opened, or gone, on either side, or a call moving on (answered, over): the Snap and call functions are
      // all that ever change a message.
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversation.id}` }, (payload) => {
        const row = payload.new as Message;
        setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, snap: row.snap ?? null, call: row.call ?? null } : m)));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversation_members", filter: `conversation_id=eq.${conversation.id}` }, (payload) => {
        const row = payload.new as ConversationMember;
        setMemberStatus((prev) => ({ ...prev, [row.user_id]: { lastReadAt: row.last_read_at, lastDeliveredAt: row.last_delivered_at } }));
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        getMemberStatus(supabase, conversation.id)
          .then((fresh) => setMemberStatus((prev) => ({ ...prev, ...fresh })))
          .catch(() => {});
        const newest = [...messagesRef.current].reverse().find((m) => !m.pending && !m.failed)?.created_at;
        listMessages(supabase, conversation.id, newest ? { after: newest } : {})
          .then((rows) => {
            if (rows.length > 0) setMessages((prev) => addFromServer(prev, rows, userId));
          })
          .catch(() => {});
      });
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, userId]);

  const loadOlder = useCallback(async () => {
    if (!hasOlderRef.current || olderBusy.current || jumping.current) return;
    const oldest = messagesRef.current.find((m) => !m.pending && !m.failed)?.created_at;
    if (!oldest) return;
    olderBusy.current = true;
    setLoadingOlder(true);
    try {
      const rows = await listMessages(supabase, conversation.id, { before: oldest });
      setMessages((prev) => prependOlder(prev, rows));
      setHasOlder(rows.length >= MESSAGES_PAGE_SIZE);
    } catch {
      // Tried again on the next scroll.
    } finally {
      olderBusy.current = false;
      setLoadingOlder(false);
    }
  }, [conversation.id]);

  // ---------------------------------------------------------------------------
  // Jumping to a message (?at=<id> from search; a tap on a reply's quote): load older pages until it is there, then
  // scroll to it and light it up.
  // ---------------------------------------------------------------------------
  const scrollToMessage = useCallback((target: string) => {
    const list = messagesRef.current;
    const i = list.findIndex((m) => m.id === target);
    if (i < 0) return;
    scrollAttempts.current = 0;
    try {
      listRef.current?.scrollToIndex({ index: list.length - 1 - i, animated: true, viewPosition: 0.5 });
    } catch {
      // onScrollToIndexFailed takes over.
    }
    setHighlightId(target);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 2400);
  }, []);
  useEffect(() => () => void (highlightTimer.current && clearTimeout(highlightTimer.current)), []);

  const jumpToMessage = useCallback(
    async (target: string): Promise<boolean> => {
      if (messagesRef.current.some((m) => m.id === target)) {
        scrollToMessage(target);
        return true;
      }
      const run = Symbol("jump");
      jumping.current = run;
      try {
        // A page the list itself is loading finishes first; from here on this loop does the paging.
        for (let waited = 0; olderBusy.current && waited < 40; waited++) await sleep(150);
        if (!alive.current) return false;
        let found = messagesRef.current.some((m) => m.id === target);
        let more = hasOlderRef.current;
        let oldest = messagesRef.current.find((m) => !m.pending && !m.failed)?.created_at ?? null;
        for (let page = 0; !found && more && oldest && page < JUMP_MAX_PAGES; page++) {
          olderBusy.current = true;
          setLoadingOlder(true);
          let rows: ChatMessage[] | null;
          try {
            rows = await listMessages(supabase, conversation.id, { before: oldest, limit: JUMP_PAGE_SIZE });
          } catch {
            rows = null;
          } finally {
            olderBusy.current = false;
            setLoadingOlder(false);
          }
          if (!rows) break;
          const older = rows;
          setMessages((prev) => prependOlder(prev, older));
          more = older.length >= JUMP_PAGE_SIZE;
          setHasOlder(more);
          oldest = older[0]?.created_at ?? null;
          found = older.some((r) => r.id === target);
          if (!alive.current) return false;
        }
        if (!found) {
          Alert.alert("Message not found", "It may have been deleted, or it's too far back in this chat.");
          return false;
        }
        pendingJump.current = target;
        setJumpTick((n) => n + 1);
        return true;
      } finally {
        if (jumping.current === run) jumping.current = null;
      }
    },
    [conversation.id, scrollToMessage],
  );

  useEffect(() => {
    if (!loaded || !jumpTo) return;
    void jumpToMessage(jumpTo).then(() => {
      // Done with it: the same message can then be jumped to again (search hands it back with dismissTo).
      if (alive.current) navigationRef.current.setParams({ at: undefined });
    });
  }, [loaded, jumpTo, jumpToMessage]);

  useEffect(() => {
    const target = pendingJump.current;
    if (!target || !messages.some((m) => m.id === target)) return;
    pendingJump.current = null;
    // After the new rows are on screen.
    requestAnimationFrame(() => scrollToMessage(target));
  }, [messages, jumpTick, scrollToMessage]);

  // Rows have different heights, so a far jump first lands near the estimate, then retries once that part is drawn.
  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    if (scrollAttempts.current >= 6) return;
    scrollAttempts.current += 1;
    listRef.current?.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index), animated: false });
    setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
      } catch {
        // Gave up: the message stays highlighted wherever the list is.
      }
    }, 120);
  }, []);

  // ---------------------------------------------------------------------------
  // Blocking: in a direct chat where either of us blocked the other, nothing can be sent (the database refuses), so the
  // bar gives way to a notice. Checked again whenever the chat comes back into view (after Block in chat info).
  // ---------------------------------------------------------------------------
  const checkBlocked = useCallback(async () => {
    if (isGroup || !otherId) return;
    try {
      const [byMe, either] = await Promise.all([
        isBlocked(supabase, userId, otherId),
        supabase.rpc("is_blocked_either_way", { p_other: otherId }).then(({ data, error }) => {
          if (error) throw error;
          return Boolean(data);
        }),
      ]);
      setBlock(byMe ? "byMe" : either ? "byThem" : "none");
    } catch {
      // Keep what we knew; sending still fails safely on the server.
    }
  }, [isGroup, otherId, userId]);
  useFocusEffect(
    useCallback(() => {
      void checkBlocked();
    }, [checkBlocked]),
  );

  function unblock() {
    if (!otherId) return;
    unblockUser(supabase, userId, otherId).then(
      () => {
        void checkBlocked();
        // Their status can show again.
        refreshActivity.current();
      },
      (e) => alertWithHaptic("error", "Couldn't unblock", errorText(e)),
    );
  }

  // ---------------------------------------------------------------------------
  // Signed links for photos and videos (the bucket is private). The storage path is the cache key, so a renewed link
  // never downloads a photo again.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const timer = setInterval(() => setSignTick((n) => n + 1), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const now = Date.now();
    const paths = new Set<string>();
    for (const m of messages) {
      // Sent from this device: shown from the files picked here.
      if (m.outgoing) continue;
      for (const a of m.attachments ?? []) {
        if (a.kind === "file" || signing.current.has(a.path)) continue;
        const known = signedRef.current[a.path];
        if (known && now - known.at < (known.url ? RESIGN_AFTER_MS : RETRY_UNSIGNED_MS)) continue;
        paths.add(a.path);
      }
    }
    if (paths.size === 0) return;
    const batch = [...paths];
    batch.forEach((p) => signing.current.add(p));
    const remember = (urls: Record<string, string>) => {
      const at = Date.now();
      setSigned((prev) => {
        const next = { ...prev };
        for (const p of batch) {
          const known = prev[p];
          // A failed renewal keeps the old link (and its age, so it is tried again soon); a path never signed waits a minute.
          next[p] = urls[p] ? { url: urls[p], at } : known?.url ? known : { url: null, at };
        }
        return next;
      });
    };
    signMessageMedia(supabase, batch, SIGNED_FOR_S)
      .then(remember, () => remember({}))
      .finally(() => batch.forEach((p) => signing.current.delete(p)));
  }, [messages, signTick]);

  // Asked and answered without a link: the file is gone (or out of reach), so the tile says so instead of loading forever.
  const resolveMedia = useCallback<MediaResolver>((a) => ({ uri: signed[a.path]?.url ?? null, cacheKey: a.path, missing: signed[a.path] !== undefined && !signed[a.path].url }), [signed]);

  // ---------------------------------------------------------------------------
  // Replies: who wrote the quoted message, and its first photo when the chat has it on screen.
  // ---------------------------------------------------------------------------
  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const resolveReply = useCallback(
    (reply: MessageReply): ReplyContext => {
      const name = reply.sender_id === userId ? "You" : (membersById.get(reply.sender_id ?? "")?.full_name ?? "Someone");
      const original = messagesById.get(reply.id);
      const picture = original ? messageMedia(original, resolveMedia).find((media) => media.kind === "image" && media.uri) : undefined;
      return { name, thumbnail: picture?.uri ?? null, thumbnailKey: picture?.cacheKey };
    },
    [userId, membersById, messagesById, resolveMedia],
  );
  const composerReply = useMemo<ComposerReply | null>(() => {
    if (!replyTo) return null;
    const reply = replySnapshotOf(replyTo);
    return { reply, context: resolveReply(reply) };
  }, [replyTo, resolveReply]);

  const startReply = useCallback((m: ChatMessage) => {
    animateLayout();
    setReplyTo(m);
    inputRef.current?.focus();
  }, []);
  const cancelReply = useCallback(() => {
    animateLayout();
    setReplyTo(null);
  }, []);
  const revealTime = useCallback((m: ChatMessage) => {
    animateLayout();
    setRevealedId((current) => (current === m.id ? null : m.id));
  }, []);
  const jumpFromQuote = useCallback(
    (messageId: string) => {
      hapticTap();
      void jumpToMessage(messageId);
    },
    [jumpToMessage],
  );

  // ---------------------------------------------------------------------------
  // Sending: text right away; files are uploaded first (each tile shows its progress), then the message goes out.
  // ---------------------------------------------------------------------------
  const patchMessage = useCallback((id: string, change: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? change(m) : m)));
  }, []);

  const deliver = useCallback(
    async (message: ChatMessage) => {
      const id = message.id;
      const files = message.outgoing;
      patchMessage(id, (m) => ({ ...m, pending: true, failed: false, error: null }));
      try {
        let attachments: MessageAttachment[] | undefined;
        if (files && files.items.length > 0) {
          const items = files.items;
          const uploaded: Record<string, MessageAttachment> = { ...files.uploaded };
          const status: Record<string, UploadStatus> = {};
          for (const item of items) status[item.id] = uploaded[item.id] ? "done" : "waiting";
          const publish = () => {
            const snapshot: OutgoingFiles = { items, uploaded: { ...uploaded }, status: { ...status } };
            patchMessage(id, (m) => ({ ...m, outgoing: snapshot }));
          };
          publish();
          const todo = items.filter((item) => !uploaded[item.id]);
          let failure: unknown = null;
          await runPool(todo, todo.some((item) => item.size > BIG_FILE_BYTES) ? 1 : 3, async (item) => {
            if (failure) return;
            status[item.id] = "uploading";
            publish();
            try {
              const attachment = await uploadAttachment(conversation.id, userId, item);
              uploaded[item.id] = attachment;
              status[item.id] = "done";
              if (item.kind === "video") shareVideoThumbnail(item.id, attachment.path);
            } catch (e) {
              status[item.id] = "failed";
              failure = failure ?? e;
            }
            publish();
          });
          if (failure) throw failure;
          attachments = items.map((item) => uploaded[item.id]);
        }
        const saved = await sendMessage(supabase, { conversationId: conversation.id, senderId: userId, content: message.content, attachments, replyTo: replyOf(message.reply_to)?.id ?? null });
        setMessages((prev) => {
          // Realtime may have delivered it already.
          if (prev.some((m) => m.id === saved.id)) return prev.filter((m) => m.id !== id);
          return prev.map((m) => (m.id === id ? settle(saved, m) : m));
        });
      } catch (e) {
        const reason = sendErrorText(e);
        patchMessage(id, (m) => ({ ...m, pending: false, failed: true, error: reason }));
        if (files && files.items.length > 0) Alert.alert("Not sent", reason);
        // Maybe one of us has just blocked the other.
        void checkBlocked();
      }
    },
    [conversation.id, userId, patchMessage, checkBlocked],
  );

  function send() {
    if (block !== "none") return;
    const body = text.trim();
    const items = picked;
    if (!body && items.length === 0) return;
    setText("");
    setPicked([]);
    if (replyTo) animateLayout();
    setReplyTo(null);
    sendNew(body, items, replyTo);
  }

  /** A voice message just recorded: sent on its own, at once (answering the quoted message, if one is up). */
  function sendVoice(item: PendingAttachment) {
    if (block !== "none") return;
    if (replyTo) animateLayout();
    setReplyTo(null);
    sendNew("", [item], replyTo);
  }

  /** A message of mine on screen at once (sending), then delivered: words, files or both, answering `answering` if any. */
  function sendNew(body: string, items: PendingAttachment[], answering: ChatMessage | null) {
    const me = membersById.get(userId) ?? { id: userId, full_name: "You", avatar_url: null };
    const message: ChatMessage = {
      id: `temp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      conversation_id: conversation.id,
      sender_id: userId,
      content: body,
      image_url: null,
      shared_post: null,
      attachments: [],
      reply_to: answering ? replySnapshotOf(answering) : null,
      created_at: new Date().toISOString(),
      sender: me,
      pending: true,
      outgoing: items.length > 0 ? { items, status: Object.fromEntries(items.map((item) => [item.id, "waiting" as UploadStatus])), uploaded: {} } : undefined,
    };
    noteArrival([message.id]);
    setMessages((prev) => [...prev, message]);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    void deliver(message);
  }

  function addPicked(items: PendingAttachment[]) {
    if (picked.length === 0) animateLayout();
    setPicked((prev) => [...prev, ...items].slice(0, MESSAGE_ATTACHMENT_LIMITS.maxItems));
  }

  function removePicked(itemId: string) {
    if (picked.length === 1) animateLayout();
    setPicked((prev) => prev.filter((p) => p.id !== itemId));
  }

  // ---------------------------------------------------------------------------
  // Long press: report someone else's message; one of mine that was not sent can be retried, edited or dropped.
  // ---------------------------------------------------------------------------
  function discard(m: ChatMessage) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    if (m.outgoing) void removeUploadedFiles(Object.values(m.outgoing.uploaded).map((a) => a.path));
  }

  function editFailed(m: ChatMessage) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    if (m.content) setText((t) => (t.trim() ? `${t} ${m.content}` : m.content));
    const items = m.outgoing?.items ?? [];
    if (items.length > 0) setPicked((prev) => [...prev, ...items.filter((item) => !prev.some((p) => p.id === item.id))].slice(0, MESSAGE_ATTACHMENT_LIMITS.maxItems));
    // The message it was answering, when that is still on screen.
    const reply = replyOf(m.reply_to);
    const original = reply ? messagesRef.current.find((x) => x.id === reply.id) : undefined;
    if (original) setReplyTo(original);
  }

  function reportMessage(m: ChatMessage) {
    show(
      REPORT_REASONS.map((r) => ({
        label: r.label,
        onPress: () => {
          reportContent(supabase, userId, { targetType: "message", targetId: m.id, reason: r.value }).then(
            () => Alert.alert("Thanks for letting us know", "Our team will review this message."),
            (e) => alertWithHaptic("error", "Couldn't send the report", errorText(e)),
          );
        },
      })),
      "Why are you reporting this message?",
    );
  }

  function messageActions(m: ChatMessage) {
    if (m.pending) return;
    hapticTap();
    if (m.failed) {
      show(
        [
          { label: "Try again", icon: "refresh", onPress: () => void deliver(m) },
          { label: "Edit", icon: "create-outline", onPress: () => editFailed(m) },
          { label: "Delete", icon: "trash-outline", destructive: true, onPress: () => discard(m) },
        ],
        m.error ?? "This message wasn't sent.",
      );
      return;
    }
    // The menu is headed by the message's exact time (a hold is the other way to see it, for photos and the like).
    const when = formatMessageTime(m.created_at);
    const snap = snapOf(m.snap);
    // A Snap's story is a hold away too; its sender can take a waiting one back.
    const snapActions = snap ? [{ label: "Snap activity", icon: "eye-outline" as const, onPress: () => openSnapActivity(m) }] : [];
    const deleteSnapAction = snap && m.sender_id === userId && snapState(snap) === "new" ? [{ label: "Delete Snap", icon: "trash-outline" as const, destructive: true, onPress: () => removeSnap(m) }] : [];
    // A sent message of mine offers only Reply: deleting it would leave its text in the inbox and in the other side's chat.
    if (m.sender_id === userId) {
      show([{ label: "Reply", icon: "arrow-undo-outline", onPress: () => startReply(m) }, ...snapActions, ...deleteSnapAction], when);
      return;
    }
    show(
      [
        { label: "Reply", icon: "arrow-undo-outline", onPress: () => startReply(m) },
        ...snapActions,
        { label: "Report message", icon: "flag-outline", destructive: true, onPress: () => reportMessage(m) },
      ],
      when,
    );
  }

  // Rows get one stable handler, so typing in the message field never re-renders the list.
  const actionsRef = useRef(messageActions);
  actionsRef.current = messageActions;
  const onActions = useCallback((m: ChatMessage) => actionsRef.current(m), []);

  // ---------------------------------------------------------------------------
  // Opening things.
  // ---------------------------------------------------------------------------
  const openMedia = useCallback(
    (m: ChatMessage, index: number) => {
      const items: MediaViewerItem[] = [];
      let start = 0;
      messageMedia(m, resolveMedia).forEach((media, i) => {
        if (!media.uri) return;
        if (i === index) start = items.length;
        items.push({ kind: media.kind, uri: media.uri, cacheKey: media.cacheKey });
      });
      if (items.length === 0) return;
      Keyboard.dismiss();
      setViewer({ items, index: start });
    },
    [resolveMedia],
  );
  const openFile = useCallback((attachment: MessageAttachment) => void openMessageFile(attachment, colors.brand), [colors.brand]);
  const openSnapViewer = useCallback(
    (m: ChatMessage) => {
      const snap = snapOf(m.snap);
      if (!snap) return;
      Keyboard.dismiss();
      router.push({ pathname: "/snap/[id]", params: { id: snap.id } });
    },
    [router],
  );
  // A Snap opened on this device (or found expired or gone, or captured) changes its bubble before the database's
  // update arrives; the activity entry is added once (the database's own copy replaces it when it comes).
  useEffect(
    () =>
      onSnapChange(({ snapId, patch, activity }) => {
        setMessages((prev) =>
          prev.map((m) => {
            const snap = snapOf(m.snap);
            if (!snap || snap.id !== snapId) return m;
            const list = snap.activity ?? [];
            const withActivity = activity && !list.some((a) => a.type === activity.type && a.at === activity.at) ? [...list, activity] : list;
            return { ...m, snap: { ...snap, ...patch, opened_at: snap.opened_at ?? patch.opened_at ?? null, activity: withActivity.length > 0 ? withActivity : undefined } };
          }),
        );
      }),
    [],
  );

  // Snaps from other people that just reached this device: "Delivered" goes on their activity, once each.
  useEffect(() => {
    for (const m of messages) {
      const snap = snapOf(m.snap);
      if (!snap || m.sender_id === userId || delivered.current.has(snap.id) || snapState(snap) !== "new") continue;
      if ((snap.activity ?? []).some((a) => a.type === "delivered")) continue;
      delivered.current.add(snap.id);
      snapDelivered(supabase, snap.id).catch(() => delivered.current.delete(snap.id));
    }
  }, [messages, userId]);

  const openSnapActivity = useCallback((m: ChatMessage) => setActivityFor(m), []);
  const activityMessage = activityFor ? (messages.find((m) => m.id === activityFor.id) ?? activityFor) : null;
  const activitySnap = activityMessage ? snapOf(activityMessage.snap) : null;

  /** The sender takes a waiting Snap back: every chat it went to says "Snap deleted". */
  function removeSnap(m: ChatMessage) {
    const snap = snapOf(m.snap);
    if (!snap) return;
    alertWithHaptic("warning", "Delete this Snap?", "It will be taken back before it is opened, and the chat will say it was deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setActivityFor(null);
          deleteSnap(supabase, snap.id).catch((e) => alertWithHaptic("error", "Couldn't delete the Snap", errorText(e)));
        },
      },
    ]);
  }
  const openProfile = useCallback((profileId: string) => router.push({ pathname: "/profile/[id]", params: { id: profileId } }), [router]);
  const openInfo = useCallback(() => {
    Keyboard.dismiss();
    router.push({ pathname: "/messages/info/[id]", params: { id: conversation.id } });
  }, [router, conversation.id]);

  // ---------------------------------------------------------------------------
  // Calls: the bar's Audio call and Video call, a call's row tapped (call back, or join), and the banner for a call
  // going on in this chat that I am not in (kept up with the chat's calls over realtime).
  // ---------------------------------------------------------------------------
  const { place, join } = useCalls();
  const [liveCall, setLiveCall] = useState<CallRecord | null>(null);
  useEffect(() => {
    // Paused calls (CALLS_PAUSED): no call goes on, so nothing to look for and no Join banner.
    if (CALLS_PAUSED) return;
    let alive = true;
    const look = () =>
      currentCall(supabase, conversation.id)
        .then((c) => {
          if (alive) setLiveCall(c);
        })
        .catch(() => {});
    look();
    const channel = supabase
      .channel(`chat-calls:${conversation.id}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `conversation_id=eq.${conversation.id}` }, () => look())
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [conversation.id]);
  const inLiveCall = liveCall?.participants.some((p) => p.user_id === userId && p.state === "joined") ?? false;
  const canCall = block === "none";
  const startAudioCall = useCallback(() => {
    Keyboard.dismiss();
    void place(conversation.id, "audio");
  }, [place, conversation.id]);
  const startVideoCall = useCallback(() => {
    Keyboard.dismiss();
    void place(conversation.id, "video");
  }, [place, conversation.id]);
  const onCall = useCallback(
    (call: MessageCall) => {
      if (call.status === "ended") void place(conversation.id, call.kind);
      else void join(call.id, call.kind);
    },
    [place, join, conversation.id],
  );

  // ---------------------------------------------------------------------------
  // Receipts: seen-avatars under the last message each other member read; sent/delivered under my newest.
  // ---------------------------------------------------------------------------
  const others = useMemo(
    () =>
      conversation.otherMembers
        .map((m) => ({ member: m, status: memberStatus[m.id] }))
        .filter((x): x is { member: ProfileSummary; status: MemberStatus } => Boolean(x.status)),
    [conversation.otherMembers, memberStatus],
  );
  const seenAt = useMemo(() => {
    const seen = new Map<string, ProfileSummary[]>();
    for (const { member, status } of others) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (!m.pending && !m.failed && m.sender_id !== member.id && m.created_at <= status.lastReadAt) {
          seen.set(m.id, [...(seen.get(m.id) ?? []), member]);
          break;
        }
      }
    }
    return seen;
  }, [others, messages]);
  const lastMine = useMemo(() => [...messages].reverse().find((m) => m.sender_id === userId && !m.failed), [messages, userId]);
  const receipt = useMemo(
    () => (lastMine ? (lastMine.pending ? ("sending" as const) : receiptFor(lastMine.created_at, others.map((o) => o.status))) : null),
    [lastMine, others],
  );
  const subtitle = isGroup ? `${conversation.members.length} members` : (activity.line?.label ?? "");

  // Newest first: the list is inverted, so it opens at the bottom and stays there as the keyboard comes and goes.
  const data = useMemo(() => [...messages].reverse(), [messages]);
  const renderItem = useCallback<ListRenderItem<ChatMessage>>(
    ({ item: m, index }) => {
      const i = messages.length - 1 - index;
      const previous = messages[i - 1];
      const next = messages[i + 1];
      const mine = m.sender_id === userId;
      // A stamp above the first message of a day and above any message after half an hour's quiet.
      const stamp = !previous || !isSameDay(previous.created_at, m.created_at) || Date.parse(m.created_at) - Date.parse(previous.created_at) >= STAMP_GAP_MS;
      const arrived = arriving.current.get(m.id);
      return (
        <MessageRow
          message={m}
          mine={mine}
          isGroup={isGroup}
          stamp={stamp}
          firstInGroup={!previous || stamp || !sameRun(previous, m)}
          lastInGroup={!next || !isSameDay(m.created_at, next.created_at) || !sameRun(m, next)}
          receipt={mine && lastMine?.id === m.id ? receipt : null}
          seenBy={seenAt.get(m.id)}
          revealed={revealedId === m.id}
          highlighted={highlightId === m.id}
          appear={arrived !== undefined && Date.now() - arrived < APPEAR_FOR_MS}
          mediaWidth={mediaWidth}
          resolveMedia={resolveMedia}
          resolveReply={resolveReply}
          onOpenMedia={openMedia}
          onOpenFile={openFile}
          onOpenSnap={openSnapViewer}
          onSnapActivity={openSnapActivity}
          onCall={onCall}
          onActions={onActions}
          onReply={startReply}
          onReveal={revealTime}
          onJumpTo={jumpFromQuote}
          onPressSender={openProfile}
        />
      );
    },
    [messages, userId, isGroup, lastMine, receipt, seenAt, highlightId, revealedId, mediaWidth, resolveMedia, resolveReply, openMedia, openFile, openSnapViewer, openSnapActivity, onCall, onActions, startReply, revealTime, jumpFromQuote, openProfile],
  );

  const notice =
    block === "byMe"
      ? { title: `You blocked ${firstName(other?.full_name)}`, body: "Unblock them to send messages in this chat.", action: { label: "Unblock", onPress: unblock } }
      : block === "byThem"
        ? { title: "You can't reply to this conversation", body: "This account isn't available to you." }
        : null;

  return (
    <View ref={rootRef} onLayout={measure} collapsable={false} style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "web" ? undefined : "padding"} keyboardVerticalOffset={keyboardOffset}>
        {/* The list runs under the floating bar (and under the header above), keeping that much of its ends clear;
            the list is inverted, so its paddingTop is at the bottom of the screen and its paddingBottom at the top. */}
        <FlatList
          ref={listRef}
          data={data}
          inverted
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          style={[styles.flex, { marginBottom: -barHeight }]}
          contentContainerStyle={[styles.list, { paddingTop: barHeight + 6, paddingBottom: headerHeight + 6 }]}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          onScroll={(e) => {
            offsetRef.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={64}
          onEndReached={() => {
            if (loaded) void loadOlder();
          }}
          onEndReachedThreshold={0.4}
          onScrollToIndexFailed={onScrollToIndexFailed}
          initialNumToRender={20}
          windowSize={15}
          ListFooterComponent={loadingOlder ? <ActivityIndicator style={styles.older} color={colors.brand} /> : undefined}
          ListEmptyComponent={
            !loaded ? (
              <View style={styles.emptyBox}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : loadError ? (
              <View style={styles.errorBox}>
                <ErrorBanner message={loadError} onRetry={() => void loadInitial()} />
              </View>
            ) : (
              <Text style={styles.empty}>This is the start of your conversation. Say hello 👋</Text>
            )
          }
        />
        {notice ? (
          <ComposerNotice title={notice.title} body={notice.body} action={"action" in notice ? notice.action : undefined} onHeight={setBarHeight} />
        ) : (
          <Composer
            value={text}
            onChangeText={setText}
            items={picked}
            onAddItems={addPicked}
            onRemoveItem={removePicked}
            onSend={send}
            onSendVoice={sendVoice}
            reply={composerReply}
            onCancelReply={cancelReply}
            inputRef={inputRef}
            onHeight={setBarHeight}
          />
        )}
      </KeyboardAvoidingView>
      <ChatHeader
        conversation={conversation}
        subtitle={subtitle}
        activeNow={activeNow}
        keepSubtitleRoom={activity.waiting}
        onBack={onBack}
        onOpenInfo={openInfo}
        onAudioCall={canCall ? startAudioCall : undefined}
        onVideoCall={canCall ? startVideoCall : undefined}
        onHeight={setHeaderHeight}
      />
      {liveCall && !inLiveCall && canCall ? <CallBanner call={liveCall} top={headerHeight + 4} onJoin={() => void join(liveCall.id, liveCall.kind)} /> : null}
      <MediaViewer visible={viewer !== null} items={viewer?.items ?? []} index={viewer?.index ?? 0} onClose={() => setViewer(null)} />
      <SnapActivitySheet
        snap={activitySnap}
        mine={activityMessage?.sender_id === userId}
        sentAt={activityMessage?.created_at ?? null}
        visible={activityFor !== null}
        onClose={() => setActivityFor(null)}
        onDelete={activityMessage ? () => removeSnap(activityMessage) : undefined}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  list: { paddingHorizontal: 12 },
  older: { marginVertical: 12 },
  emptyBox: { padding: 24, alignItems: "center" },
  errorBox: { padding: 16 },
  empty: { textAlign: "center", color: colors.muted, padding: 24 },
}));
