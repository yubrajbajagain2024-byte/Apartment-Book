"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const notConfigured = error.message.includes("Supabase is not configured");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="max-w-lg text-gray-600">
        {notConfigured
          ? "The app cannot reach Supabase yet. Copy apps/web/.env.example to apps/web/.env.local, fill in your project URL and key, then restart the dev server."
          : error.message || "An unexpected error occurred."}
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
        >
          Try again
        </button>
        <Link href="/" className="rounded-lg bg-gray-200 px-4 py-2 font-medium hover:bg-gray-300">
          Home
        </Link>
      </div>
    </main>
  );
}
