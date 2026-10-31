"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { MODERATION_TARGET_TYPES, type ModerationTargetType } from "@apartment-book/shared";
import { parseContentRef } from "@/lib/site-links";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";

/** Open any piece of content by pasting its website link or its id. */
export function ContentLookup() {
  const router = useRouter();
  const [type, setType] = useState<ModerationTargetType>("apartment");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const ref = parseContentRef(value, type);
    if (!ref) {
      setError("Paste a link from the website (for example …/apartments/<id>) or an id, and pick the kind.");
      return;
    }
    setError(null);
    router.push(ref.type === "profile" ? `/users/${ref.id}` : `/content/${ref.type}/${ref.id}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Look up content</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Link or id" htmlFor="lookup" className="min-w-0 flex-1">
            <Input id="lookup" value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://…/apartments/3f2c… or an id" autoComplete="off" />
          </Field>
          <Field label="Kind (for a bare id)" htmlFor="lookupType" className="sm:w-48">
            <Select id="lookupType" value={type} onChange={(e) => setType(e.target.value as ModerationTargetType)}>
              {MODERATION_TARGET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" className="sm:mb-0">
            <Search className="h-4 w-4" aria-hidden="true" />
            Open
          </Button>
        </form>
        {error ? (
          <div className="mt-3">
            <FormMessage error={error} />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
