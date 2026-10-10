"use server";

import { revalidatePath } from "next/cache";
import {
  addProfileClass,
  classCodeProblem,
  isProfileVisibility,
  PROFILE_SECTIONS,
  removeProfileClass,
  setPostPinned,
  setProfileVisibility,
  type ProfileSection,
  type ProfileVisibility,
} from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/utils";

/** What every action here returns: nothing when it worked, a sentence to show when it did not. */
export type ProfilePageResult = { error?: string };

const TERM = /^(Spring|Summer|Fall|Winter) \d{4}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLASS_TITLE_MAX = 80;

/** Adds a class to one of your semesters ("CS 3358" in "Fall 2026"). The database explains duplicates and the limit. */
export async function addClassAction(input: { term: string; code: string; title?: string | null }): Promise<ProfilePageResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in to add your classes." };
  const term = typeof input?.term === "string" ? input.term.trim() : "";
  const code = typeof input?.code === "string" ? input.code : "";
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  if (!TERM.test(term)) return { error: "Pick a semester." };
  const problem = classCodeProblem(code);
  if (problem) return { error: problem };
  if (title.length > CLASS_TITLE_MAX) return { error: `Class names are at most ${CLASS_TITLE_MAX} characters.` };
  try {
    await addProfileClass(await createClient(), user.id, { term, code, title: title || null });
  } catch (error) {
    return { error: errorMessage(error, "Could not add the class.") };
  }
  revalidatePath(`/profile/${user.id}`);
  return {};
}

/** Removes one of your classes (row-level security keeps everyone else's out of reach). */
export async function removeClassAction(id: string): Promise<ProfilePageResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in to change your classes." };
  if (typeof id !== "string" || !UUID.test(id)) return { error: "That class is not on your list." };
  try {
    await removeProfileClass(await createClient(), id);
  } catch (error) {
    return { error: errorMessage(error, "Could not remove the class.") };
  }
  revalidatePath(`/profile/${user.id}`);
  return {};
}

/** Who can see your Classes, Saved or Liked tab: everyone, friends or only you. */
export async function setVisibilityAction(section: ProfileSection, value: ProfileVisibility): Promise<ProfilePageResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in to change who can see this." };
  if (!PROFILE_SECTIONS.includes(section) || !isProfileVisibility(value)) return { error: "Pick Everyone, Friends or Only me." };
  try {
    await setProfileVisibility(await createClient(), user.id, section, value);
  } catch (error) {
    return { error: errorMessage(error, "Could not save the setting.") };
  }
  revalidatePath(`/profile/${user.id}`);
  revalidatePath("/settings/profile");
  return {};
}

/** Pins one of your posts or reels to the top of your profile, or unpins it. Three at most; the database says so. */
export async function setPinnedAction(postId: string, pinned: boolean): Promise<ProfilePageResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in to pin posts." };
  if (typeof postId !== "string" || !UUID.test(postId) || typeof pinned !== "boolean") return { error: "Could not find that post." };
  try {
    await setPostPinned(await createClient(), postId, pinned);
  } catch (error) {
    return { error: errorMessage(error, pinned ? "Could not pin the post." : "Could not unpin the post.") };
  }
  revalidatePath(`/profile/${user.id}`);
  revalidatePath(`/posts/${postId}`);
  return {};
}
