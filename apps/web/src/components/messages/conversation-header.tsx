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

export function ConversationHeader({ conversation, currentUserId }: { conversation: ConversationSummary; currentUserId: string }) {
  const [open, setOpen] = useState(false);
  const other = conversation.otherMembers[0];
  const isGroup = conversation.type === "group";
  // Direct chats: "Active now" with a green dot or when they were last active; with no status to show, "Direct message"
  // as always. While a status that was there is being checked again (back to the tab, a reconnect, they just left), the
  // line stays blank rather than claiming there is none.
  const { line, waiting } = useActivityLine(isGroup ? null : (other?.id ?? null), conversation.id);

  return (
    <div className="border-b border-gray-200">
      <div className="flex h-14 items-center gap-2 px-2 sm:px-4">
        <Link href="/messages" className="ab-press flex h-9 w-9 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 md:hidden" aria-label="Back to chats">
          <ArrowLeft className="h-5 w-5" strokeWidth={1.75} />
        </Link>
        <ConversationAvatar conversation={conversation} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-gray-900">{conversation.title}</p>
          <p className={cn("flex items-center gap-1 text-xs", line?.online ? "text-green-600" : "text-gray-500")} data-testid="activity">
            {line?.online ? <span aria-hidden="true" data-testid="activity-dot" className="h-2 w-2 shrink-0 rounded-full bg-green-500" /> : null}
            <span className="min-w-0 truncate">{isGroup ? `${conversation.members.length} members` : (line?.label ?? (waiting ? " " : other ? "Direct message" : ""))}</span>
          </p>
        </div>
        {conversation.type === "group" ? (
          <button type="button" onClick={() => setOpen((v) => !v)} className={cn("ab-press flex h-9 w-9 items-center justify-center rounded-full text-gray-700 transition-colors hover:bg-gray-100", open && "bg-gray-100 text-gray-900")} aria-label="Group info" aria-expanded={open}>
            {open ? <X className="h-5 w-5" strokeWidth={1.75} /> : <Info className="h-5 w-5" strokeWidth={1.75} />}
          </button>
        ) : other ? (
          <Link href={`/profile/${other.id}`} className="ab-press inline-flex h-8 items-center rounded-full px-3 text-[13px] font-semibold text-gray-900 ring-1 ring-gray-200 transition-colors hover:bg-gray-50">
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
      <div className="ab-fade-in flex flex-col gap-4 border-t border-gray-100 px-4 py-4">
        <p className="text-sm leading-relaxed text-gray-600">
          Course chat: everyone at your university taking <span className="font-semibold">{g.code}</span> section <span className="font-semibold">{g.section}</span> in {g.term}. Classmates join by
          adding the class to their profile and leave by removing it; the chat is deleted when the semester ends.
        </p>
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Members</p>
          <ul className="flex flex-col gap-0.5">
            {conversation.members.map((m) => (
              <li key={m.id}>
                <Link href={`/profile/${m.id}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-gray-900 transition-colors hover:bg-gray-50">
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
    <div className="ab-fade-in grid gap-5 border-t border-gray-100 px-4 py-4 md:grid-cols-2">
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
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Members</p>
          <ul className="flex flex-col gap-0.5">
            {conversation.members.map((m) => (
              <li key={m.id}>
                <Link href={`/profile/${m.id}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-gray-900 transition-colors hover:bg-gray-50">
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
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">
            <UserPlus className="h-3.5 w-3.5" strokeWidth={1.75} /> Add people
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
          <LogOut className="h-4 w-4" strokeWidth={1.75} /> Leave group
        </Button>
      </div>
    </div>
  );
}
