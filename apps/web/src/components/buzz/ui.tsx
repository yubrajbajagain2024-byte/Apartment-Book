"use client";

/**
 * The Buzz UI kit for the website, ported from UniVerse's `client/src/ui` and painted only with the Phosphor tokens
 * (`bg-incog-*`, `text-incog-*` …, defined under `[data-surface="incognito"]` in globals.css). Everything here must
 * render inside a Phosphor surface (`BuzzSurface`, or a sheet / portal stamped with `data-surface="incognito"`).
 * Nothing here can show a person: no avatars, no names, no profile links.
 */
import { forwardRef, useEffect, useLayoutEffect, useRef, type ButtonHTMLAttributes, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { CircleAlert, CloudOff, Globe, Orbit, RotateCw, School, Search, TriangleAlert, X, type LucideIcon } from "lucide-react";
import type { BuzzScope } from "@apartment-book/shared";
import { cn } from "@/lib/utils";

/* ───────────────────────────── type scale (UniVerse theme.css) ───────────────────────────── */

export const T = {
  title1: "text-[1.75rem] leading-[2.125rem] font-bold tracking-[-0.02em]",
  title2: "text-[1.375rem] leading-7 font-semibold tracking-[-0.015em]",
  title3: "text-[1.125rem] leading-6 font-semibold tracking-[-0.01em]",
  headline: "text-base leading-[1.375rem] font-semibold tracking-[-0.01em]",
  bodyLg: "text-[1.0625rem] leading-[1.625rem] font-normal tracking-[-0.008em]",
  body: "text-[0.9375rem] leading-[1.375rem] font-normal tracking-[-0.005em]",
  footnote: "text-[0.8125rem] leading-[1.125rem] font-normal",
  caption: "text-xs leading-4 font-medium tracking-[0.005em]",
  micro: "text-[0.6875rem] leading-[0.875rem] font-semibold tracking-[0.02em]",
  overline: "text-[0.6875rem] leading-[0.875rem] font-semibold tracking-[0.08em] uppercase",
  label: "text-[0.9375rem] leading-5 font-semibold tracking-[-0.005em]",
  labelSm: "text-[0.8125rem] leading-4 font-semibold",
} as const;

/** Press feedback, colour handled by each control. */
const PRESS = "transition-[transform,background-color,border-color,color,opacity,filter] duration-150 ease-out motion-safe:active:scale-[0.97]";
const PRESS_ICON = "transition-[transform,background-color,border-color,color,opacity] duration-150 ease-out motion-safe:active:scale-90";
export const SHADOW_LG = "shadow-[0_24px_64px_-12px_rgb(0_0_0/0.7),0_8px_20px_rgb(0_0_0/0.4)]";
export const GLOW = "shadow-[0_0_0_1px_var(--incog-accent-line),0_8px_28px_-6px_var(--incog-accent-soft)]";
export const HAIRLINE = "shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]";

/* ───────────────────────────── buttons ───────────────────────────── */

export type ButtonVariant = "primary" | "hero" | "secondary" | "ghost" | "outline" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE = cn("relative inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-full whitespace-nowrap disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45", PRESS);
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: cn("h-9 px-3.5", T.labelSm),
  md: cn("h-11 px-5", T.label),
  lg: cn("h-[52px] px-6", T.label),
};
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-incog-accent text-incog-on-accent hover:bg-incog-accent-hover active:bg-incog-accent-press",
  hero: cn("bg-incog-hero text-incog-on-accent hover:brightness-110 active:brightness-95", GLOW),
  secondary: cn("border border-incog-line bg-incog-surface-3 text-incog-ink hover:border-incog-line-strong active:bg-incog-surface-4", HAIRLINE),
  ghost: "bg-transparent text-incog-ink-2 hover:bg-incog-surface-2 hover:text-incog-ink",
  outline: "border border-incog-accent-line bg-transparent text-incog-accent-ink hover:bg-incog-accent-soft",
  danger: "bg-incog-danger text-white hover:brightness-110",
};
const ICON_PX: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", fullWidth = false, className?: string): string {
  return cn(BUTTON_BASE, BUTTON_SIZE[size], BUTTON_VARIANT[variant], fullWidth && "w-full", className);
}

