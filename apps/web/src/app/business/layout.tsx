import type { Metadata } from "next";
import { BUSINESS_PORTAL_NAME, BUSINESS_PORTAL_TAGLINE } from "@apartment-book/shared";
import { getPortalBase } from "@/lib/business/portal";
import { PortalBaseProvider } from "@/components/business/portal-base";

export const metadata: Metadata = {
  title: { default: BUSINESS_PORTAL_NAME, template: `%s · ${BUSINESS_PORTAL_NAME}` },
  description: BUSINESS_PORTAL_TAGLINE,
  // A workplace, not a page to find: nothing here is for search engines.
  robots: { index: false, follow: false },
};

/** The business portal: served under /business on the site, and at the root of its own domain once NEXT_PUBLIC_BUSINESS_SITE_URL is set. */
export default async function BusinessLayout({ children }: { children: React.ReactNode }) {
  const base = await getPortalBase();
  return <PortalBaseProvider base={base}>{children}</PortalBaseProvider>;
}
