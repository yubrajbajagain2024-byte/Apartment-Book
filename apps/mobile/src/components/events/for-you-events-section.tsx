import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View, type FlatList } from "react-native";
import { useRouter } from "expo-router";
import { eventDateRange, FOR_YOU_EVENTS_POOL, getForYouContext, listEvents, listOrganizations, rankEvents, setEventInterests, type EventCategory, type EventSummary, type ForYouContext, type Organization } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { ErrorBanner, Loading, useAppearingCells } from "@/components/ui";
import { AnimatedFlatList, listInset } from "@/lib/collapsing-header";
import { savedEvents } from "@/lib/event-saves-store";
import { refreshWithHaptic } from "@/lib/haptics";
import { useQuery } from "@/lib/hooks";
import { organizationFollows } from "@/lib/organization-follows-store";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useTabBarInset } from "@/lib/tab-bar";
import { useTabReselect } from "@/lib/tab-reselect";
import { radius, space, textStyle } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { EventCard, useToggleSavedEvent } from "./event-card";
import { EventsEmpty, iso, RowGap, type EventsPageProps } from "./events-page";
import { InterestChips } from "./interest-chips";
import { OrganizationFollowButton } from "./organization-follow-button";

/** Under this many follows the page still suggests organizations. */
const FEW_FOLLOWS = 3;
const NO_CONTEXT: ForYouContext = {};

/**
 * For you, the Events tab's first page: the campus's upcoming events in the order the ranking puts them for this person
 * (rankEvents in packages/shared: picked interests, what they keep saving and opening, the organizations they follow,
 * how soon, how many others saved it), narrowed by the bar's filters like the All page. Signed out, or with nothing
 * known yet, it is soonest-and-most-saved first. The first time, the page asks what they are into: picking chips saves
 * the interests and re-ranks at once; while they follow few organizations, a row of the campus's to follow sits under it.
 */
