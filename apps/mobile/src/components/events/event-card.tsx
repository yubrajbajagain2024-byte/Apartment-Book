import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { categoryLabel, eventWhen, isEventLive, type EventSummary } from "@apartment-book/shared";
import { Icon, useBounceOn } from "@/components/icon";
import { savedEvents } from "@/lib/event-saves-store";
import { alertWithHaptic, hapticLike, hapticSelect } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { auroraGradient, radius, space, textStyle } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { categoryIcon } from "./event-glyphs";

/** The square picture at the left of a row. */
export const THUMB = 72;

/** The bookmark's handler every list shares: flips the shared set (optimistically) and asks a signed-out person to log in. */
export function useToggleSavedEvent(): (event: Pick<EventSummary, "id">) => void {
  const { user } = useSession();
  const router = useRouter();
  return useCallback(
    (event: Pick<EventSummary, "id">) => {
      if (!user) return router.push("/(auth)/login");
      void savedEvents.toggle(user.id, event.id).then((on) => (on ? hapticLike() : hapticSelect())).catch((e) => alertWithHaptic("error", "Could not save", errorText(e)));
    },
    [user, router],
  );
}

/** "Cancelled", "Awaiting verification", "Hidden": the state of an event that is not simply on. */
export function EventStatusPill({ status }: { status: EventSummary["status"] }) {
  const styles = useStyles();
  if (status === "scheduled") return null;
  const look = status === "cancelled" ? styles.pillDanger : status === "pending" ? styles.pillWarning : styles.pillMuted;
  const text = status === "cancelled" ? styles.pillDangerText : status === "pending" ? styles.pillWarningText : styles.pillMutedText;
  return (
    <View style={[styles.pill, look]}>
      <Text style={[styles.pillText, text]}>{status === "cancelled" ? "Cancelled" : status === "pending" ? "Awaiting verification" : "Hidden"}</Text>
    </View>
  );
}

/** The category's glyph on the aurora: what stands in for a picture. */
export function EventGlyph({ category, size, iconSize }: { category: string; size: number; iconSize: number }) {
  const colors = useColors();
  const glyph = categoryIcon(category);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft, experimental_backgroundImage: auroraGradient(colors.auroraPanel, 135) }}>
      <Icon name={glyph.name} sf={glyph.sf} size={iconSize} color={colors.auroraInk} />
    </View>
  );
}

/**
 * One event in a list, compact and quick to scan: the picture (or the category's glyph) at the left; the title, when it
 * is on the campus's clock (`withDay` off under a day heading), where, and who is holding it with the category; the
 * bookmark at the right, filled when saved. A cancelled event keeps its row, greyed and marked, so nobody turns up; an
 * organization's event awaiting verification shows only to its members, marked. A tap opens the event's page.
 * Memoized: a list re-renders a row only when its event or its saved state changes.
 */
export const EventCard = memo(function EventCard({ event, timeZone, withDay = true, saved, onToggleSave }: { event: EventSummary; timeZone: string; withDay?: boolean; saved: boolean; onToggleSave: (event: EventSummary) => void }) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const bounce = useBounceOn(saved);
  const now = Date.now();
  const cancelled = event.status === "cancelled";
  const live = !cancelled && isEventLive(event, now);
  const when = eventWhen(event, timeZone, now, { withDay });
  const host = event.organization?.name ?? (event.source === "feed" ? "Campus calendar" : null);
  const verified = event.organization?.verified ?? false;
  const open = () => router.push({ pathname: "/events/[id]", params: { id: event.id } } as never);
  return (
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${event.title}, ${when}${event.location ? `, ${event.location}` : ""}`} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={styles.thumb}>{event.image_url ? <Image source={{ uri: event.image_url }} recyclingKey={event.id} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : <EventGlyph category={event.category} size={THUMB} iconSize={28} />}</View>
      <View style={styles.body}>
        {event.status !== "scheduled" ? <EventStatusPill status={event.status} /> : null}
        <Text style={[styles.title, cancelled && styles.titleCancelled]} numberOfLines={2}>
          {event.title}
        </Text>
        <View style={styles.line}>
          {live ? <View style={styles.liveDot} /> : null}
          <Text style={[styles.when, cancelled && { color: colors.muted }]} numberOfLines={1}>
            {live ? `Now · ${when}` : when}
          </Text>
        </View>
        {event.location ? (
          <View style={styles.line}>
            <Icon name="location-outline" size={13} color={colors.muted} />
            <Text style={styles.meta} numberOfLines={1}>
              {event.location}
            </Text>
          </View>
        ) : null}
        <View style={styles.line}>
          {host ? (
            <Text style={[styles.meta, styles.host]} numberOfLines={1}>
              {host}
            </Text>
          ) : null}
          {verified ? <Icon name="checkmark-circle" sf="checkmark.seal.fill" size={12} color={colors.brand} accessibilityLabel="Verified organization" /> : null}
          <Text style={styles.meta} numberOfLines={1}>
            {host ? " · " : ""}
            {categoryLabel(event.category)}
          </Text>
        </View>
      </View>
      <Pressable onPress={() => onToggleSave(event)} hitSlop={8} accessibilityRole="button" accessibilityLabel={saved ? "Saved" : "Save"} accessibilityState={{ selected: saved }} style={styles.bookmark}>
        <Icon name={saved ? "bookmark" : "bookmark-outline"} size={22} color={saved ? colors.brand : colors.muted} bounce={bounce} />
      </Pressable>
    </Pressable>
  );
});

const useStyles = makeStyles((colors) => ({
  card: { flexDirection: "row", gap: space.md, padding: space.md, marginHorizontal: space.lg, backgroundColor: colors.card, borderRadius: 18, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  cardPressed: { opacity: 0.85 },
  thumb: { width: THUMB, height: THUMB, borderRadius: 14, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.skeleton },
  body: { flex: 1, gap: 3, justifyContent: "center" },
  title: { ...textStyle.headline, color: colors.text },
  titleCancelled: { color: colors.muted },
  line: { flexDirection: "row", alignItems: "center", gap: 4 },
  when: { ...textStyle.subheadline, fontWeight: "600", color: colors.brand, flexShrink: 1 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green, marginRight: 2 },
  meta: { ...textStyle.footnote, color: colors.muted, flexShrink: 1 },
  host: { flexShrink: 1 },
  bookmark: { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginRight: -6, marginTop: -4 },
  pill: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, marginBottom: 2 },
  pillText: { ...textStyle.caption1, fontWeight: "700" },
  pillDanger: { backgroundColor: colors.dangerSoft },
  pillDangerText: { color: colors.dangerText },
  pillWarning: { backgroundColor: colors.warningSoft },
  pillWarningText: { color: colors.warningText },
  pillMuted: { backgroundColor: colors.border },
  pillMutedText: { color: colors.muted },
}));
