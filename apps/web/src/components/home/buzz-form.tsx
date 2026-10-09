"use client";

import { useActionState } from "react";
import { VenetianMask } from "lucide-react";
import { BUZZ_TOPICS, MAX_IMAGES_PER_BUZZ } from "@apartment-book/shared";
import type { FormState } from "@/lib/actions/types";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { VideoUploader } from "@/components/video/video-uploader";
import { cn } from "@/lib/utils";
import { BuzzImageUploader } from "./buzz-image-uploader";

/** Start an anonymous Buzz thread: topic, title, text, then optional photos and one video. */
export function BuzzForm({ action }: { action: (prev: FormState, formData: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, null);
  const err = state?.fieldErrors;
  const values = state?.values;

  return (
    <form action={formAction} className="flex flex-col gap-5" data-testid="buzz-form">
      <div className="flex items-start gap-3 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900 ring-1 ring-brand-100" role="note">
        <VenetianMask className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
        <ul className="flex list-disc flex-col gap-0.5 pl-4">
          <li>This thread is anonymous. Your name and profile are never shown, only a random name like &quot;Student 48213&quot;.</li>
          <li>Be kind. Share thoughts, experiences and advice, not attacks.</li>
          <li>Do not post names or personal details of other people.</li>
          <li>Reports are reviewed, and threads that break the rules are removed.</li>
        </ul>
      </div>

      <FormMessage error={state?.error} />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium text-gray-800">
              Topic<span className="text-red-500"> *</span>
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {BUZZ_TOPICS.map((t) => (
                <label key={t.value} className="cursor-pointer">
                  <input type="radio" name="topic" value={t.value} defaultChecked={values?.topic === t.value} required className="peer sr-only" />
                  <span className={cn("inline-flex h-8 items-center rounded-full bg-brand-50 px-3.5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100", "peer-checked:bg-brand-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-1")}>
                    {t.label}
                  </span>
                </label>
              ))}
            </div>
            {err?.topic ? (
              <p className="text-sm text-red-600" role="alert">
                {err.topic[0]}
              </p>
            ) : null}
          </fieldset>

          <Field label="Title" htmlFor="title" required error={err?.title}>
            <Input id="title" name="title" maxLength={160} required minLength={3} defaultValue={values?.title ?? ""} placeholder="What do you want to talk about?" />
          </Field>

          <Field label="Your thoughts (optional)" htmlFor="body" error={err?.body}>
            <Textarea id="body" name="body" rows={7} maxLength={6000} defaultValue={values?.body ?? ""} placeholder="Tell the story, ask your question or share your advice…" />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Photos (optional)</CardTitle>
        </CardHeader>
        <CardBody>
          <BuzzImageUploader max={MAX_IMAGES_PER_BUZZ} />
          {err?.images ? <p className="mt-2 text-sm text-red-600">{err.images[0]}</p> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Video (optional)</CardTitle>
          <p className="mt-1 text-sm text-gray-600">Add one video and wait for &quot;Ready&quot; before you post. People can recognise a voice or a face, so check what the video shows.</p>
        </CardHeader>
        <CardBody>
          <VideoUploader tour={false} max={1} />
          {err?.videos ? <p className="mt-2 text-sm text-red-600">{err.videos[0]}</p> : null}
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <LinkButton href="/?tab=buzz" variant="ghost">
          Cancel
        </LinkButton>
        <Button type="submit" size="lg" loading={pending} data-testid="buzz-submit">
          Post anonymously
        </Button>
      </div>
    </form>
  );
}
