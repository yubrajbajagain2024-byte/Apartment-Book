// A LiveKit token for a call you are in. The apps call it with their session (Authorization: Bearer <the user's JWT>)
// and {"call_id": "<uuid>"}; it asks the database whether that user is in that call (get_call() runs as them, so a
// stranger gets nothing), then mints a token for the room named after the call, with the user's id as identity and
// their name for the others to see. Nothing here ever reaches the apps but the token and the server's address.
//
// Secrets (supabase secrets set …): LIVEKIT_URL (wss://… of a LiveKit Cloud project or a self-hosted server),
// LIVEKIT_API_KEY and LIVEKIT_API_SECRET. SUPABASE_URL and SUPABASE_ANON_KEY are provided to every function.
// Deploy: supabase functions deploy livekit-token (see README → Calls).
import { createClient } from "npm:@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  const url = Deno.env.get("LIVEKIT_URL");
  const apiKey = Deno.env.get("LIVEKIT_API_KEY");
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  if (!url || !apiKey || !apiSecret) return reply(503, { error: "Calls aren't set up on the server yet." });

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return reply(401, { error: "Log in to make calls." });

  let callId: string;
  let check = false;
  try {
    const body = await req.json();
    callId = typeof body?.call_id === "string" ? body.call_id : "";
    check = body?.check === true;
  } catch {
    callId = "";
  }

  // As the caller: RLS and get_call() decide what they may see.
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return reply(401, { error: "Log in to make calls." });
  const userId = userData.user.id;

  // {"check": true}: does the server's key pair open its LiveKit project? (For the setup check in the live test; it
  // says only whether LiveKit accepted a server token, never a secret.)
  if (check) {
    const probe = new AccessToken(apiKey, apiSecret, { identity: "campconnect-setup-check", ttl: "1m" });
    probe.addGrant({ roomList: true });
    const api = url.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:").replace(/\/+$/, "");
    try {
      const res = await fetch(`${api}/twirp/livekit.RoomService/ListRooms`, { method: "POST", headers: { Authorization: `Bearer ${await probe.toJwt()}`, "Content-Type": "application/json" }, body: "{}" });
      return reply(200, { ok: res.ok, status: res.status, detail: res.ok ? "LiveKit accepted the server's key pair." : (await res.text()).slice(0, 200), key_shape: `${apiKey.length} chars${/\s/.test(apiKey) ? ", has whitespace" : ""}`, secret_shape: `${apiSecret.length} chars${/\s/.test(apiSecret) ? ", has whitespace" : ""}`, url_shape: `${new URL(url).protocol}//${new URL(url).host}` });
    } catch (e) {
      return reply(200, { ok: false, status: 0, detail: `Could not reach LiveKit: ${(e as Error).message}` });
    }
  }
  if (!/^[0-9a-f-]{36}$/i.test(callId)) return reply(400, { error: "Which call?" });

  const { data: call, error } = await supabase.rpc("get_call", { p_call_id: callId });
  if (error) return reply(500, { error: error.message });
  if (!call || typeof call !== "object") return reply(404, { error: "This call isn't available" });
  const record = call as { status?: string; participants?: { user_id: string; state: string; profile?: { full_name?: string } }[] };
  if (record.status === "ended") return reply(410, { error: "This call has ended" });
  const me = (record.participants ?? []).find((p) => p.user_id === userId);
  // Joined through answer_call() or start_call() first: the token follows the database, never the other way round.
  if (!me || me.state !== "joined") return reply(403, { error: "Join the call first" });

  const token = new AccessToken(apiKey, apiSecret, { identity: userId, name: me.profile?.full_name ?? "Someone", ttl: "2h" });
  token.addGrant({ room: callId, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  return reply(200, { token: await token.toJwt(), url });
});
