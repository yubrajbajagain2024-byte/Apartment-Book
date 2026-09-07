import { APP_NAME } from "@apartment-book/shared";
import { cn } from "@/lib/utils";

/** Brand mark: a teal tile with a house silhouette and an amber "you are here" dot. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("h-10 w-10", className)} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#0f766e" />
      <path d="M14 46V27.5L32 14l18 13.5V46a3 3 0 0 1-3 3H37V36h-10v13H17a3 3 0 0 1-3-3z" fill="#fff" />
      <circle cx="32" cy="27" r="4" fill="#f59e0b" />
    </svg>
  );
}

export function Logo({ withText = true, className }: { withText?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      {withText ? (
        <span className="text-xl font-bold tracking-tight text-brand-700">
          Apartment<span className="text-accent-600">Book</span>
        </span>
      ) : (
        <span className="sr-only">{APP_NAME}</span>
      )}
    </span>
  );
}
