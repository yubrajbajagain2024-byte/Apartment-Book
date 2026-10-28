/** The portal's theme switch, remembered per browser: "light", "dark", or (no cookie) the system's. */
export const PORTAL_THEME_COOKIE = "biz-theme";
export type PortalTheme = "system" | "light" | "dark";

export function portalThemeOf(value: string | null | undefined): PortalTheme {
  return value === "light" || value === "dark" ? value : "system";
}
