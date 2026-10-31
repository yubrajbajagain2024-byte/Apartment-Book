import type { Metadata } from "next";
import { fetchAdRates, requireConsoleAdmin } from "@/lib/console/server";
import { Section } from "@/components/console/parts";
import { RateCard } from "@/components/business/rate-card";

export const metadata: Metadata = { title: "Pricing" };

/**
 * The rate card: what a day of each placement costs on one campus, and the least an ad costs there. A campaign's price
 * is, for each of its placements, the daily rate × its days × its campuses, and at least the highest minimum among
 * them. It is a suggestion: approving an ad records what was actually paid. Changes are in the staff audit log;
 * businesses do not see the rate card.
 */
export default async function PricingPage() {
  await requireConsoleAdmin("/business/pricing");
  const rates = await fetchAdRates();
  return (
    <div className="flex flex-col gap-4">
      <Section title="Rate card" hint="US dollars">
        <RateCard rates={rates} />
      </Section>
      <p className="max-w-2xl text-sm text-gray-600">
        A campaign&apos;s price is, for each placement it runs in, the daily rate × its days × its campuses, and at least the highest minimum among its placements. The review form starts from it; approving records
        what was actually paid, so a discount or a package deal is simply a different amount. Housing ads run in Housing only. Changing a rate never changes a payment already recorded.
      </p>
    </div>
  );
}
