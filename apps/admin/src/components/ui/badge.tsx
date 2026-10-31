import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "gray" | "blue" | "green" | "amber" | "red" | "purple";

const tones: Record<BadgeTone, string> = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-brand-50 text-brand-700",
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  purple: "bg-purple-100 text-purple-800",
};

export function Badge({ tone = "gray", className, ...props }: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)} {...props} />;
}
