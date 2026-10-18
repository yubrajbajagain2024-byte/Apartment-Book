import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-500",
  secondary: "bg-gray-200 text-gray-900 hover:bg-gray-300 focus-visible:ring-gray-400",
  outline: "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 focus-visible:ring-gray-400",
  ghost: "text-gray-700 hover:bg-gray-100 focus-visible:ring-gray-400",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
  icon: "h-10 w-10 p-0",
};

export function buttonClasses(opts: { variant?: Variant; size?: Size; className?: string } = {}): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
    variants[opts.variant ?? "primary"],
    sizes[opts.size ?? "md"],
    opts.className,
  );
}

export type ButtonProps = ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export function Button({ variant, size, loading, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={buttonClasses({ variant, size, className })}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

export type LinkButtonProps = ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
};

export function LinkButton({ variant, size, className, ...props }: LinkButtonProps) {
  return <Link className={buttonClasses({ variant, size, className })} {...props} />;
}
