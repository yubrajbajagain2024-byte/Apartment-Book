import { useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "@/components/ui";
import { alertWithHaptic, hapticLike, hapticSelect } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { organizationFollows } from "@/lib/organization-follows-store";
import { useSession } from "@/lib/session";

/**
 * Follow | Following for an organization, reading and flipping the shared set (lib/organization-follows-store), so the
 * same pill on an event, on the organization's page and in the "to follow" row always agree. Signed out it goes to log in.
 */
export function OrganizationFollowButton({ organizationId, compact, style }: { organizationId: string; compact?: boolean; style?: StyleProp<ViewStyle> }) {
  const { user } = useSession();
  const router = useRouter();
  const following = organizationFollows.useIds(user?.id ?? null).has(organizationId);
  const [pending, setPending] = useState(false);
  async function toggle() {
    if (!user) return router.push("/(auth)/login");
    setPending(true);
    try {
      const on = await organizationFollows.toggle(user.id, organizationId);
      if (on) hapticLike();
      else hapticSelect();
    } catch (e) {
      alertWithHaptic("error", "Could not update", errorText(e));
    } finally {
      setPending(false);
    }
  }
  const label = following ? "Following" : "Follow";
  return (
    <Button
      title={label}
      variant={following ? "secondary" : "primary"}
      icon={compact ? undefined : following ? "checkmark" : "add"}
      size={compact ? "compact" : "regular"}
      disabled={pending}
      accessibilityLabel={label}
      accessibilityState={{ selected: following }}
      onPress={() => void toggle()}
      // Wide enough for "Following", so the pill never changes width when tapped.
      style={[compact && { minWidth: 96 }, style]}
    />
  );
}
