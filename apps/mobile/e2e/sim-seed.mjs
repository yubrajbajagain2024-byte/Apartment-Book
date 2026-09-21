// Creates a test user and sample posts for simulator runs (SUPABASE_ACCESS_TOKEN env).
// Writes .sim-state.json (git-ignored); run sim-cleanup.mjs afterwards.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const ref = "dskbzoqreandwwpxiplh";
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` } })).json();
const admin = createClient(`https://${ref}.supabase.co`, keys.find((k) => k.name === "service_role").api_key, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = Date.now(); const password = `Sim-${stamp}-pass!`;
const mk = async (name) => { const email = `ui-${name.toLowerCase()}-${stamp}@txstate.edu`; const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `UI ${name}` } }); if (error) throw error; return { id: data.user.id, email, name: `UI ${name}` }; };
const me = await mk("Sim"); const other = await mk("Maya"); const leo = await mk("Leo");
const { data: uni } = await admin.from("universities").select("id").eq("email_domain", "txstate.edu").single();
await admin.from("profiles").update({ university_id: uni.id }).in("id", [me.id, other.id, leo.id]);
const photos = ["https://picsum.photos/seed/sim-a/900/1125", "https://picsum.photos/seed/sim-b/900/1125", "https://picsum.photos/seed/sim-c/900/1125"];
const meta = photos.map((u) => ({ url: u, width: 900, height: 1125, blur: null }));
const { data: apt } = await admin.from("apartments").insert({ owner_id: other.id, university_id: uni.id, title: "Sunny 2-bed near Sewell Park", description: "Bright two-bedroom with a balcony, five minutes from campus on the bus line. Utilities included, laundry in unit, parking for one car.", price_per_month: 1150, address: "100 Sessom Dr", city: "San Marcos", bedrooms: 2, bathrooms: 1, furnished: true, utilities_included: true, images: photos, image_meta: meta }).select("id").single();
const { data: room } = await admin.from("roommate_posts").insert({ author_id: other.id, university_id: uni.id, post_type: "has_room", title: "Room in a quiet 3-bed house", description: "Furnished room with two grad students. Lease from January, looking for a quiet student.", budget_max: 650, location: "San Marcos", images: photos.slice(0, 2), image_meta: meta.slice(0, 2) }).select("id").single();
const { data: item } = await admin.from("items").insert({ seller_id: other.id, university_id: uni.id, title: "Queen mattress, 1 year old", description: "Firm, clean, no stains. Pickup near campus.", price: 80, category: "mattress_bedding", condition: "good", images: [photos[0]], image_meta: [meta[0]] }).select("id").single();
await admin.from("post_comments").insert({ target_type: "roommate", target_id: room.id, user_id: other.id, body: "Still available! Message me for a visit." });
// Home feed: a post, a video tour (shows up in Reels) and an anonymous Buzz thread written by the other user.
const SAMPLE = { media_id: "00000000-0000-0000-0000-000000000000", playback_id: "O01x4Ox01Bd8IKkk00bsSnMqm00pxaK3tnK8UkS4DDc3AM00", poster_url: "https://image.mux.com/O01x4Ox01Bd8IKkk00bsSnMqm00pxaK3tnK8UkS4DDc3AM00/thumbnail.jpg?time=1", width: 640, height: 360, duration_seconds: 10 };
const { data: post } = await admin.from("feed_posts").insert({ author_id: other.id, university_id: uni.id, body: "First week back on campus. Anyone up for a study group at Alkek this weekend?", images: [photos[1]], image_meta: [meta[1]] }).select("id").single();
// Posts look like Instagram: a words-only post, then a three-photo post with hashtags; likes and comments from other people fill the "Liked by …" and comment lines.
await admin.from("feed_posts").insert({ author_id: other.id, university_id: uni.id, body: "Does anyone know if the rec center is open during fall break?" });
const { data: carousel } = await admin.from("feed_posts").insert({ author_id: leo.id, university_id: uni.id, body: "Move-in day at the new place. Boxes everywhere, but the view is worth it #movein #txst #bobcats", images: photos, image_meta: meta }).select("id").single();
await admin.from("post_likes").insert([{ target_type: "post", target_id: post.id, user_id: leo.id }, { target_type: "post", target_id: carousel.id, user_id: other.id }, { target_type: "post", target_id: carousel.id, user_id: leo.id }]);
await admin.from("post_comments").insert({ target_type: "post", target_id: post.id, user_id: other.id, body: "Bring snacks and I will book a room." });
await admin.from("post_comments").insert({ target_type: "post", target_id: post.id, user_id: leo.id, body: "I'm in! Saturday morning works for me." });
await admin.from("feed_posts").insert({ author_id: other.id, university_id: uni.id, kind: "reel", body: "Quick tour of my new place near Sewell Park", videos: [SAMPLE] });
await admin.from("buzz_secrets").update({ thread_jitter_seconds: 0, reply_jitter_seconds: 0 }).eq("id", 1); // so test threads are visible at once; sim-cleanup restores it
const anonKey = keys.find((k) => k.name === "anon").api_key;
const asOther = createClient(`https://${ref}.supabase.co`, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
await asOther.auth.signInWithPassword({ email: other.email, password });
const buzz = await asOther.rpc("buzz_create", { p_topic: "advice", p_title: "Landlord wants to keep my whole deposit. What can I do?", p_body: "Moved out last month, left the place clean, and they are claiming 'general wear'. Has anyone here fought this and won?" });
if (buzz.error) throw buzz.error;
fs.writeFileSync(new URL(".sim-state.json", import.meta.url), JSON.stringify({ me, other, extra: [leo], password, apartmentId: apt.id, roommateId: room.id, itemId: item.id, postId: post.id, carouselId: carousel.id, buzzId: buzz.data }, null, 2));
console.log(JSON.stringify({ me: me.email, password, post: post.id, buzz: buzz.data }));
