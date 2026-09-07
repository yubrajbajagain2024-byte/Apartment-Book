import Image from "next/image";
import Link from "next/link";
import type { PhotoMeta } from "@apartment-book/shared";
import { cn } from "@/lib/utils";

export type RailItem = {
  id: string;
  href: string;
  photo: PhotoMeta;
  label: string;
  sublabel?: string;
  /** Highlighted ring, e.g. listed in the last two days. */
  fresh?: boolean;
};

/** Stories-style horizontal strip of photos. Renders nothing without items. */
export function PhotoRail({ title, items }: { title: string; items: RailItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      <div className="no-scrollbar -mx-3 flex gap-3 overflow-x-auto px-3 pb-1 sm:-mx-4 sm:px-4">
        {items.map((item) => (
          <Link key={item.id} href={item.href} className="group flex w-28 shrink-0 flex-col gap-1.5">
            <span className={cn("relative block aspect-square overflow-hidden rounded-2xl bg-gray-100 ring-2 ring-offset-2", item.fresh ? "ring-brand-600" : "ring-transparent")}>
              <Image
                src={item.photo.url}
                alt={item.label}
                fill
                sizes="112px"
                quality={75}
                placeholder={item.photo.blur ? "blur" : "empty"}
                blurDataURL={item.photo.blur ?? undefined}
                className="object-cover transition-transform duration-300 group-hover:scale-105"
              />
            </span>
            <span className="truncate text-sm font-bold text-gray-900">{item.label}</span>
            {item.sublabel ? <span className="-mt-1 truncate text-xs text-gray-500">{item.sublabel}</span> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}
