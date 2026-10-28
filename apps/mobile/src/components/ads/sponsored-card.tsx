import { useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import {
  BUSINESS_REPORT_REASONS,
  adCtaLabel,
  adDestination,
  formatPrice,
  hideAd,
  mediaCover,
  recordBusinessEvent,
  reportBusiness,
  saveAd,
  setBusinessBlocked,
  startBusinessInquiry,
  type AdPlacement,
  type BusinessReportReason,
  type FeedAd,
} from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { radius, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** The pictures an ad shows: its own, or those of the listing or post it promotes. */
function picture(ad: FeedAd): string | null {
  const own = mediaCover(ad.media);
  if (own) return own;
  if (ad.promoted?.type === "apartment") return ad.promoted.images[0] ?? null;
  if (ad.promoted?.type === "deal") return mediaCover(ad.promoted.media);
  return null;
}

/**
 * An ad as students meet it in the app: a post in For You or a listing in Housing like any other, "Sponsored" under the
 * business's name, its button under the picture. The ••• menu hides it, reports it, blocks the business or says why it
 * is there; what the student does is counted, and the business only ever gets the numbers.
 */
export function SponsoredCard({ ad, placement }: { ad: FeedAd; placement: AdPlacement }) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const show = useActionSheet();
  const { user } = useSession();
  const [gone, setGone] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const image = picture(ad);
  const listing = ad.promoted?.type === "apartment" ? ad.promoted : null;
  const openProfile = () => router.push({ pathname: "/businesses/[id]", params: { id: ad.business_id, ad: ad.id } });

  async function act() {
    void recordBusinessEvent(supabase, "click", { adId: ad.id, placement });
    const dest = adDestination(ad);
    if (dest.kind === "url") return void Linking.openURL(dest.url);
    if (dest.kind === "listing") return router.push({ pathname: "/apartments/[id]", params: { id: dest.id } });
    if (dest.kind === "message") {
      if (!user) return router.push("/(auth)/login" as never);
      try {
        const conv = await startBusinessInquiry(supabase, "ad", ad.id);
        router.push({ pathname: "/messages/[id]", params: { id: conv } });
      } catch (e) {
        Alert.alert("Message", errorText(e));
      }
      return;
    }
    openProfile();
  }

  function menu() {
    const done = (message: string) => () => setGone(message);
    const fail = (title: string) => (e: unknown) => Alert.alert(title, errorText(e));
    show(
      [
        { label: "Hide ad", icon: "eye-off-outline", onPress: () => void hideAd(supabase, ad.id).then(done("Ad hidden. You won't see it again.")).catch(fail("Could not hide")) },
        {
          label: "Report ad",
          icon: "flag-outline",
          onPress: () =>
            show(
              BUSINESS_REPORT_REASONS.map((r) => ({
                label: r.label,
                onPress: () => void reportBusiness(supabase, { adId: ad.id }, r.value as BusinessReportReason).then(done("Thanks. The UniBuzz team will look at it.")).catch(fail("Could not report")),
              })),
              "Why are you reporting this ad?",
            ),
        },
        { label: `Block ${ad.business_name}`, icon: "ban-outline", destructive: true, onPress: () => void setBusinessBlocked(supabase, ad.business_id, true).then(done(`${ad.business_name} is blocked.`)).catch(fail("Could not block")) },
        {
          label: "Why am I seeing this?",
          icon: "information-circle-outline",
          onPress: () => Alert.alert("Why you see this ad", `${ad.business_name} chose to reach students at your campus, and this ad was approved and paid for. UniBuzz never uses your age, gender, interests or activity to choose ads.`),
        },
      ],
      ad.business_name,
    );
  }

  if (gone) return <Text style={styles.gone}>{gone}</Text>;
  return (
    <View style={styles.card} testID="sponsored-card" accessibilityLabel={`Sponsored by ${ad.business_name}`}>
      <View style={styles.header}>
        <Pressable onPress={openProfile} accessibilityRole="link" accessibilityLabel={`${ad.business_name}'s profile`}>
          <Avatar name={ad.business_name} url={ad.business_logo_url} size={36} />
        </Pressable>
        <Pressable onPress={openProfile} style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={styles.name} numberOfLines={1}>
              {ad.business_name}
            </Text>
            {ad.verified_partner ? <Icon name="checkmark-circle" sf="checkmark.seal.fill" size={15} color={colors.brand} accessibilityLabel="Verified Partner" /> : null}
          </View>
          <Text style={styles.sponsored}>Sponsored</Text>
        </Pressable>
        <Pressable onPress={menu} hitSlop={10} accessibilityRole="button" accessibilityLabel="Ad options">
          <Icon name="ellipsis-horizontal" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <Pressable onPress={() => void act()} accessibilityRole="button" accessibilityLabel={adCtaLabel(ad.cta)}>
        <View style={[styles.media, placement === "housing" ? { aspectRatio: 4 / 3 } : { aspectRatio: 4 / 5 }]}>
          {image ? <Image source={{ uri: image }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={150} /> : null}
          {ad.media.some((m) => m.type === "video") ? (
            <View style={styles.play}>
              <Icon name="play" size={22} color="#ffffff" />
            </View>
          ) : null}
        </View>
        <View style={styles.cta}>
          <Text style={styles.ctaText}>{adCtaLabel(ad.cta)}</Text>
          <Icon name="chevron-forward" size={18} color={colors.brand} />
        </View>
      </Pressable>
      <View style={styles.body}>
        {listing ? (
          <Text style={styles.price}>
            {formatPrice(listing.price, listing.currency)}/mo · {listing.bedrooms} bd · {listing.bathrooms} ba
          </Text>
        ) : null}
        <Text style={styles.caption} numberOfLines={3}>
          <Text style={{ fontWeight: "700" }}>{ad.business_name} </Text>
          {ad.headline ? <Text style={{ fontWeight: "700" }}>{ad.headline} · </Text> : null}
          {ad.caption}
        </Text>
        <Pressable
          onPress={() => {
            if (!user) return router.push("/(auth)/login" as never);
            const next = !saved;
            setSaved(next);
            void saveAd(supabase, ad.id, next).catch(() => setSaved(!next));
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={saved ? "Saved" : "Save"}
          style={{ alignSelf: "flex-end" }}
        >
          <Icon name={saved ? "bookmark" : "bookmark-outline"} size={22} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { backgroundColor: colors.card },
  header: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  name: { color: colors.text, fontWeight: "700", fontSize: 14, flexShrink: 1 },
  sponsored: { color: colors.muted, fontSize: 12 },
  media: { width: "100%", backgroundColor: colors.panel, overflow: "hidden" },
  play: { position: "absolute", top: space.md, right: space.md, width: 34, height: 34, borderRadius: radius.pill, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md, height: 44, borderBottomWidth: 1, borderBottomColor: colors.border },
  ctaText: { color: colors.brand, fontWeight: "700", fontSize: 14 },
  body: { paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.md, gap: 6 },
  price: { color: colors.text, fontWeight: "700", fontSize: 14 },
  caption: { color: colors.text, fontSize: 14, lineHeight: 19 },
  gone: { color: colors.muted, textAlign: "center", padding: space.lg, backgroundColor: colors.card },
}));