/** Three pulsing dots: the label fades out, the width stays (UniVerse has no spinners). */
function Dots() {
  return (
    <span className="absolute inset-0 flex items-center justify-center gap-1" aria-hidden="true">
      <i className="size-[5px] rounded-full bg-current motion-safe:animate-pulse" />
      <i className="size-[5px] rounded-full bg-current motion-safe:animate-pulse [animation-delay:140ms]" />
      <i className="size-[5px] rounded-full bg-current motion-safe:animate-pulse [animation-delay:280ms]" />
    </span>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", fullWidth, loading, leftIcon: Left, rightIcon: Right, className, children, disabled, type, onClick, ...rest },
  ref,
) {
  const px = ICON_PX[size];
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
      className={cn(buttonClass(variant, size, fullWidth, className), loading && "pointer-events-none")}
      {...rest}
    >
      <span className={cn("inline-flex min-w-0 items-center justify-center gap-2 transition-opacity duration-150", loading && "opacity-0")}>
        {Left ? <Left size={px} strokeWidth={px <= 16 ? 2 : 1.75} aria-hidden="true" className="shrink-0" /> : null}
        {children != null && children !== false ? <span className="truncate">{children}</span> : null}
        {Right ? <Right size={px} strokeWidth={px <= 16 ? 2 : 1.75} aria-hidden="true" className="shrink-0" /> : null}
      </span>
      {loading ? <Dots /> : null}
    </button>
  );
});

export function ButtonLink({
  variant = "primary",
  size = "md",
  fullWidth,
  leftIcon: Left,
  className,
  children,
  ...rest
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; leftIcon?: LucideIcon }) {
  const px = ICON_PX[size];
  return (
    <Link className={buttonClass(variant, size, fullWidth, className)} {...rest}>
      {Left ? <Left size={px} strokeWidth={px <= 16 ? 2 : 1.75} aria-hidden="true" className="shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </Link>
  );
}

/* ───────────────────────────── icon buttons ───────────────────────────── */

export type IconButtonVariant = "ghost" | "filled" | "glass" | "accent";
const ICON_BASE = cn("relative inline-flex shrink-0 select-none items-center justify-center rounded-full disabled:pointer-events-none disabled:opacity-45", PRESS_ICON);
const ICON_SIZE = { sm: "size-9", md: "size-11", lg: "size-[52px]" } as const;
const GLYPH = { sm: 18, md: 20, lg: 24 } as const;
const ICON_VARIANT: Record<IconButtonVariant, string> = {
  ghost: "text-incog-ink-2 hover:bg-incog-surface-2 hover:text-incog-ink active:bg-incog-surface-3",
  filled: "bg-incog-surface-3 text-incog-ink hover:bg-incog-surface-4 active:bg-incog-surface-4",
  glass: "bg-black/35 text-white backdrop-blur-md hover:bg-black/45",
  accent: "bg-incog-accent text-incog-on-accent hover:bg-incog-accent-hover active:bg-incog-accent-press",
};

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  "aria-label": string;
  variant?: IconButtonVariant;
  size?: keyof typeof ICON_SIZE;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ icon: Icon, variant = "ghost", size = "md", className, type, ...rest }, ref) {
  return (
    <button ref={ref} type={type ?? "button"} className={cn(ICON_BASE, ICON_SIZE[size], ICON_VARIANT[variant], className)} {...rest}>
      <Icon size={GLYPH[size]} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
});

export function IconButtonLink({
  icon: Icon,
  variant = "ghost",
  size = "md",
  className,
  ...rest
}: ComponentProps<typeof Link> & { icon: LucideIcon; "aria-label": string; variant?: IconButtonVariant; size?: keyof typeof ICON_SIZE }) {
  return (
    <Link className={cn(ICON_BASE, ICON_SIZE[size], ICON_VARIANT[variant], className)} {...rest}>
      <Icon size={GLYPH[size]} strokeWidth={1.75} aria-hidden="true" />
    </Link>
  );
}

/* ───────────────────────────── badges ───────────────────────────── */

export type BadgeTone = "neutral" | "accent" | "warning" | "danger" | "success" | "info";
const BADGE_SOFT: Record<BadgeTone, string> = {
  neutral: "bg-incog-surface-3 text-incog-ink-2",
  accent: "bg-incog-accent-soft text-incog-accent-ink",
  warning: "bg-incog-warning-soft text-incog-warning",
  danger: "bg-incog-danger-soft text-incog-danger",
  success: "bg-incog-success-soft text-incog-success",
  info: "bg-incog-info-soft text-incog-info",
};

