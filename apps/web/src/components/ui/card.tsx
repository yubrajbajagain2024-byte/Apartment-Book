import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A surface on the page: a hairline edge and, by day, the faintest lift. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-[14px] bg-white shadow-card ring-1 ring-gray-200", className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("border-b border-gray-100 px-5 py-4", className)} {...props} />;
}

/** A card's title in the editorial serif. */
export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("font-display text-xl tracking-tight text-gray-900", className)} {...props} />;
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}
