/** How the business audit log (Business v2's, not the staff audit log) reads in the Business pages. */

/** "invite_created" → "Invite created". */
export function businessAuditLabel(action: string): string {
  const text = action.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The one line of detail an entry carries: names, roles, a change, the reason, a payment reference. */
export function businessAuditDetail(detail: unknown): string {
  const d = (detail ?? {}) as Record<string, unknown>;
  const parts = [d.name, d.title, d.email, d.role ? `as ${d.role}` : null, typeof d.from === "string" && typeof d.to === "string" ? `${d.from} → ${d.to}` : null, d.reason, d.note, d.payment_reference ? `ref ${d.payment_reference}` : null, Array.isArray(d.fields) ? `changed ${d.fields.join(", ")}` : null];
  return parts.filter((p) => typeof p === "string" && p).join(" · ");
}
