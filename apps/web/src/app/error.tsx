"use client";

import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui/button";

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
      <h1 className="font-display text-2xl tracking-tight text-gray-900">Something went wrong</h1>
      <p className="max-w-lg text-sm leading-relaxed text-gray-500">
        {notConfigured
          ? "The app cannot reach Supabase yet. Copy apps/web/.env.example to apps/web/.env.local, fill in your project URL and key, then restart the dev server."
          : error.message || "An unexpected error occurred."}
      </p>
      <div className="mt-2 flex gap-3">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <LinkButton href="/" variant="secondary">
          Home
        </LinkButton>
      </div>
    </main>
  );
}
