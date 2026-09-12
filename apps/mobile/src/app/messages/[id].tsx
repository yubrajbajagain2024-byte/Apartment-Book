import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  formatDayLabel,
  formatMessageTime,
  getConversation,
  getMemberStatus,
  isSameDay,
  listMessages,
  markConversationRead,
  receiptFor,
  recordContact,
  sendMessage,
  timeAgo,
  type ConversationMember,
  type ConversationSummary,
  type MemberStatus,
  type Message,
  type MessageWithSender,
} from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { EmptyState, Loading } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { useIsOnline } from "@/lib/presence";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";

type ChatMessage = MessageWithSender & { pending?: boolean; failed?: boolean };

export default function ChatScreen() {
  const { id, prefill, targetType, targetId } = useLocalSearchParams<{ id: string; prefill?: string; targetType?: string; targetId?: string }>();
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();
  const userId = user?.id ?? "";
  const { data: conversation, loading } = useQuery(() => (userId ? getConversation(supabase, id, userId) : Promise.resolve(null)), [id, userId]);
  useEffect(() => {
    if (!sessionLoading && !user) router.replace("/(auth)/login");
  }, [sessionLoading, user, router]);
  if (sessionLoading || loading || !conversation) return sessionLoading || loading || !user ? <Loading /> : <EmptyState icon="chatbubbles-outline" title="Conversation not found" />;
  return <Chat conversation={conversation} userId={userId} prefill={prefill} contact={targetType && targetId ? { type: targetType as "apartment" | "item" | "roommate", id: targetId } : null} />;
}