export function ForYouEventsSection({ active, topInset, onScroll, universityId, timeZone, q, dateFilter, categories }: EventsPageProps) {
  const colors = useColors();
  const styles = useStyles();
  const router = useRouter();
  const { user } = useSession();
  const me = user?.id ?? null;
  const saved = savedEvents.useIds(me);
  const follows = organizationFollows.useIds(me);
  const toggleSave = useToggleSavedEvent();
  const query = useQuery(async () => {
    const now = Date.now();
    const range = eventDateRange(dateFilter, now, timeZone);
    const [events, ctx] = await Promise.all([
      listEvents(supabase, { universityId, from: iso(range.from), to: iso(range.to), categories, q: q || undefined, limit: FOR_YOU_EVENTS_POOL }),
      me ? getForYouContext(supabase, me).catch(() => NO_CONTEXT) : Promise.resolve(NO_CONTEXT),
    ]);
    return { events, ctx, now };
  }, [me, universityId, timeZone, q, dateFilter, categories]);
  const organizations = useQuery(() => (me ? listOrganizations(supabase, { universityId, limit: 12 }) : Promise.resolve([] as Organization[])), [me, universityId]);

  // The interests as picked on this page, ahead of the next load: the list re-ranks the moment a chip is tapped.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  useEffect(() => {
    setPicked(null);
  }, [me]);
  const interests = picked ?? new Set(query.data?.ctx.interests ?? []);
  const toggleInterest = useCallback(
    (c: EventCategory) => {
      if (!me) return router.push("/(auth)/login");
      const next = new Set(interests);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      setPicked(next);
      void setEventInterests(supabase, me, [...next] as EventCategory[]).catch(() => undefined);
    },
    [me, interests, router],
  );
  // The follows as they are now (the shared set), so following an organization lifts its events at once.
  const ranked = useMemo(() => {
    if (!query.data) return [];
    const ctx: ForYouContext = { ...query.data.ctx, interests: [...interests], followedOrganizationIds: [...follows] };
    return rankEvents(query.data.events, ctx, query.data.now);
  }, [query.data, interests, follows]);

  const inset = useMemo(() => listInset(topInset), [topInset]);
  const listRef = useRef<FlatList<EventSummary>>(null);
  const appearCells = useAppearingCells();
  const tabBar = useTabBarInset();
  useTabReselect(() => listRef.current?.scrollToOffset({ offset: inset.topOffset, animated: true }), active);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([query.refresh(), organizations.refresh(), me ? savedEvents.reload(me) : null]);
    } finally {
      setRefreshing(false);
    }
  }, [query.refresh, organizations.refresh, me]);

  const askInterests = Boolean(me) && query.data !== null && interests.size === 0;
  const suggest = Boolean(me) && follows.size < FEW_FOLLOWS && (organizations.data?.length ?? 0) > 0;
  const header =
    askInterests || suggest ? (
      <View style={styles.header}>
        {askInterests ? (
          <View style={styles.block}>
            <View style={styles.blockHead}>
              <Icon name="sparkles-outline" sf="sparkles" size={16} color={colors.brand} />
              <Text style={styles.blockTitle}>What are you into?</Text>
            </View>
            <Text style={styles.blockHint}>Pick a few and For you follows.</Text>
            <InterestChips picked={interests} onToggle={toggleInterest} />
          </View>
        ) : null}
        {suggest ? (
          <View style={styles.block}>
            <View style={styles.blockHead}>
              <Icon name="people-outline" size={16} color={colors.brand} />
              <Text style={styles.blockTitle}>Organizations to follow</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.orgRow} keyboardShouldPersistTaps="handled">
              {(organizations.data ?? []).map((o) => (
                <View key={o.id} style={styles.orgCard}>
                  <Pressable onPress={() => router.push({ pathname: "/organizations/[id]", params: { id: o.id } } as never)} accessibilityRole="button" accessibilityLabel={o.name} style={({ pressed }) => [styles.orgPerson, pressed && { opacity: 0.7 }]}>
                    <Avatar name={o.name} url={o.avatar_url} size={56} />
                    <View style={styles.orgName}>
                      <Text numberOfLines={1} style={styles.orgNameText}>
                        {o.name}
                      </Text>
                      {o.verified ? <Icon name="checkmark-circle" sf="checkmark.seal.fill" size={12} color={colors.brand} /> : null}
                    </View>
                    <Text numberOfLines={1} style={styles.orgMeta}>
                      {o.follower_count === 1 ? "1 follower" : `${o.follower_count} followers`}
                    </Text>
                  </Pressable>
                  <OrganizationFollowButton organizationId={o.id} compact style={styles.orgFollow} />
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>
    ) : null;
  const filtered = Boolean(q) || categories.length > 0 || dateFilter !== "any";

  return (
    <View style={{ flex: 1 }}>
      <AnimatedFlatList
        ref={listRef}
        data={ranked}
        keyExtractor={(e) => e.id}
        {...inset.list}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 90 + tabBar, paddingTop: inset.paddingTop }}
        CellRendererComponent={appearCells}
        ListHeaderComponent={header ?? undefined}
        renderItem={({ item }) => <EventCard event={item} timeZone={timeZone} saved={saved.has(item.id)} onToggleSave={toggleSave} />}
        ItemSeparatorComponent={RowGap}
        windowSize={9}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={query.loading && !query.data ? <Loading /> : query.error ? <View style={{ paddingHorizontal: 16 }}><ErrorBanner message={query.error} onRetry={() => void query.refresh()} /></View> : <EventsEmpty filtered={filtered} campus={Boolean(universityId)} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshWithHaptic(() => void onRefresh())} progressViewOffset={inset.progressViewOffset} />}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { gap: space.md, paddingTop: space.sm, paddingBottom: space.md },
  block: { marginHorizontal: space.lg, padding: space.md, gap: space.sm, borderRadius: 18, borderCurve: "continuous", backgroundColor: colors.panel },
  blockHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  blockTitle: { ...textStyle.headline, color: colors.text },
  blockHint: { ...textStyle.footnote, color: colors.muted, marginTop: -4 },
  orgRow: { gap: space.sm, paddingVertical: 2 },
  orgCard: { width: 140, padding: space.md, gap: space.sm, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.card, alignItems: "center" },
  orgPerson: { alignItems: "center", gap: 2, alignSelf: "stretch" },
  orgName: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: space.xs, maxWidth: "100%" },
  orgNameText: { fontSize: 14, fontWeight: "700", color: colors.text, textAlign: "center", flexShrink: 1 },
  orgMeta: { fontSize: 12, color: colors.muted, textAlign: "center" },
  orgFollow: { alignSelf: "stretch" },
}));
