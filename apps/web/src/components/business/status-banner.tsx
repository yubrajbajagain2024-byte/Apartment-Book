import { AlertTriangle, Clock, XCircle } from "lucide-react";
import type { Business } from "@apartment-book/shared";
import { cn } from "@/lib/utils";

/** Where the business stands with the UniBuzz team, on every page until it is approved. */
export function StatusBanner({ business }: { business: Business }) {
  if (business.status === "approved") return null;
  const style = {
    pending: { icon: Clock, tone: "bg-biz-warning-soft text-biz-warning", title: "Awaiting review" },
    rejected: { icon: XCircle, tone: "bg-biz-danger-soft text-biz-danger", title: "Not approved" },
    suspended: { icon: AlertTriangle, tone: "bg-biz-danger-soft text-biz-danger", title: "Suspended" },
  }[business.status as "pending" | "rejected" | "suspended"] ?? { icon: Clock, tone: "bg-biz-surface-3 text-biz-ink-2", title: business.status };
  const Icon = style.icon;
  return (
    <div className={cn("ab-fade-in mb-8 flex items-start gap-3 rounded-[20px] px-5 py-4", style.tone)} role="status" data-testid="business-status">
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="text-[15px] leading-relaxed">
        <p className="font-semibold">{style.title}</p>
        <p className="mt-0.5 opacity-90">
          {business.status === "pending"
            ? "The UniBuzz team checks every new business before anything of it goes in front of students. Fill in your profile and draft posts and ads in the meantime."
            : business.status === "rejected"
              ? "Your business was not approved. Update your profile with what the team asked for, then write to them."
              : "While the business is suspended, its posts, listings and ads are hidden from students, and nobody on the team can reply, post or change anything. Write to the UniBuzz team to sort it out."}
        </p>
        {business.review_note ? <p className="mt-1.5 font-medium">Note from the team: {business.review_note}</p> : null}
      </div>
    </div>
  );
}
