import { cn } from "@/lib/utils";
import { IntentLink } from "./portal-base";

/**
 * The pages of one sidebar section, as a quiet segmented row under its title (Products & Services: posts and
 * listings; Settings: profile, team, verification, account). The page says which one it is. Each tab's page is
 * prefetched in full as the pointer reaches it, so moving between a section's pages shows no loading state.
 */
export function SectionTabs({ label, tabs }: { label: string; tabs: { href: string; label: string; active: boolean }[] }) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={label} className="-mt-2 flex gap-1 overflow-x-auto border-b border-biz-line no-scrollbar">
      {tabs.map((t) => (
        <IntentLink
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "relative inline-flex h-10 shrink-0 items-center px-3 text-[14px] font-medium transition-colors",
            t.active ? "text-biz-ink" : "text-biz-ink-3 hover:text-biz-ink",
          )}
        >
          {t.label}
          <span aria-hidden="true" className={cn("absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-biz-accent transition-opacity", t.active ? "opacity-100" : "opacity-0")} />
        </IntentLink>
      ))}
    </nav>
  );
}

/** Products & Services: the business's posts (products, services, offers, events, updates) and, for housing, its listings. */
export function ProductsTabs({ active, listings }: { active: "posts" | "listings"; listings: boolean }) {
  return (
    <SectionTabs
      label="Products & Services"
      tabs={[
        { href: "/deals", label: "Posts & offers", active: active === "posts" },
        ...(listings ? [{ href: "/listings", label: "Listings", active: active === "listings" }] : []),
      ]}
    />
  );
}

/** Settings: the business profile, the team, verification and the signed-in person's account. */
export function SettingsTabs({ active, team }: { active: "overview" | "profile" | "team" | "verification" | "account"; team: boolean }) {
  return (
    <SectionTabs
      label="Settings"
      tabs={[
        { href: "/settings", label: "All settings", active: active === "overview" },
        { href: "/profile", label: "Business profile", active: active === "profile" },
        ...(team ? [{ href: "/team", label: "Team", active: active === "team" }] : []),
        { href: "/settings/verification", label: "Verification", active: active === "verification" },
        { href: "/settings/account", label: "Account", active: active === "account" },
      ]}
    />
  );
}
