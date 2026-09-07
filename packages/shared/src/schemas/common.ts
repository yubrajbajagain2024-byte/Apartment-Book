import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/** Optional free text; empty strings become undefined. */
export const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

/** Optional number that accepts "" from HTML forms. */
export const optionalNumber = (opts: { min?: number; max?: number; int?: boolean } = {}) => {
  let schema = z.coerce.number();
  if (opts.int) schema = schema.int();
  if (opts.min !== undefined) schema = schema.min(opts.min);
  if (opts.max !== undefined) schema = schema.max(opts.max);
  return z.preprocess(emptyToUndefined, schema.optional());
};

/** Checkbox value: "on"/"true"/true become true, everything else false. */
export const formBoolean = z.preprocess(
  (value) => value === true || value === "true" || value === "on" || value === "1",
  z.boolean(),
);

/** Optional ISO date (yyyy-mm-dd) from a date input. */
export const optionalDate = z.preprocess(
  emptyToUndefined,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD").optional(),
);

/** Optional http(s) URL. */
export const optionalUrl = z.preprocess(
  emptyToUndefined,
  z.url({ protocol: /^https?$/, error: "Enter a valid link starting with http:// or https://" })
    .max(500)
    .optional(),
);

/** A list of uploaded image URLs (from hidden inputs or a JSON array). */
export const imageUrls = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === "") return [];
    if (Array.isArray(value)) return value.filter((v) => typeof v === "string" && v.length > 0);
    if (typeof value === "string") return [value];
    return [];
  },
  z.array(z.url()).max(8, "You can add up to 8 photos"),
);

export const uuid = z.uuid({ error: "Invalid id" });
export const optionalUuid = z.preprocess(emptyToUndefined, uuid.optional());

export type FieldErrors = Record<string, string[] | undefined>;

export function flattenZodError(error: z.ZodError): { formErrors: string[]; fieldErrors: FieldErrors } {
  const flat = z.flattenError(error);
  return {
    formErrors: flat.formErrors,
    fieldErrors: flat.fieldErrors as FieldErrors,
  };
}
