import { supabase } from "./supabase";

/** Someone to mention or to show a post to: what the create flow's lists show of them. */
export type PersonPick = { id: string; full_name: string; avatar_url: string | null; username: string | null };

const COLUMNS = "id, full_name, avatar_url, username";

/**
 * People for the create flow's pickers (@mentions, "Selected people"): with nothing typed, your friends (people you follow
 * who follow you back); with a name or a username typed, anyone on UniBuzz who matches, by name.
 */
export async function findPeople(query: string, limit = 20): Promise<PersonPick[]> {
  const q = query.replace(/[%_,()"'\\]/g, " ").trim();
  if (!q) {
    const { data } = await supabase.rpc("list_friends", { p_q: null }).select(COLUMNS).limit(limit);
    return (data ?? []) as unknown as PersonPick[];
  }
  const { data } = await supabase.from("profiles").select(COLUMNS).or(`full_name.ilike.%${q}%,username.ilike.%${q}%`).order("full_name").limit(limit);
  return (data ?? []) as PersonPick[];
}
