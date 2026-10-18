import Link from "next/link";
import { APP_NAME, APP_TAGLINE } from "@apartment-book/shared";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <Link href="/" className="flex items-center gap-3 font-display text-3xl tracking-tight text-gray-900">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 font-display text-lg leading-none text-white">C</span>
          {APP_NAME}
        </Link>
        <p className="max-w-sm font-display text-[15px] italic leading-relaxed text-gray-500">{APP_TAGLINE}</p>
      </div>
      <div className="w-full max-w-md rounded-[14px] bg-white p-6 shadow-card ring-1 ring-gray-200 sm:p-8">{children}</div>
    </main>
  );
}
