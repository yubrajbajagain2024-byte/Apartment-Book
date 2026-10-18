import { LinkButton } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="font-display text-7xl tracking-tight text-gray-900">404</p>
      <h1 className="font-display text-2xl tracking-tight text-gray-900">Page not found</h1>
      <p className="max-w-sm text-sm leading-relaxed text-gray-500">The page you are looking for does not exist or was removed.</p>
      <LinkButton href="/" className="mt-2">
        Back to home
      </LinkButton>
    </main>
  );
}
