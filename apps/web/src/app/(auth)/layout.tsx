import Link from "next/link";
import { Home } from "lucide-react";
import { APP_NAME, APP_TAGLINE } from "@apartment-book/shared";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center gap-2 text-center">
        <Link href="/" className="flex items-center gap-2 text-2xl font-bold text-brand-600">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Home className="h-6 w-6" />
          </span>
          {APP_NAME}
        </Link>
        <p className="max-w-sm text-sm text-gray-600">{APP_TAGLINE}</p>
      </div>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 sm:p-8">{children}</div>
    </main>
  );
}
