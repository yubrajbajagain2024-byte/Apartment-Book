import { Spinner } from "@/components/ui/spinner";

export default function Loading() {
  return (
    <div className="flex justify-center py-20 text-brand-600">
      <Spinner className="h-8 w-8" />
    </div>
  );
}
