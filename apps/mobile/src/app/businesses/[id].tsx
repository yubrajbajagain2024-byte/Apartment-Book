import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  BUSINESS_REPORT_REASONS,
  businessCategoryLabel,
  dealIsLive,
  formatCents,
  formatPrice,
  getPublicBusiness,
  inquiryPrefill,
  isBusinessBlocked,
  listApartmentsByBusiness,
  listPublicBusinessPosts,
  mediaCover,
  mediaItems,
  parseBusinessHours,
  photosFor,
  postKindLabel,
  recordBusinessEvent,
  reportBusiness,
  setBusinessBlocked,
  startBusinessInquiry,
  type BusinessReportReason,
  type DealWithBusiness,
} from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { Avatar } from "@/components/avatar";
import { BusinessHoursBlock } from "@/components/business-hours";
import { Icon } from "@/components/icon";
import { Badge, Button, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { errorText, useQuery } from "@/lib/hooks";
import { openBusinessLink, safeBusinessImage } from "@/lib/safe-media";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { radius, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/**
 * A business's public profile, laid out like a student's: its logo, name and the Business badge (Verified Partner when
 * the UniBuzz team verified it), what it is and where, its bio, whether it is open now with its hours, its website and
 * phone, then its posts and, for housing, its listings. Only approved businesses have one. A student messages it from here (students always write first), reports
 * it or blocks it; opening it counts as a profile visit, from an ad as that ad's.
 */
export default function BusinessProfileScreen() {
  const { id, ad } = useLocalSearchParams<{ id: string; ad?: string }>();
  const { user } = useSession();
  const router = useRouter();
  const colors = useColors();
  const styles = useStyles();
  const show = useActionSheet();
  const { width } = useWindowDimensions();
  const [opened, setOpened] = useState<DealWithBusiness | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery(async () => {
    const business = await getPublicBusiness(supabase, id);
    if (!business) return null;
    const blocked = user ? await isBusinessBlocked(supabase, id) : false;
    const [posts, listings] = blocked ? [[], []] : await Promise.all([listPublicBusinessPosts(supabase, id).catch(() => []), listApartmentsByBusiness(supabase, id).catch(() => [])]);
    return { business, blocked, posts: posts.filter((p) => dealIsLive(p)), listings: listings.filter((l) => l.status === "active") };
  }, [id, user?.id]);

  useEffect(() => {
    if (user && id) void recordBusinessEvent(supabase, "profile_visit", { businessId: id, adId: ad ?? null, placement: ad ? null : "profile" });
  }, [id, ad, user]);

  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBanner message={errorText(q.error)} onRetry={() => void q.refresh()} />;
  if (!q.data) return <EmptyState icon="storefront-outline" title="Not on UniBuzz right now" body="This business isn't approved, or it has left UniBuzz." />;
  const { business, blocked, posts, listings } = q.data;
  const tile = Math.floor((width - space.lg * 2 - 4) / 3);
  const hours = parseBusinessHours(business.hours);
  const website = business.website && /^https?:\/\//i.test(business.website) ? business.website : null;

  async function message(target: { type: "business" | "deal"; id: string; title?: string }) {
    if (!user) return router.push("/(auth)/login" as never);
    if (busy) return;
    setBusy(true);
    try {
      const conv = await startBusinessInquiry(supabase, target.type, target.id);
      router.push({ pathname: "/messages/[id]", params: target.title ? { id: conv, prefill: inquiryPrefill(business.name, target.title) } : { id: conv } });
    } catch (e) {
      Alert.alert("Message", errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function more() {
    show(
      [
        {
          label: `Report ${business.name}`,
          icon: "flag-outline",
          onPress: () =>
            show(
              BUSINESS_REPORT_REASONS.map((r) => ({
                label: r.label,
                onPress: () =>
                  void reportBusiness(supabase, { businessId: business.id }, r.value as BusinessReportReason)
                    .then(() => Alert.alert("Thanks for telling us", "The UniBuzz team will look at it. The business is not told who reported it."))
                    .catch((e) => Alert.alert("Could not report", errorText(e))),
              })),
              `Why are you reporting ${business.name}?`,
            ),
        },
        {
          label: blocked ? `Unblock ${business.name}` : `Block ${business.name}`,
          icon: blocked ? "lock-open-outline" : "ban-outline",
          destructive: !blocked,
          onPress: () =>
            void setBusinessBlocked(supabase, business.id, !blocked)
              .then(() => q.refresh())
              .catch((e) => Alert.alert(blocked ? "Could not unblock" : "Could not block", errorText(e))),
        },
      ],
      business.name,
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 48 }} style={{ backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: business.name }} />
      <View style={styles.header} testID="business-profile">
        <Avatar name={business.name} url={safeBusinessImage(business.logo_url)} size={88} />
        <View style={{ alignItems: "center", gap: 6 }}>
          <Text style={styles.name}>{business.name}</Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
            <Badge label="Business" />
            {business.verified_partner ? <Badge label="Verified Partner" tone="blue" /> : null}
          </View>
          <Text style={styles.meta}>
            {businessCategoryLabel(business.category)}
            {business.city || business.address ? ` · ${[business.address, business.city].filter(Boolean).join(", ")}` : ""}
          </Text>
        </View>
        {business.description ? <Text style={styles.bio}>{business.description}</Text> : null}
        {hours ? <BusinessHoursBlock hours={hours} /> : null}
        <View style={{ flexDirection: "row", gap: space.lg, flexWrap: "wrap", justifyContent: "center" }}>
          {website ? (
            <Pressable onPress={() => openBusinessLink(website)} style={styles.link} accessibilityRole="link">
              <Icon name="globe-outline" size={16} color={colors.brand} />
              <Text style={styles.linkText}>{website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</Text>
            </Pressable>
          ) : null}
          {business.phone ? (
            <Pressable onPress={() => void Linking.openURL(`tel:${business.phone!.replace(/[^\d+]/g, "")}`).catch(() => {})} style={styles.link} accessibilityRole="link">
              <Icon name="call-outline" size={16} color={colors.brand} />
              <Text style={styles.linkText}>{business.phone}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", gap: space.sm, alignSelf: "stretch" }}>
          {blocked ? null : (
            <View style={{ flex: 1 }}>
              <Button title={user ? "Message" : "Log in to message"} onPress={() => void message({ type: "business", id: business.id })} loading={busy} />
            </View>
          )}
          {website ? <Button title="Website" icon="open-outline" variant="secondary" onPress={() => openBusinessLink(website)} accessibilityRole="link" testID="business-website" /> : null}
          {user ? (
            <Pressable onPress={more} style={styles.more} accessibilityRole="button" accessibilityLabel="More">
              <Icon name="ellipsis-horizontal" size={20} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {blocked ? (
        <EmptyState icon="ban-outline" title={`You blocked ${business.name}`} body="Its posts, listings and ads don't show to you, and you can't message it. Unblock it from the ••• menu." />
      ) : (
        <>
          {opened ? (
            <View style={styles.opened}>
              <Text style={styles.kind}>{postKindLabel(opened.kind)}</Text>
              <Text style={styles.openedTitle}>{opened.title}</Text>
              {[opened.price_cents != null ? formatCents(opened.price_cents, opened.currency) : null, opened.discount_label].filter(Boolean).length ? (
                <Text style={styles.meta}>{[opened.price_cents != null ? formatCents(opened.price_cents, opened.currency) : null, opened.discount_label].filter(Boolean).join(" · ")}</Text>
              ) : null}
              {opened.description ? <Text style={styles.bio}>{opened.description}</Text> : null}
              {opened.code ? <Text style={styles.code}>Code: {opened.code}</Text> : null}
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Button title={`Message about this`} onPress={() => void message({ type: "deal", id: opened.id, title: opened.title })} loading={busy} />
                </View>
                {opened.link_url && /^https?:\/\//i.test(opened.link_url) ? <Button title="Open" variant="secondary" onPress={() => openBusinessLink(opened.link_url)} /> : null}
              </View>
            </View>
          ) : null}

          <Text style={styles.section}>POSTS</Text>
          {posts.length === 0 ? (
            <Text style={[styles.meta, { textAlign: "center", paddingVertical: space.xl }]}>No posts yet.</Text>
          ) : (
            <View style={styles.grid}>
              {posts.map((p) => {
                const cover = safeBusinessImage(mediaCover(mediaItems(p.media)) ?? p.image_url);
                return (
                  <Pressable key={p.id} onPress={() => setOpened(p)} style={{ width: tile, height: tile, backgroundColor: colors.panel }} accessibilityRole="button" accessibilityLabel={p.title} testID="business-post">
                    {cover ? <Image source={{ uri: cover }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={150} /> : null}
                    <View style={styles.tileLabel}>
                      <Text style={styles.tileKind}>{postKindLabel(p.kind).toUpperCase()}</Text>
                      <Text style={styles.tileTitle} numberOfLines={1}>
                        {p.title}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {listings.length ? (
            <>
              <Text style={styles.section}>LISTINGS</Text>
              <View style={styles.grid}>
                {listings.map((l) => {
                  const photo = safeBusinessImage(photosFor(l.images, l.image_meta)[0]?.url);
                  return (
                    <Pressable key={l.id} onPress={() => router.push({ pathname: "/apartments/[id]", params: { id: l.id } })} style={{ width: tile, gap: 4 }} accessibilityRole="link" accessibilityLabel={l.title}>
                      <View style={{ width: tile, height: tile, backgroundColor: colors.panel }}>{photo ? <Image source={{ uri: photo }} style={{ width: "100%", height: "100%" }} contentFit="cover" /> : null}</View>
                      <Text style={styles.listingTitle} numberOfLines={1}>
                        {l.title}
                      </Text>
                      <Text style={styles.listingMeta}>{formatPrice(l.price_per_month, l.currency)}/mo</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { alignItems: "center", gap: space.md, padding: space.lg, paddingTop: space.xl },
  name: { fontSize: 22, fontWeight: "700", color: colors.text, textAlign: "center" },
  meta: { color: colors.muted, fontSize: 14, textAlign: "center" },
  bio: { color: colors.text, fontSize: 15, lineHeight: 21, textAlign: "center" },
  link: { flexDirection: "row", alignItems: "center", gap: 4 },
  linkText: { color: colors.brand, fontWeight: "600", fontSize: 14 },
  more: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.input },
  section: { fontSize: 12, fontWeight: "700", letterSpacing: 1.5, color: colors.muted, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, borderTopWidth: 1, borderTopColor: colors.border, marginTop: space.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 2, paddingHorizontal: space.lg },
  tileLabel: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 6, backgroundColor: "rgba(0,0,0,0.45)" },
  tileKind: { color: "rgba(255,255,255,0.8)", fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  tileTitle: { color: "#ffffff", fontSize: 12, fontWeight: "700" },
  opened: { marginHorizontal: space.lg, marginBottom: space.md, padding: space.lg, gap: space.sm, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  kind: { color: colors.brand, fontSize: 12, fontWeight: "700" },
  openedTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  code: { color: colors.brand, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  listingTitle: { color: colors.text, fontSize: 13, fontWeight: "600" },
  listingMeta: { color: colors.muted, fontSize: 12 },
}));
