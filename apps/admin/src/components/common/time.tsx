import { formatDate, timeAgo } from "@apartment-book/shared";

/** "3 hours ago" with the full date as a tooltip. Rendered on the server; the client may differ by a minute. */
export function Time({ iso, className }: { iso: string | null | undefined; className?: string }) {
  if (!iso) return <span className={className}>never</span>;
  return (
    <time dateTime={iso} title={formatDate(iso)} suppressHydrationWarning className={className}>
      {timeAgo(iso)}
    </time>
  );
}
