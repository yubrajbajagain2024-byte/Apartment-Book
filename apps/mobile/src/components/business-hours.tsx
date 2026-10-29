import { useEffect, useState } from "react";
import { LayoutAnimation, Pressable, Text, View } from "react-native";
import { businessHoursStatus, HOURS_TIMEZONES, hoursWeekRows, upcomingSpecialHours, type BusinessHours, type HoursStatus } from "@apartment-book/shared";
import { Icon } from "@/components/icon";
import { radius, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/**
 * A business's hours on its profile, as the website shows them: whether it is open now (in the business's own time
 * zone, worked out again every half minute), and a tap opens the week, today in bold, with the special hours coming up.
 * When this device cannot work out the time there, it shows the week without a status.
 */
export function BusinessHoursBlock({ hours }: { hours: BusinessHours }) {
  const colors = useColors();
  const styles = useStyles();
  const [now, setNow] = useState(() => new Date());
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const status = businessHoursStatus(hours, now);
  const tone: Record<HoursStatus["tone"], string> = { open: colors.successText, soon: colors.warningText, closed: colors.dangerText };
  const rows = hoursWeekRows(hours, status?.today ?? null);
  const specials = status ? upcomingSpecialHours(hours, status.date) : [];
  const zone = HOURS_TIMEZONES.find((t) => t.value === hours.timezone)?.label ?? hours.timezone;

  return (
    <View style={styles.box} testID="business-hours">
      <Pressable
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setExpanded((e) => !e);
        }}
        style={styles.summary}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={status ? `${status.label}${status.detail ? `, ${status.detail}` : ""}. Hours` : "Hours"}
      >
        <Icon name="time-outline" size={17} color={colors.muted} />
        <Text style={styles.line} numberOfLines={1}>
          {status ? (
            <>
              <Text style={{ color: tone[status.tone], fontWeight: "700" }}>{status.label}</Text>
              {status.detail ? <Text style={{ color: colors.text }}>{` · ${status.detail}`}</Text> : null}
            </>
          ) : (
            <Text style={{ color: colors.text, fontWeight: "700" }}>Hours</Text>
          )}
        </Text>
        {status?.special ? (
          <Text style={styles.special} numberOfLines={1}>
            {status.special}
          </Text>
        ) : null}
        <Icon name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.muted} />
      </Pressable>
      {expanded ? (
        <View style={styles.body}>
          {rows.map((r) => (
            <View key={r.day} style={styles.row}>
              <Text style={[styles.day, r.today && styles.today]}>{r.label}</Text>
              <Text style={[styles.time, r.today && styles.today, r.text === "Closed" && !r.today && { color: colors.muted }]}>{r.text}</Text>
            </View>
          ))}
          {specials.length ? (
            <View style={styles.specials}>
              <Text style={styles.heading}>HOLIDAY HOURS</Text>
              {specials.map((s) => (
                <View key={s.date} style={styles.row}>
                  <Text style={styles.day} numberOfLines={1}>
                    {s.dateLabel}
                    {s.label ? <Text style={{ color: colors.muted }}>{` · ${s.label}`}</Text> : null}
                  </Text>
                  <Text style={[styles.time, s.text === "Closed" && { color: colors.dangerText, fontWeight: "600" }]}>{s.text}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text style={styles.zone}>Times in {zone}.</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  box: { alignSelf: "stretch", borderRadius: radius.lg, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  summary: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: 11 },
  line: { flex: 1, fontSize: 15 },
  special: { maxWidth: 140, fontSize: 12, fontWeight: "600", color: colors.warningText, backgroundColor: colors.warningSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  body: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.md, gap: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  day: { flexShrink: 1, fontSize: 14, color: colors.muted },
  time: { fontSize: 14, color: colors.text, fontVariant: ["tabular-nums"], textAlign: "right" },
  today: { color: colors.text, fontWeight: "700" },
  specials: { marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 },
  heading: { fontSize: 11, fontWeight: "700", letterSpacing: 1, color: colors.muted },
  zone: { marginTop: space.xs, fontSize: 12, color: colors.muted },
}));
