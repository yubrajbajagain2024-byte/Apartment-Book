import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { BUSINESS_PORTAL_NAME, BUSINESS_PORTAL_TAGLINE } from "@apartment-book/shared";
import { getPortalBase } from "@/lib/business/portal";
import { PORTAL_THEME_COOKIE, portalThemeOf } from "@/lib/business/theme";
import { PortalBaseProvider } from "@/components/business/portal-base";

// San Francisco where the system has it (Apple devices); Inter everywhere else (the portal's font stack in globals.css).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: BUSINESS_PORTAL_NAME, template: `%s · ${BUSINESS_PORTAL_NAME}` },
  description: BUSINESS_PORTAL_TAGLINE,
  // A workplace, not a page to find: nothing here is for search engines.
  robots: { index: false, follow: false },
};

/**
 * The browser's own frame (a phone's address bar, some desktop title bars) in the portal's canvas colour, light or
 * dark as the page itself, in place of the student site's blue: the page and its frame change together.
 */
export async function generateViewport(): Promise<Viewport> {
  const theme = portalThemeOf((await cookies()).get(PORTAL_THEME_COOKIE)?.value);
  const light = "#f5f5f7";
  const dark = "#000000";
  return {
    themeColor:
      theme === "system"
        ? [
            { media: "(prefers-color-scheme: light)", color: light },
            { media: "(prefers-color-scheme: dark)", color: dark },
          ]
        : theme === "dark"
          ? dark
          : light,
  };
}

/**
 * The business portal: served under /business on the site, and at the root of its own domain once
 * NEXT_PUBLIC_BUSINESS_SITE_URL is set. Everything inside is the portal's own colour world ([data-surface="business"]
 * in globals.css), light, dark or the system's (the theme switch's cookie).
 */
export default async function BusinessLayout({ children }: { children: React.ReactNode }) {
  const [base, jar] = await Promise.all([getPortalBase(), cookies()]);
  const theme = portalThemeOf(jar.get(PORTAL_THEME_COOKIE)?.value);
  return (
    <div data-surface="business" data-theme={theme === "system" ? undefined : theme} className={`${inter.variable} flex min-h-dvh flex-1 flex-col`}>
      <PortalBaseProvider base={base}>{children}</PortalBaseProvider>
    </div>
  );
}
