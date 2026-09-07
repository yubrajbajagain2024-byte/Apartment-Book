import type { Client, University } from "../types/models";

export async function listUniversities(supabase: Client): Promise<University[]> {
  const { data, error } = await supabase.from("universities").select("*").order("name");
  if (error) throw error;
  return data;
}

export async function createUniversity(
  supabase: Client,
  input: { name: string; city?: string; country?: string },
): Promise<University> {
  const { data, error } = await supabase
    .from("universities")
    .insert({ name: input.name, city: input.city ?? null, country: input.country ?? null })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Email domains that are allowed to sign up (e.g. ["txstate.edu"]). */
export async function getAllowedEmailDomains(supabase: Client): Promise<string[]> {
  const { data, error } = await supabase.rpc("allowed_email_domains");
  if (error) throw error;
  return (data ?? []) as string[];
}

/** Which university a sign-up email belongs to, or null if the domain is not allowed. */
export async function universityIdForEmail(supabase: Client, email: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("university_for_email", { p_email: email });
  if (error) throw error;
  return data ?? null;
}
