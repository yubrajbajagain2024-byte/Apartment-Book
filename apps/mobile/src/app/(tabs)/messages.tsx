import { useCallback, useEffect } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { listConversations, timeAgo, type ConversationSummary } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Button, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";

export default function MessagesScreen() {
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();
  const userId = user?.id ?? null;
  const { data, error, loading, refresh } = useQuery(() => (userId ? listConversations(supabase, userId) : Promise.resolve([] as ConversationSummary[])), [userId]);

  useFocusEffect(
    useCallback(() => {
      if (userId) void refresh();
    }, [userId, refresh]),
  );
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`chats:${userId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => void refresh())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => void refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  if (!sessionLoading && !user) {
    return <EmptyState icon="chatbubbles-outline" title="Log in to see your messages" action={<Button title="Log in" onPress={() => router.push("/(auth)/login")} />} />;
  }
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={data ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingVertical: 8 }}
        renderItem={({ item: c }) => {
          const other = c.otherMembers[0];
          return (
            <Pressable onPress={() => router.push({ pathname: "/messages/[id]", params: { id: c.id } })} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.border }]} accessibilityLabel={`Chat with ${c.title}`}>
              {c.type === "group" ? (
                <View style={styles.groupAvatar}>
                  <Ionicons name="people" size={22} color={colors.brand} />
                </View>
              ) : (
                <Avatar name={other?.full_name} url={other?.avatar_url} size="lg" userId={other?.id} />
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={[styles.title, c.unreadCount > 0 && { fontWeight: "800" }]} numberOfLines={1}>
                    {c.title}
                  </Text>
                  {c.lastMessageAt ? <Text style={styles.time}>{timeAgo(c.lastMessageAt)}</Text> : null}
                </View>
                <Text style={[styles.preview, c.unreadCount > 0 && { color: colors.text, fontWeight: "600" }]} numberOfLines={1}>
                  {c.lastMessagePreview ?? "Say hello 👋"}
                </Text>
              </View>
              {c.unreadCount > 0 ? (
                <View style={styles.unread}>
                  <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{c.unreadCount}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={loading ? <Loading /> : error ? <ErrorBanner message={error} onRetry={refresh} /> : <EmptyState icon="chatbubbles-outline" title="No chats yet" body="Message someone from a post, or start a new chat." />}
      />
      <Pressable onPress={() => router.push("/messages/new")} style={styles.fab} accessibilityRole="button" accessibilityLabel="New message">
        <Ionicons name="create-outline" size={24} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  groupAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "600", color: colors.text, flexShrink: 1 },
  time: { fontSize: 12, color: colors.muted },
  preview: { fontSize: 14, color: colors.muted },
  unread: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  fab: { position: "absolute", right: 16, bottom: 20, width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", elevation: 5 },
});
