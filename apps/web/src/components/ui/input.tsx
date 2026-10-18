import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A field on a soft fill; a hairline in ink appears while it has focus, red while it carries an error. */
export const inputClasses =
  "block w-full rounded-[10px] border border-transparent bg-gray-100 px-3.5 py-2 text-sm text-gray-900 transition-colors placeholder:text-gray-400 focus:border-gray-900 focus:bg-white focus:outline-none focus:ring-0 disabled:opacity-60 aria-[invalid=true]:border-red-500";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputClasses, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputClasses, "min-h-28 resize-y py-2.5", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(inputClasses, "h-11 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ className, label, ...props }: ComponentProps<"input"> & { label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-gray-800">
      <input
        type="checkbox"
        className={cn("h-4 w-4 rounded border-gray-300 accent-gray-900 focus:ring-gray-400", className)}
        {...props}
      />
      {label}
    </label>
  );
}
