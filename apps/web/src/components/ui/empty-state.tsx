import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** Nothing here yet: a thin-ringed mark, a serif headline, a quiet line, and whatever can be done about it. */
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
    <div className="flex flex-col items-center justify-center gap-3 rounded-[14px] bg-white px-6 py-16 text-center ring-1 ring-gray-200">
      {Icon ? (
        <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full text-gray-900 ring-1 ring-gray-200">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
      ) : null}
      <h3 className="font-display text-2xl tracking-tight text-gray-900">{title}</h3>
      {description ? <p className="max-w-md text-sm leading-relaxed text-gray-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
