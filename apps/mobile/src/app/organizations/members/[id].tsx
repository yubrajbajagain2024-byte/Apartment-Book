import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { addOrganizationMember, listOrganizationMembers, removeOrganizationMember, searchPeople, type OrganizationMemberWithProfile, type PosterSummary } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { Badge, Button, Field, Loading } from "@/components/ui";
import { alertWithHaptic, hapticSuccess } from "@/lib/haptics";
import { errorText, useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { radius, space, textStyle } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/**
 * Who runs an organization: owners (they change the organization, its members and its events) and editors (its
 * events). An owner adds people by name, makes an editor an owner or the other way round, and removes anyone; the
 * database keeps at least one owner and lets anyone leave. Others see the list alone.
 */
export default function OrganizationMembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useStyles();
  const colors = useColors();
  const { user } = useSession();
  const members = useQuery(() => listOrganizationMembers(supabase, id), [id]);
  const rows: OrganizationMemberWithProfile[] = members.data ?? [];
  const myRole = rows.find((m) => m.user_id === user?.id)?.role;
  const owner = myRole === "owner";
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PosterSummary[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const memberIds = rows.map((m) => m.user_id);
  useEffect(() => {
    if (!owner || q.trim().length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      void searchPeople(supabase, q.trim(), { excludeIds: memberIds, limit: 10 })
        .then((people) => live && setResults(people))
        .catch(() => live && setResults([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // The member list changes only through the actions below, which read it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, owner, memberIds.join(",")]);

  async function run(userId: string, work: () => Promise<void>) {
    setBusyId(userId);
    try {
      await work();
      hapticSuccess();
      await members.refresh();
    } catch (e) {
      alertWithHaptic("error", "Could not update", errorText(e));
    } finally {
      setBusyId(null);
    }
  }
  function actionsFor(m: OrganizationMemberWithProfile) {
    const isMe = m.user_id === user?.id;
    Alert.alert(m.profile.full_name, m.role === "owner" ? "Owner" : "Editor", [
      { text: m.role === "owner" ? "Make editor" : "Make owner", onPress: () => void run(m.user_id, () => addOrganizationMember(supabase, id, m.user_id, m.role === "owner" ? "editor" : "owner")) },
      { text: isMe ? "Leave" : "Remove", style: "destructive", onPress: () => void run(m.user_id, () => removeOrganizationMember(supabase, id, m.user_id)) },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  if (members.loading && !members.data) return <Loading />;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
      {owner ? (
        <View style={{ gap: space.sm }}>
          <Field label="Add a member" value={q} onChangeText={setQ} placeholder="Search by name" autoCorrect={false} hint="Members publish and edit the organization's events; owners also change the organization and its members." />
          {results.map((p) => (
            <View key={p.id} style={styles.row}>
              <Avatar name={p.full_name} url={p.avatar_url} size={40} userId={p.id} />
              <Text style={styles.name} numberOfLines={1}>
                {p.full_name}
              </Text>
              <Button title="Add" size="compact" icon="person-add-outline" loading={busyId === p.id} onPress={() => void run(p.id, () => addOrganizationMember(supabase, id, p.id, "editor")).then(() => setQ(""))} />
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ gap: space.sm }}>
        <Text style={styles.heading}>{rows.length === 1 ? "1 member" : `${rows.length} members`}</Text>
        {rows.map((m) => (
          <Pressable key={m.user_id} onPress={owner ? () => actionsFor(m) : undefined} disabled={!owner || busyId === m.user_id} accessibilityRole={owner ? "button" : undefined} accessibilityLabel={`${m.profile.full_name}, ${m.role}`} style={({ pressed }) => [styles.row, pressed && owner && { opacity: 0.7 }]}>
            <Avatar name={m.profile.full_name} url={m.profile.avatar_url} size={40} userId={m.user_id} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {m.profile.full_name}
              </Text>
              <Text style={styles.handle} numberOfLines={1}>
                @{m.profile.username}
              </Text>
            </View>
            <Badge label={m.role === "owner" ? "Owner" : "Editor"} tone={m.role === "owner" ? "blue" : "gray"} />
            {owner ? <Icon name="ellipsis-horizontal" size={18} color={colors.faint} /> : null}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  heading: { ...textStyle.footnote, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.card },
  name: { ...textStyle.subheadline, fontWeight: "600", color: colors.text, flex: 1 },
  handle: { ...textStyle.footnote, color: colors.muted },
}));
