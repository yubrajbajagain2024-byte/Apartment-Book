import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { adDisplayStatus, adStatusLabel, type Ad } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { PortalLink } from "./portal-base";

/*
 * The portal's building blocks, in its own tokens (globals.css, [data-surface="business"]): generous space, one accent,
 * soft depth. Server components; the interactive ones live next to the screens that use them.
 */

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-biz-accent text-biz-on-accent hover:bg-biz-accent-hover shadow-[0_1px_2px_rgb(0_0_0/0.12)]",
  secondary: "bg-biz-surface-3 text-biz-ink hover:bg-biz-line",
  ghost: "text-biz-ink-2 hover:bg-biz-line hover:text-biz-ink",
  outline: "text-biz-ink ring-1 ring-inset ring-biz-line-strong hover:bg-biz-line",
  danger: "bg-biz-danger-soft text-biz-danger hover:bg-biz-danger hover:text-white",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-3.5 text-[13px]",
  md: "h-10 gap-2 px-5 text-sm",
  lg: "h-12 gap-2 px-6 text-[15px]",
  icon: "h-9 w-9",
};

/** A portal button's classes: a pill, a quick press, nothing louder than the accent. */
export function bizButton(opts: { variant?: Variant; size?: Size; className?: string } = {}): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-full font-medium tracking-[-0.01em] transition-[background-color,color,box-shadow,scale,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-safe:active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
    VARIANTS[opts.variant ?? "primary"],
    SIZES[opts.size ?? "md"],
    opts.className,
  );
}

export function BizButton({ variant, size, loading, className, children, disabled, ...props }: ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button className={bizButton({ variant, size, className })} disabled={disabled || loading} {...props}>
      {loading ? <Spinner className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

/** A portal page link that looks like a button: <BizLink href="/ads/new">. */
export function BizLink({ variant, size, className, ...props }: Omit<ComponentProps<typeof PortalLink>, "className"> & { variant?: Variant; size?: Size; className?: string }) {
  return <PortalLink className={bizButton({ variant, size, className })} {...props} />;
}

/** The text fields of the portal's own forms: filled, rounded, the accent ring on focus. */
export const bizField =
  "w-full rounded-xl bg-biz-surface-3 px-3.5 text-[15px] text-biz-ink placeholder:text-biz-ink-4 outline-none ring-1 ring-inset ring-transparent transition-[box-shadow,background-color] duration-200 focus:bg-biz-surface focus:ring-2 focus:ring-biz-accent disabled:opacity-60";

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-[13px] font-medium text-biz-ink-3">{eyebrow}</p> : null}
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.022em] text-biz-ink sm:text-[32px]">{title}</h1>
        {subtitle ? <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-biz-ink-3">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A surface: white (or graphite) on the canvas, a hairline and a shadow you feel more than see. */
export function Panel({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-[22px] bg-biz-surface shadow-biz ring-1 ring-biz-line", className)} {...props} />;
}

export function PanelHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-6 pt-5", className)}>
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-biz-ink">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[13px] text-biz-ink-3">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatTile({ label, value, sub, icon: Icon, href }: { label: string; value: ReactNode; sub?: ReactNode; icon?: LucideIcon; href?: string }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-biz-ink-3">
        {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
        {label}
      </span>
      <span className="mt-2 block text-[28px] font-semibold tabular-nums tracking-[-0.02em] text-biz-ink">{value}</span>
      {sub ? <span className="mt-0.5 block text-xs text-biz-ink-4">{sub}</span> : null}
    </>
  );
  const box = "block rounded-[20px] bg-biz-surface p-5 shadow-biz ring-1 ring-biz-line";
  return href ? (
    <PortalLink href={href} className={cn(box, "transition-[box-shadow,scale] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-biz-lift motion-safe:active:scale-[0.99]")}>
      {body}
    </PortalLink>
  ) : (
    <div className={box}>{body}</div>
  );
}

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";
const TONES: Record<Tone, string> = {
  neutral: "bg-biz-surface-3 text-biz-ink-2",
  accent: "bg-biz-accent-soft text-biz-accent-ink",
  success: "bg-biz-success-soft text-biz-success",
  warning: "bg-biz-warning-soft text-biz-warning",
  danger: "bg-biz-danger-soft text-biz-danger",
};

export function Pill({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", TONES[tone], className)} {...props} />;
}

const AD_TONES: Record<Ad["status"], Tone> = {
  draft: "neutral",
  pending_review: "warning",
  scheduled: "accent",
  active: "success",
  paused: "neutral",
  completed: "neutral",
  rejected: "danger",
};

/** An ad's status as it stands now (the sweep may not have run since its dates came). */
export function AdStatusPill({ ad }: { ad: Pick<Ad, "status" | "starts_at" | "ends_at"> }) {
  const status = adDisplayStatus(ad);
  return (
    <Pill tone={AD_TONES[status]} data-testid="ad-status">
      {status === "active" ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" /> : null}
      {adStatusLabel(status)}
    </Pill>
  );
}

export function EmptyPanel({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <Panel className="flex flex-col items-center px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-biz-accent-soft text-biz-accent-ink">
        <Icon className="h-7 w-7" aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-[19px] font-semibold tracking-[-0.01em] text-biz-ink">{title}</h2>
      {description ? <p className="mt-2 max-w-md text-[15px] leading-relaxed text-biz-ink-3">{description}</p> : null}
      {action ? <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </Panel>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("ab-skeleton rounded-xl", className)} />;
}

/** A note in the flow of a page: what changed, or what went wrong. */
export function Notice({ tone = "accent", title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-2xl px-4 py-3 text-sm", TONES[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cn(title ? "mt-0.5" : null, "leading-relaxed opacity-95")}>{children}</div> : null}
    </div>
  );
}
