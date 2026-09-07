import Link from "next/link";
import { APP_TAGLINE } from "@apartment-book/shared";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center gap-2 text-center">
        <Link href="/" className="flex items-center">
          <Logo className="[&_svg]:h-12 [&_svg]:w-12 [&_span]:text-2xl" />
        </Link>
        <p className="max-w-sm text-sm text-gray-600">{APP_TAGLINE}</p>
      </div>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 sm:p-8">{children}</div>
    </main>
  );
}
