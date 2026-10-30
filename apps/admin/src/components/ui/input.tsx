import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const inputClasses =
  "block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-gray-100 aria-[invalid=true]:border-red-500";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputClasses, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputClasses, "min-h-24 resize-y", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(inputClasses, "h-10 pr-8", className)} {...props}>
      {children}
    </select>
  );
}
