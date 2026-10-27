"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Link2, UserCheck, Users, type LucideIcon } from "lucide-react";
import { captionParts, profileIdByUsername, type PostAudience } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { audienceLabel, linkLabel } from "@/lib/post-details";
import { cn } from "@/lib/utils";

/** How long the note under a mention that leads nowhere stays up. */
const NOTE_MS = 2600;

/**
 * A caption's words with its #hashtags and @mentions picked out (in `tagClassName`); a mention opens the profile it
 * names. `cut` shows only the first that many characters (a folded caption): a tag or mention the fold cuts through is
 * plain text, so a half-shown "@unib" never opens somebody else's profile.
 */
export function CaptionText({ text, cut, tagClassName = "text-[#00376b]" }: { text: string; cut?: number; tagClassName?: string }) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const [i, part] of captionParts(text).entries()) {
    if (cut !== undefined && at >= cut) break;
    const whole = cut === undefined || at + part.text.length <= cut;
    const shown = whole ? part.text : part.text.slice(0, cut - at);
    at += part.text.length;
    if (!whole || (!part.tag && !part.mention)) out.push(shown);
    else if (part.mention) out.push(<MentionLink key={i} username={part.mention} text={shown} className={tagClassName} />);
    else
      out.push(
        <span key={i} className={tagClassName}>
          {shown}
        </span>,
      );
  }
  return <>{out}</>;
}

/**
 * An @mention. The profile route takes an id, and a caption keeps only the username as it was written (usernames can
 * change), so the username is looked up when it is clicked; one that leads nowhere now says so in a small note over it.
 * The note is fixed to the window, so a card's or a scrolling caption's overflow never clips it.
 */
function MentionLink({ username, text, className }: { username: string; text: string; className?: string }) {
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; top: number; left: number } | null>(null);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  function say(message: string) {
    const rect = button.current?.getBoundingClientRect();
    if (rect) setNote({ text: message, top: rect.top - 6, left: Math.max(8, rect.left) });
  }

  async function open() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const id = await profileIdByUsername(createClient(), username);
      if (id) router.push(`/profile/${id}`);
      else say("No one has that username now.");
    } catch {
      say("Couldn't open this profile. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button ref={button} type="button" onClick={() => void open()} className={cn("hover:underline", busy && "cursor-progress", className)}>
        {text}
      </button>
      {note ? (
        <span role="status" style={{ top: note.top, left: note.left }} className="pointer-events-none fixed z-50 -translate-y-full whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-lg [text-shadow:none]">
          {note.text}
        </span>
      ) : null}
    </>
  );
}

/**
 * A post's one link, under its words: a compact rounded chip with the link icon and where it goes
 * ("instagram.com/unibuzz…"), on one line. It leaves the site in a new tab and passes on no referrer or ranking.
 * `onMedia`: drawn over a video (a reel), white on the dark glass of the reel's other controls.
 */
export function PostLinkChip({ url, onMedia, className }: { url: string; onMedia?: boolean; className?: string }) {
  const label = linkLabel(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      title={url}
      className={cn(
        "inline-flex h-8 max-w-full items-center gap-1.5 self-start rounded-full px-3 text-[13px] font-semibold transition-colors",
        onMedia ? "bg-black/45 text-white backdrop-blur hover:bg-black/60" : "bg-gray-100 text-gray-900 hover:bg-gray-200",
        className,
      )}
      data-testid="post-link"
    >
      <Link2 className={cn("h-4 w-4 shrink-0", !onMedia && "text-brand-600")} aria-hidden />
      <span className="truncate">{label}</span>
    </a>
  );
}

/** The glyph before a post's audience (Global has none: it is every post's default). */
const AUDIENCE_ICON: Record<Exclude<PostAudience, "global">, LucideIcon> = { campus: GraduationCap, friends: Users, selected: UserCheck };

/**
 * Your own post that is not Global: who can see it, after its age ("2h · 🎓 Texas State"). `universityName` names a
 * campus post's university; without it the label reads "Campus only".
 */
export function AudienceNote({ audience, universityName, className }: { audience: Exclude<PostAudience, "global">; universityName?: string | null; className?: string }) {
  const Icon = AUDIENCE_ICON[audience];
  const label = audienceLabel(audience, universityName);
  return (
    <span className={cn("inline-flex items-center gap-1", className)} title={`Who can see it: ${label}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

/** Where the comment thread would be on a post whose author turned comments off (the database refuses new ones). */
export function CommentsOff({ className }: { className?: string }) {
  return <p className={cn("border-t border-gray-100 px-3 py-3 text-center text-sm text-gray-500", className)}>Comments are turned off</p>;
}
