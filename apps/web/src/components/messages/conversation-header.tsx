"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Info, LogOut, UserPlus, X } from "lucide-react";
import type { ConversationSummary, ProfileSummary } from "@apartment-book/shared";
import { addMembersAction, leaveGroupAction, renameGroupAction } from "@/lib/actions/messages";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActivityLine } from "@/components/presence/use-activity-line";
import { ConversationAvatar } from "./conversation-list";
import { MemberPicker } from "./member-picker";
import { useMessagesPaths } from "./messages-paths";

export function ConversationHeader({ conversation, currentUserId }: { conversation: ConversationSummary; currentUserId: string }) {
  const [open, setOpen] = useState(false);
  const paths = useMessagesPaths();
  // A student's chat with a business: the team answers, so there is no one person's activity to show, nor a profile.
  const business = conversation.business;
  const other = conversation.otherMembers[0];
  const isGroup = conversation.type === "group";
  // Direct chats: "Active now" with a green dot or when they were last active; with no status to show, "Direct message"
  // as always. While a status that was there is being checked again (back to the tab, a reconnect, they just left), the
  // line stays blank rather than claiming there is none.
  const teamInbox = paths.audience === "business";
  const { line, waiting } = useActivityLine(isGroup || business || teamInbox ? null : (other?.id ?? null), conversation.id);
  const subtitle = isGroup
    ? `${conversation.members.length} members`
    : teamInbox
      ? "Student inquiry"
      : business
      ? business.verified_partner
        ? "Verified Partner"
        : "Business"
      : conversation.anonymous?.role === "asker" && conversation.anonymous.hidden
        ? (conversation.anonymous.target?.title ?? "Anonymous listing")
        : (line?.label ?? (waiting ?" " : other ? "Direct message" : ""));

  return (
    <div className="border-b border-gray-200">
      <div className="flex h-14 items-center gap-2 px-2 sm:px-4">
        <Link href={paths.base} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100 md:hidden" aria-label="Back to chats">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <ConversationAvatar conversation={conversation} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-gray-900">{conversation.title}</p>
          <p className={cn("flex items-center gap-1 text-xs", line?.online ? "text-green-600" : "text-gray-500")} data-testid="activity">
            {line?.online ? <span aria-hidden="true" data-testid="activity-dot" className="h-2 w-2 shrink-0 rounded-full bg-green-500" /> : null}
            <span className="min-w-0 truncate">{subtitle}</span>
          </p>
        </div>
        {conversation.type === "group" ? (
          <button type="button" onClick={() => setOpen((v) => !v)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100" aria-label="Group info" aria-expanded={open}>
            {open ? <X className="h-5 w-5" /> : <Info className="h-5 w-5" />}
          </button>
        ) : other && paths.profile && !business ? (
          <Link href={`${paths.profile}/${other.id}`} className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-brand-50">
            View profile
          </Link>
        ) : null}
      </div>
      {open && conversation.type === "group" ? <GroupInfo conversation={conversation} currentUserId={currentUserId} /> : null}
    </div>
  );
}

function GroupInfo({ conversation, currentUserId }: { conversation: ConversationSummary; currentUserId: string }) {
  const [name, setName] = useState(conversation.name ?? "");
  const [adding, setAdding] = useState<ProfileSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A course chat is named after its class and fills itself from the class list: nothing to rename, nobody to add.
  if (conversation.courseGroup) {
    const g = conversation.courseGroup;
    return (
      <div className="flex flex-col gap-3 border-t border-gray-100 bg-gray-50 px-4 py-4">
        <p className="text-sm text-gray-700">
          Course chat: everyone at your university taking <span className="font-semibold">{g.code}</span> section <span className="font-semibold">{g.section}</span> in {g.term}. Classmates join by
          adding the class to their profile and leave by removing it; the chat is deleted when the semester ends.
        </p>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Members</p>
          <ul className="flex flex-col gap-1">
            {conversation.members.map((m) => (
              <li key={m.id}>
                <Link href={`/profile/${m.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-white">
                  <Avatar name={m.full_name} src={m.avatar_url} size="sm" />
                  {m.full_name}
                  {m.id === currentUserId ? <span className="text-xs text-gray-500">(you)</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 border-t border-gray-100 bg-gray-50 px-4 py-4 md:grid-cols-2">
      <div className="flex flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await renameGroupAction(conversation.id, name);
              setError(result.error ?? null);
            });
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Group name" maxLength={80} />
          <Button type="submit" variant="secondary" loading={pending} disabled={name.trim() === (conversation.name ?? "")}>
            Rename
          </Button>
        </form>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Members</p>
          <ul className="flex flex-col gap-1">
            {conversation.members.map((m) => (
              <li key={m.id}>
                <Link href={`/profile/${m.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-white">
                  <Avatar name={m.full_name} src={m.avatar_url} size="sm" />
                  {m.full_name}
                  {m.id === currentUserId ? <span className="text-xs text-gray-500">(you)</span> : null}
                  {m.id === conversation.createdBy ? <span className="text-xs text-gray-500">· creator</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <UserPlus className="h-3.5 w-3.5" /> Add people
          </p>
          <MemberPicker selected={adding} onChange={setAdding} excludeIds={conversation.members.map((m) => m.id)} />
          {adding.length > 0 ? (
            <Button
              className="mt-2"
              size="sm"
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await addMembersAction(conversation.id, adding.map((p) => p.id));
                  setError(result.error ?? null);
                  if (!result.error) setAdding([]);
                })
              }
            >
              Add {adding.length} {adding.length === 1 ? "person" : "people"}
            </Button>
          ) : null}
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button
          variant="outline"
          size="sm"
          className="self-start text-red-600"
          loading={pending}
          onClick={() => {
            if (!window.confirm("Leave this group?")) return;
            startTransition(async () => {
              await leaveGroupAction(conversation.id);
            });
          }}
        >
          <LogOut className="h-4 w-4" /> Leave group
        </Button>
      </div>
    </div>
  );
}
