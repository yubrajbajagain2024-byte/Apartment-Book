import { AlertTriangle, Clock, ShieldCheck, XCircle } from "lucide-react";
import type { Business } from "@apartment-book/shared";
import { cn } from "@/lib/utils";

/** Where the business stands with the CampConnect team, on every page until it is approved. */
export function StatusBanner({ business }: { business: Business }) {
  if (business.status === "approved") return null;
  const note = business.review_note ? <p className="mt-1 text-sm opacity-90">Note from the team: {business.review_note}</p> : null;
  const style = {
    pending: { icon: Clock, tone: "border-amber-200 bg-amber-50 text-amber-900", title: "Awaiting review" },
    rejected: { icon: XCircle, tone: "border-red-200 bg-red-50 text-red-900", title: "Not approved" },
    suspended: { icon: AlertTriangle, tone: "border-red-200 bg-red-50 text-red-900", title: "Suspended" },
  }[business.status as "pending" | "rejected" | "suspended"] ?? { icon: ShieldCheck, tone: "border-gray-200 bg-gray-50 text-gray-800", title: business.status };
  const Icon = style.icon;
  return (
    <div className={cn("mb-4 flex items-start gap-3 rounded-xl border px-4 py-3", style.tone)} role="status" data-testid="business-status">
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div>
        <p className="font-semibold">{style.title}</p>
        {business.status === "pending" ? (
          <p className="mt-1 text-sm opacity-90">
            The CampConnect team checks every new business before its listings and deals go in front of students. You can fill in your profile and draft deals in the meantime.
          </p>
        ) : business.status === "rejected" ? (
          <p className="mt-1 text-sm opacity-90">Your business was not approved. Update your profile and reply to the note below, or write to the CampConnect team.</p>
        ) : (
          <p className="mt-1 text-sm opacity-90">
            While the business is suspended, its listings and deals are hidden from students, and nobody on the team can reply to inquiries, post or change anything. Write to the CampConnect team to sort it out.
          </p>
        )}
        {note}
      </div>
    </div>
  );
}
