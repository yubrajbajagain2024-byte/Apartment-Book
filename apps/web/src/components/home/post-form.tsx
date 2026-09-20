"use client";

import { useActionState } from "react";
import { MAX_IMAGES_PER_POST } from "@apartment-book/shared";
import type { FormState } from "@/lib/actions/types";
import { Avatar } from "@/components/ui/avatar";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { ImageUploader } from "@/components/common/image-uploader";
import { VideoUploader } from "@/components/video/video-uploader";

/** Write a post: text first, then optional photos and one video. Posts show your name. */
export function PostForm({
  action,
  userId,
  author,
  defaultUniversityId,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  userId: string;
  author: { name: string; avatarUrl: string | null };
  defaultUniversityId?: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const err = state?.fieldErrors;
  const firstName = author.name.trim().split(/\s+/)[0] || "there";

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormMessage error={state?.error} />
      {defaultUniversityId ? <input type="hidden" name="universityId" value={defaultUniversityId} /> : null}

      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <Avatar name={author.name} src={author.avatarUrl} size="md" />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-gray-900">{author.name}</p>
              <p className="text-xs text-gray-500">Posting with your name. For anonymous threads use Buzz.</p>
            </div>
          </div>
          <Textarea id="body" name="body" rows={5} maxLength={4000} autoFocus defaultValue={state?.values?.body ?? ""} placeholder={`What's on your mind, ${firstName}?`} aria-label="Post text" />
          {err?.body ? (
            <p className="text-sm text-red-600" role="alert">
              {err.body[0]}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Photos (optional)</CardTitle>
        </CardHeader>
        <CardBody>
          <ImageUploader kind="posts" userId={userId} max={MAX_IMAGES_PER_POST} />
          {err?.images ? <p className="mt-2 text-sm text-red-600">{err.images[0]}</p> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Video (optional)</CardTitle>
          <p className="mt-1 text-sm text-gray-600">Add one video. Wait for &quot;Ready&quot; before you post.</p>
        </CardHeader>
        <CardBody>
          <VideoUploader tour={false} max={1} />
          {err?.videos ? <p className="mt-2 text-sm text-red-600">{err.videos[0]}</p> : null}
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <LinkButton href="/" variant="ghost">
          Cancel
        </LinkButton>
        <Button type="submit" size="lg" loading={pending}>
          Post
        </Button>
      </div>
    </form>
  );
}