export function Badge({ tone = "neutral", className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-full px-2 whitespace-nowrap", T.micro, BADGE_SOFT[tone], className)}>{children}</span>;
}

/** "OP" in Buzz threads. */
export function OpBadge({ className }: { className?: string }) {
  return (
    <span title="Original poster" className={cn("inline-flex h-[18px] shrink-0 items-center rounded-[6px] bg-incog-accent-soft px-1.5 text-incog-accent-ink", T.micro, className)}>
      OP
    </span>
  );
}

/* ───────────────────────────── segmented control ───────────────────────────── */

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  icon?: LucideIcon;
}

/** 2–4 mutually exclusive views of the same data (a radiogroup with arrow keys). sm 36 · md 44. */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  size = "sm",
  fullWidth,
  "aria-label": ariaLabel,
  className,
}: {
  value: V;
  onChange(value: V): void;
  options: readonly SegmentOption<V>[];
  size?: "sm" | "md";
  fullWidth?: boolean;
  "aria-label": string;
  className?: string;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const index = options.findIndex((o) => o.value === value);
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const next = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : (index + (forward ? 1 : -1) + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    e.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn("relative inline-flex max-w-full items-center rounded-full bg-incog-surface-2 p-1", size === "sm" ? "h-9" : "h-11", fullWidth && "flex w-full", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              if (!active) onChange(o.value);
            }}
            className={cn(
              "relative flex h-full min-w-0 items-center justify-center gap-1.5 rounded-full whitespace-nowrap transition-colors duration-150 ease-out",
              T.labelSm,
              size === "sm" ? "px-3" : "px-4",
              fullWidth && "flex-1",
              active ? cn("bg-incog-surface-4 text-incog-ink shadow-[0_1px_2px_rgb(0_0_0/0.4)]", HAIRLINE) : "text-incog-ink-3 hover:text-incog-ink-2",
            )}
          >
            {Icon ? <Icon size={16} strokeWidth={2} aria-hidden="true" className="shrink-0" /> : null}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Campus | Global, everywhere Buzz offers the choice (feed, search, composer). */
export const SCOPE_OPTIONS: readonly SegmentOption<BuzzScope>[] = [
  { value: "campus", label: "Campus", icon: School },
  { value: "global", label: "Global", icon: Globe },
];

/* ───────────────────────────── chips ───────────────────────────── */

const CHIP_SIZE = { sm: cn("h-8 gap-1.5 px-3", T.caption), md: cn("h-9 gap-1.5 px-3.5", T.labelSm) } as const;
const CHIP_OFF = "border-incog-line bg-incog-surface-2 text-incog-ink-2 hover:border-incog-line-strong hover:text-incog-ink";
const CHIP_ON = "border-incog-accent-line bg-incog-accent-soft text-incog-ink";

export function Chip({
  selected,
  onClick,
  leftIcon: Icon,
  size = "md",
  disabled,
  role,
  tabIndex,
  className,
  children,
}: {
  selected?: boolean;
  onClick?(): void;
  leftIcon?: LucideIcon;
  size?: "sm" | "md";
  disabled?: boolean;
  role?: "radio";
  tabIndex?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === "radio" ? Boolean(selected) : undefined}
      aria-pressed={role === "radio" ? undefined : Boolean(selected)}
      tabIndex={tabIndex}
      disabled={disabled}
      onClick={onClick}
      className={cn("relative inline-flex max-w-full shrink-0 select-none items-center rounded-full border whitespace-nowrap disabled:pointer-events-none disabled:opacity-45", PRESS, CHIP_SIZE[size], selected ? CHIP_ON : CHIP_OFF, className)}
    >
      {Icon ? <Icon size={size === "sm" ? 14 : 16} strokeWidth={2} aria-hidden="true" className="shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </button>
  );
}

/** Single-choice chips (radio semantics; tapping the selected one keeps it). `scroll` = one row that scrolls sideways. */
export function ChipGroup<V extends string>({
  value,
  onChange,
  options,
  size = "md",
  scroll,
  "aria-label": ariaLabel,
  className,
}: {
  value: V;
  onChange(value: V): void;
  options: readonly { value: V; label: string }[];
  size?: "sm" | "md";
  scroll?: boolean;
  "aria-label": string;
  className?: string;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const index = options.findIndex((o) => o.value === value);
    const next = (index + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    e.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      data-no-swipe={scroll ? "" : undefined}
      className={cn("flex gap-2", scroll ? "flex-nowrap overflow-x-auto py-1 [scrollbar-width:none]" : "flex-wrap", className)}
    >
      {options.map((o) => (
        <Chip key={o.value} role="radio" size={size} selected={o.value === value} tabIndex={o.value === value ? 0 : -1} onClick={() => o.value !== value && onChange(o.value)}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

/* ───────────────────────────── underline tabs ───────────────────────────── */

export function Tabs<V extends string>({ value, onChange, tabs, "aria-label": ariaLabel, className }: { value: V; onChange(v: V): void; tabs: readonly { value: V; label: string }[]; "aria-label": string; className?: string }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const index = tabs.findIndex((t) => t.value === value);
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const tab = tabs[next];
    if (!tab) return;
    onChange(tab.value);
    e.currentTarget.querySelectorAll<HTMLButtonElement>("[role='tab']")[next]?.focus();
  };
  return (
    <div className={cn("border-b border-incog-line-subtle", className)}>
      <div role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown} className="flex">
        {tabs.map((t) => {
          const active = t.value === value;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => !active && onChange(t.value)}
              className={cn("relative flex h-12 min-w-0 flex-1 items-center justify-center px-3 whitespace-nowrap transition-colors duration-150", T.label, active ? "text-incog-ink" : "text-incog-ink-3 hover:text-incog-ink-2")}
            >
              <span className="relative flex h-full items-center">
                <span className="truncate">{t.label}</span>
                {active ? <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 min-w-6 rounded-full bg-incog-accent" /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────── states ───────────────────────────── */

/** The icon disc with the two faint orbit rings (UniVerse's empty / error motif). */
export function StateDisc({ icon: Icon, tone = "accent", compact }: { icon: LucideIcon; tone?: "accent" | "danger"; compact?: boolean }) {
  return (
    <div aria-hidden="true" className={cn("relative flex shrink-0 items-center justify-center", compact ? "size-14" : "size-32")}>
      {compact ? null : (
        <>
          <span className="absolute size-32 rounded-full border border-incog-line-subtle" />
          <span className="absolute size-24 rounded-full border border-incog-line" />
        </>
      )}
      <span className={cn("relative flex items-center justify-center rounded-full", compact ? "size-14" : "size-[72px]", tone === "danger" ? "bg-incog-danger-soft text-incog-danger" : "bg-incog-accent-soft text-incog-accent-ink")}>
        <Icon size={compact ? 24 : 28} strokeWidth={1.75} />
      </span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondary,
  compact,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick(): void };
  secondary?: { label: string; onClick(): void };
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full flex-col items-center justify-center text-center", compact ? "gap-3 px-4 py-8" : "flex-1 gap-4 px-8 py-12", className)}>
      <StateDisc icon={icon} compact={compact} />
      <div className="flex flex-col items-center gap-1.5">
        <h2 className={cn("line-clamp-2 text-incog-ink", compact ? T.headline : T.title2)}>{title}</h2>
        {description ? <p className={cn("line-clamp-3 max-w-[280px] text-incog-ink-2", compact ? T.footnote : T.body)}>{description}</p> : null}
      </div>
      {action || secondary ? (
        <div className="mt-1 flex flex-col items-center gap-1">
          {action ? (
            <Button size={compact ? "sm" : "md"} onClick={action.onClick}>
              {action.label}
            </Button>
          ) : null}
          {secondary ? (
            <Button variant="ghost" size="sm" onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const FALLBACK = "Something went wrong. Try again.";

function offline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** A Buzz error's own sentence when it is one written for people; a generic one for raw failures and 5xx. */
function userSafeMessage(error: unknown): string {
  if (offline()) return "You're offline. Check your connection and try again.";
  if (typeof error === "object" && error !== null) {
    const e = error as { status?: unknown; code?: unknown; message?: unknown };
    if (typeof e.status === "number" && typeof e.code === "string" && typeof e.message === "string" && e.message && e.code !== "unknown") {
      return e.status >= 500 ? FALLBACK : e.message;
    }
  }
  return FALLBACK;
}

export function ErrorState({ title = "Couldn't load this", error, onRetry, inline, className }: { title?: string; error?: unknown; onRetry?(): void; inline?: boolean; className?: string }) {
  if (inline) {
    return (
      <div role="alert" className={cn("flex min-h-14 w-full items-center gap-3 px-4 py-2", className)}>
        <TriangleAlert size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-incog-danger" />
        <p className={cn("min-w-0 flex-1 truncate text-incog-ink-2", T.footnote)}>{title}</p>
        {onRetry ? (
          <Button variant="ghost" size="sm" leftIcon={RotateCw} onClick={onRetry} className="text-incog-accent-ink hover:text-incog-accent-ink">
            Retry
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div role="alert" className={cn("flex w-full flex-1 flex-col items-center justify-center gap-4 px-8 py-12 text-center", className)}>
      <StateDisc icon={offline() ? CloudOff : TriangleAlert} tone="danger" />
      <div className="flex flex-col items-center gap-1.5">
        <h2 className={cn("line-clamp-2 text-incog-ink", T.title2)}>{title}</h2>
        <p className={cn("line-clamp-3 max-w-[280px] text-incog-ink-2", T.body)}>{userSafeMessage(error)}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" leftIcon={RotateCw} onClick={onRetry} className="mt-1">
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── skeletons ───────────────────────────── */

const SHIMMER =
  "bg-incog-surface-2 bg-[linear-gradient(100deg,transparent_30%,rgb(255_255_255/0.07)_50%,transparent_70%)] bg-[length:200%_100%] motion-safe:animate-[ab-shimmer_1.4s_linear_infinite] motion-reduce:bg-incog-surface-3 motion-reduce:bg-none";

export function Skeleton({ w, h, circle, className }: { w?: number | string; h?: number | string; circle?: boolean; className?: string }) {
  return <div aria-hidden="true" style={{ width: w, height: h ?? (circle ? w : undefined) }} className={cn("block shrink-0", SHIMMER, circle ? "rounded-full" : "rounded-[10px]", h === undefined && !circle && "h-4", className)} />;
}

/** `lines` text bars on the body rhythm; the last one is 60% wide. */
export function SkeletonText({ lines, className }: { lines: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex w-full flex-col", className)}>
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <div key={i} className="flex h-[1.375rem] items-center">
          <div className={cn("h-3 rounded-[6px]", SHIMMER)} style={{ width: i === lines - 1 && lines > 1 ? "60%" : "100%" }} />
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── infinite scroll ───────────────────────────── */

/**
 * Put it right under a non-empty list: asks for the next page 600px before the end (the page scrolls the window on
 * the website), shows geometry-matching skeletons while it loads, an inline retry when it fails and the end cap.
 */
export function InfiniteSentinel({
  onReach,
  hasMore,
  isFetching,
  error,
  onRetry,
  skeleton,
  endLabel = "You're all caught up",
  className,
}: {
  onReach(): void;
  hasMore: boolean;
  isFetching: boolean;
  error?: unknown;
  onRetry?(): void;
  skeleton?: ReactNode;
  /** null hides the end cap. */
  endLabel?: string | null;
  className?: string;
}) {
  const probe = useRef<HTMLDivElement>(null);
  const reach = useRef(onReach);
  useLayoutEffect(() => {
    reach.current = onReach;
  });
  const armed = hasMore && !isFetching && !error;
  useEffect(() => {
    const el = probe.current;
    if (!armed || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && reach.current(), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [armed]);
  return (
    <div className={cn("w-full", className)}>
      <div ref={probe} aria-hidden="true" className="h-px w-full" />
      {error ? (
        <ErrorState inline title="Couldn't load more" error={error} onRetry={onRetry} />
      ) : isFetching && hasMore ? (
        <div aria-busy="true" aria-live="polite">
          {skeleton ?? <Skeleton h={56} className="w-full rounded-[20px]" />}
        </div>
      ) : !hasMore && endLabel !== null ? (
        <div className={cn("my-8 flex items-center justify-center gap-2 text-incog-ink-3", T.caption)}>
          <Orbit size={14} strokeWidth={2} aria-hidden="true" />
          <span>{endLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── text entry ───────────────────────────── */

export const CONTROL_CHROME = cn(
  "border border-incog-line bg-incog-surface-2 transition-[border-color,box-shadow] duration-150 ease-out hover:border-incog-line-strong focus-within:border-incog-accent-line focus-within:ring-[3px] focus-within:ring-incog-accent-soft",
  HAIRLINE,
);

/** Textarea that grows with its text between `minRows` and `maxRows`, then scrolls. Optional `n/max` counter. */
export const AutoTextarea = forwardRef<
  HTMLTextAreaElement,
  ComponentProps<"textarea"> & { minRows?: number; maxRows?: number; showCount?: boolean; counterClassName?: string; wrapperClassName?: string }
>(function AutoTextarea({ minRows = 3, maxRows = 8, showCount, maxLength, value, className, counterClassName, wrapperClassName, ...rest }, ref) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const text = typeof value === "string" ? value : "";
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 22;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const min = Math.round(line * minRows + pad);
    const max = Math.round(line * Math.max(maxRows, minRows) + pad);
    el.style.height = "auto";
    el.style.height = `${Math.min(max, Math.max(min, el.scrollHeight))}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text, minRows, maxRows]);
  const ratio = maxLength ? text.length / maxLength : 0;
  return (
    <div className={cn("flex w-full min-w-0 flex-col", wrapperClassName)}>
      <textarea
        ref={(node) => {
          inner.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        rows={minRows}
        value={value}
        maxLength={maxLength}
        className={cn("block w-full min-w-0 resize-none appearance-none bg-transparent text-incog-ink outline-none placeholder:text-incog-ink-3", className)}
        {...rest}
      />
      {showCount && maxLength ? (
        <span aria-live="off" className={cn("mt-1.5 self-end tabular-nums", T.caption, ratio >= 1 ? "text-incog-danger" : ratio >= 0.9 ? "text-incog-warning" : "text-incog-ink-3", counterClassName)}>
          {text.length}/{maxLength}
        </span>
      ) : null}
    </div>
  );
});

export const TextInput = forwardRef<HTMLInputElement, ComponentProps<"input"> & { wrapperClassName?: string }>(function TextInput({ className, wrapperClassName, ...rest }, ref) {
  return (
    <div className={cn("flex h-11 w-full min-w-0 items-center rounded-[14px] px-3.5", CONTROL_CHROME, wrapperClassName)}>
      <input ref={ref} className={cn("h-full min-w-0 flex-1 appearance-none bg-transparent text-base text-incog-ink outline-none placeholder:text-incog-ink-3", className)} {...rest} />
    </div>
  );
});

/** The pill search field: magnifier on the left, a clear button once something is typed. Text is 16px (no iOS zoom). */
export const SearchInput = forwardRef<HTMLInputElement, Omit<ComponentProps<"input">, "value" | "onChange"> & { value: string; onValueChange(v: string): void; wrapperClassName?: string }>(
  function SearchInput({ value, onValueChange, wrapperClassName, className, ...rest }, ref) {
    return (
      <div className={cn("flex h-11 w-full min-w-0 cursor-text items-center gap-2 rounded-full pr-1.5 pl-3.5", CONTROL_CHROME, wrapperClassName)}>
        <Search size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-incog-ink-3" />
        <input
          ref={ref}
          type="search"
          enterKeyHint="search"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className={cn("h-full min-w-0 flex-1 appearance-none bg-transparent text-base text-incog-ink outline-none placeholder:text-incog-ink-3 [&::-webkit-search-cancel-button]:hidden", className)}
          {...rest}
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => onValueChange("")}
            className={cn("relative flex size-7 shrink-0 items-center justify-center rounded-full bg-incog-surface-4 text-incog-ink-2 before:absolute before:-inset-2 hover:text-incog-ink", PRESS_ICON)}
          >
            <X size={14} strokeWidth={2.25} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  },
);

/** Inline field error (red, with the alert glyph). */
export function FieldError({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} role="alert" className={cn("mt-1.5 flex items-start gap-1.5 text-incog-danger", T.footnote)}>
      <CircleAlert size={14} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