function Chat({ conversation, userId, prefill, contact }: { conversation: ConversationSummary; userId: string; prefill?: string; contact: { type: "apartment" | "item" | "roommate"; id: string } | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [memberStatus, setMemberStatus] = useState<Record<string, MemberStatus>>(conversation.memberStatus);
  const [text, setText] = useState("");
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const membersById = useMemo(() => new Map(conversation.members.map((m) => [m.id, m])), [conversation.members]);
  const other = conversation.otherMembers[0];
  const otherOnline = useIsOnline(other?.id);
  const isGroup = conversation.type === "group";

  useEffect(() => {
    listMessages(supabase, conversation.id).then((rows) => {
      setMessages(rows);
      setLoaded(true);
      if (rows.length === 0 && prefill) setText(prefill);
    });
    markConversationRead(supabase, conversation.id).catch(() => {});
    if (contact) recordContact(supabase, contact.type, contact.id).catch(() => {});
    const channel = supabase
      .channel(`conversation:${conversation.id}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversation.id}` }, (payload) => {
        const row = payload.new as Message;
        setMessages((prev) => {
          if (prev.some((m) => m.id === row.id)) return prev;
          const withoutTemp = row.sender_id === userId ? prev.filter((m) => !(m.pending && m.content === row.content)) : prev;
          return [...withoutTemp, { ...row, sender: row.sender_id ? (membersById.get(row.sender_id) ?? null) : null }];
        });
        if (row.sender_id !== userId) markConversationRead(supabase, conversation.id).catch(() => {});
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversation_members", filter: `conversation_id=eq.${conversation.id}` }, (payload) => {
        const row = payload.new as ConversationMember;
        setMemberStatus((prev) => ({ ...prev, [row.user_id]: { lastReadAt: row.last_read_at, lastDeliveredAt: row.last_delivered_at, lastSeenAt: prev[row.user_id]?.lastSeenAt ?? null } }));
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        getMemberStatus(supabase, conversation.id).then((fresh) => setMemberStatus((prev) => ({ ...prev, ...fresh }))).catch(() => {});
        const newest = [...messagesRef.current].reverse().find((m) => !m.pending && !m.failed)?.created_at;
        listMessages(supabase, conversation.id, newest ? { after: newest } : {})
          .then((rows) => {
            if (rows.length === 0) return;
            setMessages((prev) => {
              const fresh = rows.filter((r) => !prev.some((m) => m.id === r.id));
              return fresh.length ? [...prev.filter((m) => !(m.pending && fresh.some((f) => f.content === m.content))), ...fresh].sort((a, b) => a.created_at.localeCompare(b.created_at)) : prev;
            });
          })
          .catch(() => {});
      });
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, userId]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    const tempId = `temp-${Date.now()}`;
    const me = membersById.get(userId) ?? { id: userId, full_name: "You", avatar_url: null };
    setMessages((prev) => [...prev, { id: tempId, conversation_id: conversation.id, sender_id: userId, content: body, image_url: null, created_at: new Date().toISOString(), sender: me, pending: true }]);
    setText("");
    try {
      const saved = await sendMessage(supabase, { conversationId: conversation.id, senderId: userId, content: body });
      setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev.filter((m) => m.id !== tempId) : prev.map((m) => (m.id === tempId ? { ...saved, sender: saved.sender ?? me } : m))));
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)));
    }
  }

  // Receipts: seen-avatars under the last message each other member read; sent/delivered under my newest.
  const others = conversation.otherMembers.map((m) => ({ member: m, status: memberStatus[m.id] })).filter((x): x is { member: (typeof conversation.otherMembers)[number]; status: MemberStatus } => Boolean(x.status));
  const seenAt = new Map<string, typeof conversation.otherMembers>();
  for (const { member, status } of others) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m.pending && !m.failed && m.sender_id !== member.id && m.created_at <= status.lastReadAt) {
        seenAt.set(m.id, [...(seenAt.get(m.id) ?? []), member]);
        break;
      }
    }
  }
  const lastMine = [...messages].reverse().find((m) => m.sender_id === userId && !m.failed);
  const receipt = lastMine ? (lastMine.pending ? "sending" : receiptFor(lastMine.created_at, others.map((o) => o.status))) : null;
  const lastSeen = other ? memberStatus[other.id]?.lastSeenAt : null;
  const subtitle = isGroup ? `${conversation.members.length} members` : otherOnline ? "Active now" : lastSeen ? `Active ${timeAgo(lastSeen)}` : "";

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.card }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {!isGroup ? <Avatar name={other?.full_name} url={other?.avatar_url} size="sm" userId={other?.id} /> : null}
              <View>
                <Text style={{ fontWeight: "700", fontSize: 16, color: colors.text }}>{conversation.title}</Text>
                {subtitle ? <Text style={{ fontSize: 11, color: otherOnline ? colors.green : colors.muted }}>{subtitle}</Text> : null}
              </View>
            </View>
          ),
        }}
      />
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12, gap: 2 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: loaded })}
        ListEmptyComponent={loaded ? <Text style={{ textAlign: "center", color: colors.muted, padding: 24 }}>This is the start of your conversation. Say hello 👋</Text> : null}
        renderItem={({ item: m, index }) => {
          const previous = messages[index - 1];
          const mine = m.sender_id === userId;
          const showDay = !previous || !isSameDay(previous.created_at, m.created_at);
          const continued = previous && previous.sender_id === m.sender_id && !showDay;
          const seenBy = seenAt.get(m.id);
          return (
            <View>
              {showDay ? <Text style={styles.day}>{formatDayLabel(m.created_at)}</Text> : null}
              <View style={[styles.line, mine ? { flexDirection: "row-reverse" } : null]}>
                {!mine ? <View style={{ width: 32 }}>{!continued ? <Avatar name={m.sender?.full_name} url={m.sender?.avatar_url} size="sm" /> : null}</View> : null}
                <View style={{ maxWidth: "75%", alignItems: mine ? "flex-end" : "flex-start" }}>
                  {!mine && isGroup && !continued ? <Text style={styles.sender}>{m.sender?.full_name ?? "Unknown"}</Text> : null}
                  <View style={[styles.bubble, mine ? styles.mine : styles.theirs, m.pending && { opacity: 0.6 }, m.failed && { backgroundColor: "#fdecec" }]}>
                    <Text style={{ color: mine && !m.failed ? "#fff" : colors.text, fontSize: 15 }}>{m.content}</Text>
                  </View>
                  <Text style={styles.time}>{m.failed ? "Failed to send" : m.pending ? "Sending…" : formatMessageTime(m.created_at)}</Text>
                </View>
                {mine && lastMine?.id === m.id && receipt && receipt !== "seen" ? (
                  <View style={styles.receipt} accessibilityLabel={receipt === "sending" ? "Sending" : receipt === "sent" ? "Sent" : "Delivered"}>
                    {receipt === "sending" ? <Ionicons name="ellipse-outline" size={13} color={colors.faint} /> : receipt === "sent" ? <Ionicons name="checkmark-circle-outline" size={14} color={colors.faint} /> : <Ionicons name="checkmark-circle" size={14} color={colors.faint} />}
                  </View>
                ) : null}
              </View>
              {seenBy ? (
                <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 2, paddingRight: 2 }} accessibilityLabel={`Seen by ${seenBy.map((p) => p.full_name).join(", ")}`}>
                  {seenBy.map((p) => (
                    <Avatar key={p.id} name={p.full_name} url={p.avatar_url} size="xs" />
                  ))}
                </View>
              ) : null}
            </View>
          );
        }}
      />
      <View style={styles.composer}>
        <TextInput value={text} onChangeText={setText} placeholder="Aa" placeholderTextColor={colors.faint} multiline maxLength={4000} style={styles.input} accessibilityLabel="Message" />
        <Pressable onPress={send} disabled={!text.trim()} style={[styles.send, !text.trim() && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Send">
          <Ionicons name="send" size={18} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  day: { textAlign: "center", fontSize: 11, color: colors.faint, marginVertical: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  line: { flexDirection: "row", alignItems: "flex-end", gap: 6, marginTop: 2 },
  sender: { fontSize: 11, color: colors.muted, marginLeft: 4, marginBottom: 2 },
  bubble: { borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  mine: { backgroundColor: colors.brand },
  theirs: { backgroundColor: colors.input },
  time: { fontSize: 10, color: colors.faint, marginTop: 2, marginHorizontal: 4 },
  receipt: { width: 16, alignItems: "center", marginBottom: 16 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.card },
  input: { flex: 1, backgroundColor: colors.input, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 120, color: colors.text },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
});
