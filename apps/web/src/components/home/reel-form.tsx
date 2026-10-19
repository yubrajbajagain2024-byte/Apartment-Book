"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/actions/types";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { VideoUploader } from "@/components/video/video-uploader";

/** One video plus a caption. The video uploads while the student writes the caption. */
export function ReelForm({ action, defaultUniversityId }: { action: (prev: FormState, formData: FormData) => Promise<FormState>; defaultUniversityId?: string | null }) {
  const [state, formAction, pending] = useActionState(action, null);
  const err = state?.fieldErrors;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormMessage error={state?.error} />
      {defaultUniversityId ? <input type="hidden" name="universityId" value={defaultUniversityId} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Your video</CardTitle>
          <p className="mt-1 text-sm text-gray-600">Vertical videos look best. Wait for &quot;Ready&quot; before you post.</p>
        </CardHeader>
        <CardBody>
          <VideoUploader tour={false} max={1} />
          {err?.videos ? <p className="mt-2 text-sm text-red-600">{err.videos[0]}</p> : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <Field label="Caption" htmlFor="body" error={err?.body} hint="Say what this is about. Optional.">
            <Textarea id="body" name="body" rows={3} maxLength={2200} defaultValue={state?.values?.body ?? ""} placeholder="Move-in day, campus food review, a tip for new students…" />
          </Field>
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <LinkButton href="/?tab=reels" variant="ghost">
          Cancel
        </LinkButton>
        <Button type="submit" size="lg" loading={pending}>
          Post reel
        </Button>
      </div>
    </form>
  );
}
