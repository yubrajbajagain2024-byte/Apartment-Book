import { initials } from "@apartment-book/shared";
import { cn, safeHttpUrl } from "@/lib/utils";

const sizes = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
  xl: "h-20 w-20 text-xl",
} as const;

/** Plain <img>: avatars come from Supabase Storage or Google; no optimizer quota spent on a private tool. */
export function Avatar({ name, src, size = "md", className }: { name: string | null | undefined; src?: string | null; size?: keyof typeof sizes; className?: string }) {
  const url = safeHttpUrl(src);
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 font-semibold text-brand-800", sizes[size], className)}
      title={name ?? undefined}
    >
      {url ? <img src={url} alt={name ?? "Avatar"} className="h-full w-full object-cover" loading="lazy" /> : initials(name)}
    </span>
  );
}
