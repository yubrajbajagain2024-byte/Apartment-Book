import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
      {Icon ? (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Icon className="h-6 w-6" />
        </span>
      ) : null}
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      {description ? <p className="max-w-md text-sm text-gray-600">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
