"use client";

import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { PORTAL_THEME_COOKIE, type PortalTheme } from "@/lib/business/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: PortalTheme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Applies a theme to the portal at once and remembers it for a year in the cookie its layout reads. */
function applyTheme(next: PortalTheme) {
  document.cookie = next === "system" ? `${PORTAL_THEME_COOKIE}=; path=/; max-age=0; samesite=lax` : `${PORTAL_THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  const surface = document.querySelector<HTMLElement>('[data-surface="business"]');
  if (surface) {
    if (next === "system") delete surface.dataset.theme;
    else surface.dataset.theme = next;
  }
}

/** Light, dark or the system's: applied at once, and remembered for a year. */
export function ThemeSwitch({ initial }: { initial: PortalTheme }) {
  const [theme, setTheme] = useState<PortalTheme>(initial);
  function choose(next: PortalTheme) {
    setTheme(next);
    applyTheme(next);
  }
  return (
    <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-1 rounded-xl bg-biz-surface-3 p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          onClick={() => choose(value)}
          className={cn(
            "flex flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200",
            theme === value ? "bg-biz-surface text-biz-ink shadow-biz" : "text-biz-ink-3 hover:text-biz-ink",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
