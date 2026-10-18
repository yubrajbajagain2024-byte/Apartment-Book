import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A form field: the label is a tracked small-caps eyebrow, the error or hint a quiet line under the control. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string[] | string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </label>
      {children}
      {message ? (
        <p className="text-sm text-red-600" role="alert">
          {message}
        </p>
      ) : hint ? (
        <p className="text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormMessage({ error, success }: { error?: string | null; success?: string | null }) {
  if (error) {
    return (
      <div className="rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700" role="alert">
        {error}
      </div>
    );
  }
  if (success) {
    return (
      <div className="rounded-[10px] border border-green-200 bg-green-50 px-3.5 py-2.5 text-sm text-green-700" role="status">
        {success}
      </div>
    );
  }
  return null;
}
