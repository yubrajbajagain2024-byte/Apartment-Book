"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addGroupMembers,
  createGroupConversation,
  flattenZodError,
  getOrCreateDirectConversation,
  groupSchema,
  leaveConversation,
  recordContact,
  renameGroup,
} from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/utils";
import type { FormState } from "./types";

/** "Message" button on listings and profiles: opens (or creates) the 1:1 chat. */
export async function startDirectConversationAction(formData: FormData): Promise<void> {
  const otherUserId = String(formData.get("userId") ?? "");
  const prefill = String(formData.get("prefill") ?? "").slice(0, 300);
  const returnTo = String(formData.get("returnTo") ?? "/");
  const user = await requireUser(returnTo);
  if (!otherUserId || otherUserId === user.id) redirect(returnTo);

  const supabase = await createClient();
  let conversationId: string;
  try {
    conversationId = await getOrCreateDirectConversation(supabase, otherUserId);
  } catch (error) {
    redirect(`${returnTo}?error=${encodeURIComponent(errorMessage(error))}`);
  }
  // Count this as a contact on the listing (owner stats). Never blocks the chat.
  const targetType = String(formData.get("targetType") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  if ((targetType === "apartment" || targetType === "item" || targetType === "roommate") && targetId) {
    await recordContact(supabase, targetType, targetId).catch(() => {});
  }
  const query = prefill ? `?prefill=${encodeURIComponent(prefill)}` : "";
  redirect(`/messages/${conversationId}${query}`);
}

/** New conversation page: one person -> direct chat, several -> group. */
export async function createConversationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser("/messages/new");
  const memberIds = formData.getAll("memberIds").filter((v): v is string => typeof v === "string" && v.length > 0);
  const name = String(formData.get("name") ?? "").trim();
  const supabase = await createClient();

  if (memberIds.length === 0) return { error: "Pick at least one person to message." };

  let conversationId: string;
  try {
    if (memberIds.length === 1 && !name) {
      conversationId = await getOrCreateDirectConversation(supabase, memberIds[0]);
    } else {
      const parsed = groupSchema.safeParse({ name, memberIds });
      if (!parsed.success) {
        return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: { name } };
      }
      conversationId = await createGroupConversation(supabase, parsed.data.name, parsed.data.memberIds);
    }
  } catch (error) {
    return { error: errorMessage(error), values: { name } };
  }

  revalidatePath("/messages", "layout");
  redirect(`/messages/${conversationId}`);
}

export async function addMembersAction(conversationId: string, memberIds: string[]): Promise<{ error?: string }> {
  await requireUser(`/messages/${conversationId}`);
  try {
    const supabase = await createClient();
    await addGroupMembers(supabase, conversationId, memberIds);
    revalidatePath("/messages", "layout");
    return {};
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function renameGroupAction(conversationId: string, name: string): Promise<{ error?: string }> {
  await requireUser(`/messages/${conversationId}`);
  const trimmed = name.trim();
  if (trimmed.length < 2) return { error: "Group name is too short." };
  try {
    const supabase = await createClient();
    await renameGroup(supabase, conversationId, trimmed.slice(0, 80));
    revalidatePath("/messages", "layout");
    return {};
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function leaveGroupAction(conversationId: string): Promise<void> {
  const user = await requireUser("/messages");
  const supabase = await createClient();
  await leaveConversation(supabase, conversationId, user.id);
  revalidatePath("/messages", "layout");
  redirect("/messages");
}
