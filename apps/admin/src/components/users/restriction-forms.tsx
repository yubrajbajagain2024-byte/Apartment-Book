"use client";

import { useActionState, useState } from "react";
import { UserCheck, UserX } from "lucide-react";
import { suspendUserAction, unsuspendUserAction } from "@/lib/actions/moderation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";

const DURATIONS = [
  { value: "", label: "Until lifted by staff" },
  { value: "1", label: "1 day" },
  { value: "3", label: "3 days" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "custom", label: "Pick a date and time" },
] as const;

/** Suspend an account: reason the person sees, how long, and a note for staff. */
export function SuspendForm({ userId, name, reportId }: { userId: string; name: string; reportId?: string }) {
  const [state, action, pending] = useActionState(suspendUserAction, null);
  const [duration, setDuration] = useState<string>("");
  // A picked date is converted here, in the browser, because only it knows the staff member's timezone;
  // a number of days is turned into an instant by the server action.
  const [custom, setCustom] = useState({ local: "", iso: "" });

  return (
    <Card className="ring-red-200">
      <CardHeader>
        <CardTitle className="text-base text-red-700">Suspend {name}</CardTitle>
      </CardHeader>
      <form action={action} className="flex flex-col gap-4 px-5 py-4">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="expiresAt" value={duration === "custom" ? custom.iso : ""} />
        <input type="hidden" name="durationDays" value={duration === "custom" ? "" : duration} />
        {reportId ? <input type="hidden" name="reportId" value={reportId} /> : null}
        <p className="text-sm text-gray-600">
          Takes effect at once, in the app and on the website: their current session can no longer post, comment, message or upload, their listings and posts disappear for
          everyone else, and their next sign-in is refused. Buzz is left alone so the suspension cannot point at anonymous threads.
        </p>
        <FormMessage error={state?.error} success={state?.success} />
        <Field label="Reason shown to the person" htmlFor="suspendReason" required error={state?.fieldErrors?.reason} hint="3 to 500 characters. They read this when they try to post.">
          <Textarea id="suspendReason" name="reason" required minLength={3} maxLength={500} defaultValue={state?.values?.reason} placeholder="Repeated scam listings after a warning." />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="How long" htmlFor="suspendDuration" error={state?.fieldErrors?.expiresAt}>
            <Select id="suspendDuration" value={duration} onChange={(e) => setDuration(e.target.value)}>
              {DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          {duration === "custom" ? (
            <Field label="Ends at" htmlFor="suspendUntil" required>
              <Input
                id="suspendUntil"
                type="datetime-local"
                required
                value={custom.local}
                onChange={(e) => setCustom({ local: e.target.value, iso: e.target.value && !Number.isNaN(new Date(e.target.value).getTime()) ? new Date(e.target.value).toISOString() : "" })}
              />
            </Field>
          ) : null}
        </div>
        <Field label="Note for staff" htmlFor="suspendNote" error={state?.fieldErrors?.note} hint="Only the team sees this.">
          <Textarea id="suspendNote" name="note" maxLength={2000} defaultValue={state?.values?.note} className="min-h-20" />
        </Field>
        <Button type="submit" variant="danger" loading={pending} className="self-start">
          <UserX className="h-4 w-4" aria-hidden="true" />
          Suspend{reportId ? " and resolve report" : ""}
        </Button>
      </form>
    </Card>
  );
}

/** Lift a suspension early. */
export function LiftForm({ userId, name }: { userId: string; name: string }) {
  const [state, action, pending] = useActionState(unsuspendUserAction, null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Lift the suspension</CardTitle>
      </CardHeader>
      <form action={action} className="flex flex-col gap-4 px-5 py-4">
        <input type="hidden" name="userId" value={userId} />
        <p className="text-sm text-gray-600">{name} can post and sign in again right away; their content becomes visible to everyone else.</p>
        <FormMessage error={state?.error} success={state?.success} />
        <Field label="Note for staff" htmlFor="liftNote" hint="Why it was lifted. Only the team sees this.">
          <Textarea id="liftNote" name="note" maxLength={2000} className="min-h-20" />
        </Field>
        <Button type="submit" variant="outline" loading={pending} className="self-start">
          <UserCheck className="h-4 w-4" aria-hidden="true" />
          Lift suspension
        </Button>
      </form>
    </Card>
  );
}
