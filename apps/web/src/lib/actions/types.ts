import type { FieldErrors } from "@apartment-book/shared";

/** Result of a form server action, consumed by useActionState. */
export type FormState = {
  error?: string;
  success?: string;
  fieldErrors?: FieldErrors;
  /** Submitted values (as strings) so the form can keep what the user typed. */
  values?: Record<string, string>;
} | null;

/** Collects submitted values as strings; repeated keys are joined with commas. */
export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const all = formData.getAll(key).filter((v): v is string => typeof v === "string");
    values[key] = all.join(",");
  }
  return values;
}
