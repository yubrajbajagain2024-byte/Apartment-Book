"use client";

import { useState } from "react";
import Image from "next/image";
import { ExternalLink, MessageCircle, Ticket } from "lucide-react";
import { businessLabel, inquiryPrefill, isPlainBusinessLabel, type DealWithBusiness } from "@apartment-book/shared";
import { isOptimizableImage } from "@/lib/images";
import { startDealInquiryAction } from "@/lib/actions/messages";
import { formatDate } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { ViewTracker } from "@/components/stats/view-tracker";

/** One deal, as students see it: the business and its label, the offer, the code behind a tap, and a way to ask. */
export function DealCard({ deal, signedIn }: { deal: DealWithBusiness; signedIn: boolean }) {
  const [showCode, setShowCode] = useState(false);
  const business = deal.business;
  if (!business) return null;
  return (
    <article className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200" data-testid="deal-card">
      <ViewTracker targetType="deal" targetId={deal.id} />
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <Avatar name={business.name} src={business.logo_url} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{business.name}</span>
        <Badge tone={isPlainBusinessLabel(businessLabel(business, deal.sponsored)) ? "gray" : business.verified_partner && !deal.sponsored ? "green" : "blue"}>{businessLabel(business, deal.sponsored)}</Badge>
      </div>
      {deal.image_url && isOptimizableImage(deal.image_url) ? (
        <div className="relative aspect-[16/9] w-full bg-gray-100">
          <Image src={deal.image_url} alt="" fill sizes="(min-width: 640px) 640px, 100vw" className="object-cover" />
        </div>
      ) : null}
      <div className="flex flex-col gap-2 px-3 pb-3 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-gray-900">{deal.title}</h2>
          {deal.discount_label ? <Badge tone="amber">{deal.discount_label}</Badge> : null}
        </div>
        {deal.description ? <p className="whitespace-pre-line text-sm text-gray-800">{deal.description}</p> : null}
        {deal.ends_at ? <p className="text-xs text-gray-500">Until {formatDate(deal.ends_at)}</p> : null}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {deal.code ? (
            showCode ? (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-brand-500 bg-brand-50 px-3 font-mono text-sm font-bold text-brand-700" data-testid="deal-code">
                <Ticket className="h-4 w-4" /> {deal.code}
              </span>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setShowCode(true)}>
                <Ticket className="h-4 w-4" /> Show code
              </Button>
            )
          ) : null}
          {deal.link_url ? (
            <a href={deal.link_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-gray-800 hover:bg-gray-100">
              <ExternalLink className="h-4 w-4" /> Open
            </a>
          ) : null}
          {signedIn ? (
            <form action={startDealInquiryAction}>
              <input type="hidden" name="dealId" value={deal.id} />
              <input type="hidden" name="prefill" value={inquiryPrefill(business.name, deal.title)} />
              <Button type="submit" size="sm">
                <MessageCircle className="h-4 w-4" /> Message {business.name}
              </Button>
            </form>
          ) : (
            <LinkButton href="/login?next=%2Fdeals" size="sm">
              <MessageCircle className="h-4 w-4" /> Log in to message
            </LinkButton>
          )}
        </div>
      </div>
    </article>
  );
}
