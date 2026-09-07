import type { Client, DevicePushToken, PushPlatform } from "../types/models";

/**
 * Save (or refresh) a device push token. The web app does not send push
 * notifications yet; the mobile apps will register their Expo/FCM/APNs token here.
 */
export async function registerPushToken(
  supabase: Client,
  input: { userId: string; token: string; platform: PushPlatform },
): Promise<DevicePushToken> {
  const { data, error } = await supabase
    .from("device_push_tokens")
    .upsert(
      { user_id: input.userId, token: input.token, platform: input.platform, last_seen_at: new Date().toISOString() },
      { onConflict: "token" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function removePushToken(supabase: Client, token: string): Promise<void> {
  const { error } = await supabase.from("device_push_tokens").delete().eq("token", token);
  if (error) throw error;
}

export async function listPushTokens(supabase: Client, userId: string): Promise<DevicePushToken[]> {
  const { data, error } = await supabase.from("device_push_tokens").select("*").eq("user_id", userId);
  if (error) throw error;
  return data;
}
