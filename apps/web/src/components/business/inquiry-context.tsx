import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { inquiryKindLabel, type InquiryTarget } from "@apartment-book/shared";
import { isOptimizableImage } from "@/lib/images";
import { INQUIRY_ICONS } from "./inquiry-icons";
import { PortalLink } from "./portal-base";

/** Where the team opens what the student asked about, in the portal. */
function targetHref(t: InquiryTarget): string | null {
  if (t.kind === "profile") return "/profile";
  if (!t.id) return null;
  if (t.kind === "listing") return `/listings/${t.id}/edit`;
  if (t.kind === "post") return `/deals/${t.id}/edit`;
  return `/ads/${t.id}`;
}

/**
 * The top of an inquiry: what the student asked about (the listing, post or ad as it is now, or the profile), so whoever
 * answers knows the context without leaving the chat.
 */
export function InquiryContext({ target }: { target: InquiryTarget }) {
  const Icon = INQUIRY_ICONS[target.kind];
  const href = targetHref(target);
  const title = target.kind === "profile" ? "Your business profile" : (target.title ?? `A ${inquiryKindLabel(target.kind).toLowerCase()} that was removed`);
  const body = (
    <>
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-biz-surface-3 text-biz-ink-3">
        {isOptimizableImage(target.image) ? <Image src={target.image as string} alt="" fill sizes="44px" className="object-cover" /> : <Icon className="h-5 w-5" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium text-biz-ink-4">
          Asked about · {inquiryKindLabel(target.kind)}
          {target.price ? ` · ${target.price}` : ""}
        </span>
        <span className="block truncate text-[14px] font-semibold text-biz-ink">{title}</span>
      </span>
      {href ? <ChevronRight className="h-4 w-4 shrink-0 text-biz-ink-4" aria-hidden="true" /> : null}
    </>
  );
  const box = "flex items-center gap-3 border-b border-biz-line bg-biz-surface-2 px-4 py-2.5";
  return href ? (
    <PortalLink href={href} className={`${box} transition-colors hover:bg-biz-surface-3`} data-testid="inquiry-about">
      {body}
    </PortalLink>
  ) : (
    <div className={box} data-testid="inquiry-about">
      {body}
    </div>
  );
}
