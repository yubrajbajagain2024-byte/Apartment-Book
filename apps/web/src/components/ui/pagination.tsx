import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Simple previous/next pagination driven by a `page` search param. */
export function Pagination({
  page,
  totalPages,
  basePath,
  params,
}: {
  page: number;
  totalPages: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) return null;

  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "" && key !== "page") search.set(key, value);
    }
    if (target > 1) search.set("page", String(target));
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  const linkClass = (disabled: boolean) =>
    cn(
      "inline-flex h-9 items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium",
      disabled ? "pointer-events-none opacity-40" : "hover:bg-gray-50",
    );

  return (
    <nav className="flex items-center justify-center gap-3 py-2" aria-label="Pagination">
      <Link href={href(page - 1)} className={linkClass(page <= 1)} aria-disabled={page <= 1}>
        <ChevronLeft className="h-4 w-4" /> Previous
      </Link>
      <span className="text-sm text-gray-600">
        Page {page} of {totalPages}
      </span>
      <Link href={href(page + 1)} className={linkClass(page >= totalPages)} aria-disabled={page >= totalPages}>
        Next <ChevronRight className="h-4 w-4" />
      </Link>
    </nav>
  );
}
