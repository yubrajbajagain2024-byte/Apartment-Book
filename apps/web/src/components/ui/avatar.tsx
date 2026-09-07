import Image from "next/image";
import { initials } from "@apartment-book/shared";
import { cn } from "@/lib/utils";

const sizes = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
  xl: "h-24 w-24 text-2xl",
} as const;

const pixels = { xs: 24, sm: 32, md: 40, lg: 56, xl: 96 } as const;

export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 font-semibold text-brand-800",
        sizes[size],
        className,
      )}
      title={name ?? undefined}
    >
      {src ? (
        <Image src={src} alt={name ?? "Avatar"} width={pixels[size]} height={pixels[size]} className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
