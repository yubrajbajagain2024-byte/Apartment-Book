"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addStaff, flattenZodError, removeStaff, revokeStaffInvite, setStaffRole, staffAddSchema, STAFF_ROLE_VALUES, type StaffRole } from "@apartment-book/shared";
import { adminErrorMessage, requireStaffAction } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { formToObject } from "@/lib/utils";
import { formValues, type FormState } from "./types";

/**
 * Team management. Every action first checks the caller here (admin or owner, with a
 * verified second factor), then calls the shared query whose RPC re-checks everything
 * in SQL. The checks here only give a readable answer sooner; the database decides.
 */

const userIdSchema = z.uuid();
const roleSchema = z.enum(STAFF_ROLE_VALUES);
const emailSchema = staffAddSchema.shape.email;

export async function addStaffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const gate = await requireStaffAction({ minRole: "admin" });
  if (gate.error) return { error: gate.error, values: formValues(formData) };
  const parsed = staffAddSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  let result: "added" | "invited";
  try {
    result = await addStaff(await createClient(), parsed.data);
  } catch (error) {
    return { error: adminErrorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/", "layout");
  const { email, role } = parsed.data;
  return {
    success:
      result === "added"
        ? `${email} was added as ${role}.`
        : `${email} was invited as ${role}. They become staff as soon as they sign up and confirm that address.`,
  };
}

export async function setStaffRoleAction(userId: string, role: StaffRole): Promise<{ error?: string }> {
  const gate = await requireStaffAction({ minRole: "admin" });
  if (gate.error) return { error: gate.error };
  const parsedId = userIdSchema.safeParse(userId);
  if (!parsedId.success) return { error: "Not a staff member" };
  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success) return { error: "Invalid role" };
  try {
    await setStaffRole(await createClient(), parsedId.data, parsedRole.data);
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function removeStaffAction(userId: string): Promise<{ error?: string }> {
  const gate = await requireStaffAction({ minRole: "admin" });
  if (gate.error) return { error: gate.error };
  const parsedId = userIdSchema.safeParse(userId);
  if (!parsedId.success) return { error: "Not a staff member" };
  try {
    await removeStaff(await createClient(), parsedId.data);
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function revokeInviteAction(email: string): Promise<{ error?: string }> {
  const gate = await requireStaffAction({ minRole: "admin" });
  if (gate.error) return { error: gate.error };
  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) return { error: "No invitation for that address" };
  try {
    await revokeStaffInvite(await createClient(), parsedEmail.data);
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
  revalidatePath("/", "layout");
  return {};
}
