import { z } from "zod";
import { EVENT_CATEGORY_VALUES, EVENT_DESCRIPTION_MAX, EVENT_LOCATION_MAX, EVENT_TITLE_MAX, ORGANIZATION_DESCRIPTION_MAX, ORGANIZATION_KIND_VALUES, ORGANIZATION_NAME_MAX } from "../constants";
import { formBoolean, optionalText, optionalUrl } from "./common";

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
/** An ISO instant from the app's date pickers or a datetime-local input. */
const instant = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? new Date(v).toISOString() : v),
  z.string().refine((s) => Number.isFinite(Date.parse(s)), "Pick a date and time"),
);
const optionalInstant = z.preprocess(emptyToUndefined, instant.optional());
/** An https link only: the organization's website shows on its page, and a plain http one would be a mixed-content warning. */
const optionalHttpsUrl = z.preprocess(emptyToUndefined, z.url({ protocol: /^https$/, error: "Enter a link starting with https://" }).max(500).optional());

/** An event a member publishes or edits (the database stamps the campus, the author, the source and the status). */
export const eventFormSchema = z
  .object({
    organizationId: z.uuid({ error: "Pick the organization this event is for" }),
    title: z.string().trim().min(3, "Give the event a title").max(EVENT_TITLE_MAX),
    description: optionalText(EVENT_DESCRIPTION_MAX),
    startsAt: instant,
    endsAt: optionalInstant,
    allDay: formBoolean,
    location: optionalText(EVENT_LOCATION_MAX),
    category: z.enum(EVENT_CATEGORY_VALUES, { error: "Pick a category" }),
    imageUrl: optionalUrl,
    registrationUrl: optionalUrl,
    cancelled: formBoolean.optional(),
  })
  .refine((v) => !v.endsAt || Date.parse(v.endsAt) > Date.parse(v.startsAt), { message: "The event must end after it starts", path: ["endsAt"] });
export type EventFormInput = z.infer<typeof eventFormSchema>;

export const organizationFormSchema = z.object({
  name: z.string().trim().min(2, "Give the organization its name").max(ORGANIZATION_NAME_MAX),
  kind: z.enum(ORGANIZATION_KIND_VALUES, { error: "Pick what kind of organization this is" }),
  description: optionalText(ORGANIZATION_DESCRIPTION_MAX),
  website: optionalHttpsUrl,
  avatarUrl: optionalUrl,
});
export type OrganizationFormInput = z.infer<typeof organizationFormSchema>;
