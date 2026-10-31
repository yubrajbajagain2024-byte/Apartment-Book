import { useCallback, useRef } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { getOrganization, listEvents, listOrganizationMembers, ORGANIZATION_KINDS, type EventSummary } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { EventCard, useToggleSavedEvent } from "@/components/events/event-card";
import { RowGap } from "@/components/events/events-page";
import { OrganizationFollowButton } from "@/components/events/organization-follow-button";
import { Icon } from "@/components/icon";
import { Button, EmptyState, Loading } from "@/components/ui";
import { useCampusTimeZone } from "@/lib/campus-time-zone";
import { savedEvents } from "@/lib/event-saves-store";
import { useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { radius, space, textStyle } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/**
 * An organization's page: its picture, name and verified seal, what kind it is and how many follow it, its website, a
 * Follow pill and its words; then its upcoming events and the people behind it. A member gets "New event"; an owner
 * also Edit and Members. Pending (unverified) and hidden organizations show to their members and staff alone: the
 * database decides, this only draws what it sent.
 */
export default function OrganizationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const styles = useStyles();
  const colors = useColors();
  const { user } = useSession();
  const org = useQuery(() => getOrganization(supabase, id), [id]);
  const members = useQuery(() => listOrganizationMembers(supabase, id), [id]);
  const events = useQuery(() => listEvents(supabase, { organizationId: id, from: new Date().toISOString(), limit: 50 }), [id]);
  const timeZone = useCampusTimeZone(org.data?.university_id);
  const saved = savedEvents.useIds(user?.id ?? null);
  const toggleSave = useToggleSavedEvent();
  const opened = useRef(false);
  const refreshOrg = org.refresh;
  const refreshMembers = members.refresh;
  const refreshEvents = events.refresh;
  // Back from Edit, Members or a new event: read everything again, quietly (what is on screen stays meanwhile).
  useFocusEffect(
    useCallback(() => {
      if (opened.current) {
        void refreshOrg();
        void refreshMembers();
        void refreshEvents();
      }
      opened.current = true;
    }, [refreshOrg, refreshMembers, refreshEvents]),
  );
  const o = org.data;
  if (org.loading && !o) return <Loading />;
  if (!o) return <EmptyState icon="people-outline" title="This organization is no longer available" />;
  const myRole = members.data?.find((m) => m.user_id === user?.id)?.role;
  const kind = ORGANIZATION_KINDS.find((k) => k.value === o.kind)?.label ?? "Organization";
  const followers = o.follower_count === 1 ? "1 follower" : `${o.follower_count} followers`;
  const upcoming: EventSummary[] = events.data ?? [];

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.identity}>
          <Avatar name={o.name} url={o.avatar_url} size={72} />
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.name} numberOfLines={2}>
                {o.name}
              </Text>
              {o.verified ? <Icon name="checkmark-circle" sf="checkmark.seal.fill" size={20} color={colors.brand} accessibilityLabel="Verified organization" /> : null}
            </View>
            <Text style={styles.meta}>
              {kind} · {followers}
            </Text>
            {o.website ? (
              <Pressable onPress={() => void Linking.openURL(o.website!)} accessibilityRole="link" style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}>
                <Icon name="globe-outline" size={14} color={colors.brand} />
                <Text style={styles.linkText} numberOfLines={1}>
                  {o.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        {!o.verified ? (
          <View style={styles.notice}>
            <Icon name="time-outline" size={16} color={colors.warningText} />
            <Text style={styles.noticeText}>{myRole ? "Awaiting verification by staff: your events show to your members until then." : "Not verified yet."}</Text>
          </View>
        ) : null}
        <View style={styles.buttons}>
          {user?.id ? <OrganizationFollowButton organizationId={o.id} style={{ flex: 1 }} /> : <Button title="Follow" onPress={() => router.push("/(auth)/login")} style={{ flex: 1 }} />}
          {myRole ? <Button title="New event" variant="secondary" icon="add" onPress={() => router.push({ pathname: "/events/new", params: { organization: o.id } } as never)} /> : null}
        </View>
        {myRole === "owner" ? (
          <View style={styles.buttons}>
            <Button title="Edit" variant="secondary" size="compact" icon="create-outline" onPress={() => router.push({ pathname: "/organizations/edit/[id]", params: { id: o.id } } as never)} />
            <Button title="Members" variant="secondary" size="compact" icon="people-outline" onPress={() => router.push({ pathname: "/organizations/members/[id]", params: { id: o.id } } as never)} />
          </View>
        ) : null}
        {o.description ? (
          <Text style={styles.description} selectable>
            {o.description}
          </Text>
        ) : null}
      </View>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        Upcoming
      </Text>
      {upcoming.length === 0 ? (
        <Text style={styles.empty}>{events.loading ? "Loading…" : "Nothing scheduled yet."}</Text>
      ) : (
        upcoming.map((e, i) => (
          <View key={e.id}>
            {i > 0 ? <RowGap /> : null}
            <EventCard event={e} timeZone={timeZone} saved={saved.has(e.id)} onToggleSave={toggleSave} />
          </View>
        ))
      )}
      {(members.data?.length ?? 0) > 0 ? (
        <>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            People
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.people}>
            {(members.data ?? []).map((m) => (
              <Pressable key={m.user_id} onPress={() => router.push({ pathname: "/profile/[id]", params: { id: m.user_id } } as never)} accessibilityRole="button" accessibilityLabel={`${m.profile.full_name}, ${m.role}`} style={({ pressed }) => [styles.person, pressed && { opacity: 0.7 }]}>
                <Avatar name={m.profile.full_name} url={m.profile.avatar_url} size={56} userId={m.user_id} />
                <Text style={styles.personName} numberOfLines={1}>
                  {m.profile.full_name.split(" ")[0]}
                </Text>
                <Text style={styles.personRole}>{m.role === "owner" ? "Owner" : "Editor"}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { padding: space.lg, gap: space.md },
  identity: { flexDirection: "row", alignItems: "center", gap: space.md },
  name: { ...textStyle.title2, color: colors.text, flexShrink: 1 },
  meta: { ...textStyle.subheadline, color: colors.muted },
  link: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  linkText: { ...textStyle.footnote, fontWeight: "600", color: colors.brand, flexShrink: 1 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.warningSoft },
  noticeText: { ...textStyle.footnote, color: colors.warningText, flex: 1 },
  buttons: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  description: { ...textStyle.body, color: colors.text },
  sectionTitle: { ...textStyle.headline, color: colors.text, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  empty: { ...textStyle.subheadline, color: colors.muted, paddingHorizontal: space.lg },
  people: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.sm },
  person: { width: 72, alignItems: "center", gap: 3 },
  personName: { ...textStyle.caption1, fontWeight: "600", color: colors.text },
  personRole: { ...textStyle.caption2, color: colors.muted },
  // Unused for now; kept so a hairline card can frame the header on a later pass without a new style.
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
}));
