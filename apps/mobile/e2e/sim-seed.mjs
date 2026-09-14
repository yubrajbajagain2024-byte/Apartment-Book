// Creates a test user and sample posts for simulator runs (SUPABASE_ACCESS_TOKEN env).
// Writes .sim-state.json (git-ignored); run sim-cleanup.mjs afterwards.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const ref = "dskbzoqreandwwpxiplh";
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` } })).json();
const admin = createClient(`https://${ref}.supabase.co`, keys.find((k) => k.name === "service_role").api_key, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = Date.now(); const password = `Sim-${stamp}-pass!`;
const mk = async (name) => { const email = `ui-${name.toLowerCase()}-${stamp}@txstate.edu`; const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `UI ${name}` } }); if (error) throw error; return { id: data.user.id, email, name: `UI ${name}` }; };
const me = await mk("Sim"); const other = await mk("Maya");
const { data: uni } = await admin.from("universities").select("id").eq("email_domain", "txstate.edu").single();
await admin.from("profiles").update({ university_id: uni.id }).in("id", [me.id, other.id]);
const photos = ["https://picsum.photos/seed/sim-a/900/1125", "https://picsum.photos/seed/sim-b/900/1125", "https://picsum.photos/seed/sim-c/900/1125"];
const meta = photos.map((u) => ({ url: u, width: 900, height: 1125, blur: null }));
const { data: apt } = await admin.from("apartments").insert({ owner_id: other.id, university_id: uni.id, title: "Sunny 2-bed near Sewell Park", description: "Bright two-bedroom with a balcony, five minutes from campus on the bus line. Utilities included, laundry in unit, parking for one car.", price_per_month: 1150, address: "100 Sessom Dr", city: "San Marcos", bedrooms: 2, bathrooms: 1, furnished: true, utilities_included: true, images: photos, image_meta: meta }).select("id").single();
const { data: room } = await admin.from("roommate_posts").insert({ author_id: other.id, university_id: uni.id, post_type: "has_room", title: "Room in a quiet 3-bed house", description: "Furnished room with two grad students. Lease from January, looking for a quiet student.", budget_max: 650, location: "San Marcos", images: photos.slice(0, 2), image_meta: meta.slice(0, 2) }).select("id").single();
const { data: item } = await admin.from("items").insert({ seller_id: other.id, university_id: uni.id, title: "Queen mattress, 1 year old", description: "Firm, clean, no stains. Pickup near campus.", price: 80, category: "mattress_bedding", condition: "good", images: [photos[0]], image_meta: [meta[0]] }).select("id").single();
await admin.from("post_comments").insert({ target_type: "roommate", target_id: room.id, user_id: other.id, body: "Still available! Message me for a visit." });
fs.writeFileSync(new URL(".sim-state.json", import.meta.url), JSON.stringify({ me, other, password, apartmentId: apt.id, roommateId: room.id, itemId: item.id }, null, 2));
console.log(JSON.stringify({ me: me.email, password, apt: apt.id, room: room.id, item: item.id }));
