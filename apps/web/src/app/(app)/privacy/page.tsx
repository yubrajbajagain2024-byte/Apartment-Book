import type { Metadata } from "next";
import { Card, CardBody } from "@/components/ui/card";

export const metadata: Metadata = { title: "Privacy policy" };

export default function Page() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold">Privacy policy</h1>
      <Card>
        <CardBody className="text-sm text-gray-700">
          The full Privacy policy is being prepared as part of the safety and legal step. It will be published here before launch.
        </CardBody>
      </Card>
    </div>
  );
}
