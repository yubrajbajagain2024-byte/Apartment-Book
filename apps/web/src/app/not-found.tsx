import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-6xl font-bold text-brand-600">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-gray-600">The page you are looking for does not exist or was removed.</p>
      <Link
        href="/"
        className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
      >
        Back to home
      </Link>
    </main>
  );
}
