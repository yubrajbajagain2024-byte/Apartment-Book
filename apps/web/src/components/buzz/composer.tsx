"use client";

/**
 * The Buzz composer (UniVerse's `features/buzz/Composer.tsx`): a full-height sheet with the "You're anonymous"
 * banner, today's prompt when answering it, Campus / Global, a category (optional: one of BUZZ_CATEGORIES, click it
 * again for none), an optional title (100, Enter jumps to the body), the body (500), up to 4 photos OR one video
 * (≤ 60 s, refused before upload), a poll (2–4 options, 1 / 3 / 7 days, unlocked 24 h after joining) and the hero
 * "Buzz it". No avatar, no handle. Photos are re-encoded on the device
 * (no camera metadata) and go to the anonymous folder. The draft lives in memory only, for the session.
 */
import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import Link from "next/link";
import { BarChart3, Clapperboard, ImagePlus, Plus, RotateCw, Sparkles, VenetianMask, X } from "lucide-react";
import {
  BUZZ_CATEGORIES,
  BUZZ_CATEGORY_COPY,
  BUZZ_COMPOSER_COPY,
  BUZZ_LIMITS,
  BUZZ_POLL_DURATIONS,
  buzzCategory,
  buzzErrorMessage,
  type BuzzPollDuration,
  type CreateBuzzRequest,
} from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { buzzApi } from "./api";
import { buzzDate, useNow } from "./clock";
import { usePostingStatus, useBuzzMeta } from "./data";
import { ACCOUNT_STATUS_HREF, handleBuzzWriteError, showModerationNotice } from "./moderation";
import { buzzKeys, invalidateQueries } from "./query";
import { Sheet } from "./sheet";
import { buzzActions, buzzUi, useBuzzUi, type DraftPhoto } from "./store";
import { toast } from "./toast";
import { AutoTextarea, Button, Chip, ChipGroup, IconButton, SCOPE_OPTIONS, Segmented, TextInput, T } from "./ui";
import { BUZZ_VIDEO_MAX_SECONDS, BuzzVideoTooLong, readVideoMeta } from "./video-upload";

/* ───────────────────────────── shared composer pieces ───────────────────────────── */

/** The incognito half of the composer firewall: mask glyph + "You're anonymous". `inline` = the reply bar's pill. */
export function ComposerModeBanner({ note, inline, className }: { note?: string; inline?: boolean; className?: string }) {
  return (
    <div
      data-composer-mode="incognito"
      className={cn("flex items-center gap-2.5 bg-incog-hero-soft text-incog-ink", inline ? "min-h-8 rounded-full px-3 py-1" : "min-h-14 rounded-[20px] border border-incog-accent-line px-3.5 py-2.5", className)}
    >
      <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-incog-accent-soft text-incog-accent-ink", inline ? "size-6" : "size-9")}>
        <VenetianMask size={inline ? 14 : 18} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className={cn(inline ? T.caption : T.overline, "text-incog-accent-ink")}>{BUZZ_COMPOSER_COPY.banner}</span>
        {!inline ? <span className={cn("text-incog-ink-3", T.caption)}>{note ?? BUZZ_COMPOSER_COPY.defaultNote}</span> : null}
      </div>
    </div>
  );
}

/** While posting is not allowed (muted, suspended, an unread warning): the bar replaces the composer's controls. */
export function ComposerGuard({ children, className }: { children: ReactNode; className?: string }) {
  const status = usePostingStatus(true).data;
  if (!status || status.allowed) return <>{children}</>;
  const line =
    status.reason === "muted" && status.mutedUntil
      ? `Muted until ${buzzDate(status.mutedUntil)}`
      : status.reason === "warning"
        ? "Read the warning on your account to post again"
        : status.reason === "banned"
          ? "Posting is off on your account"
          : status.mutedUntil
            ? `Posting is paused until ${buzzDate(status.mutedUntil)}`
            : "Posting is paused on your account";
  return (
    <div role="status" className={cn("flex min-h-12 items-center justify-between gap-3 rounded-[20px] border border-incog-line bg-incog-surface-2 px-4 py-2 text-incog-ink-2", T.footnote, className)} data-testid="buzz-composer-guard">
      <span className="truncate">{line}</span>
      <Link href={ACCOUNT_STATUS_HREF} className={cn("shrink-0 text-incog-accent-ink", T.labelSm)}>
        Details
      </Link>
    </div>
  );
}


/* ───────────────────────────── photos ───────────────────────────── */

interface PendingPhoto {
  key: string;
  file: File;
  previewUrl: string;
  error: string | null;
}
let photoSeq = 0;

function PhotoTray({
  images,
  pending,
  disabled,
  onAdd,
  onRemove,
  onRetry,
  onCancel,
}: {
  images: DraftPhoto[];
  pending: PendingPhoto[];
  disabled: boolean;
  onAdd(files: FileList | null): void;
  onRemove(index: number): void;
  onRetry(p: PendingPhoto): void;
  onCancel(p: PendingPhoto): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const used = images.length + pending.length;
  const canAdd = !disabled && used < BUZZ_LIMITS.images;
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          onAdd(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" data-no-swipe>
        {images.map((img, i) => (
          <div key={`${img.url}-${i}`} className="relative size-24 shrink-0 overflow-hidden rounded-[14px] bg-incog-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- the re-encoded copy that was uploaded */}
            <img src={img.url} alt={`Photo ${i + 1}`} className="size-full object-cover" draggable={false} />
            {!disabled ? <IconButton icon={X} aria-label={`Remove photo ${i + 1}`} size="sm" variant="glass" onClick={() => onRemove(i)} className="absolute top-1 right-1 size-7" /> : null}
          </div>
        ))}
        {pending.map((p) => (
          <div key={p.key} className="relative size-24 shrink-0 overflow-hidden rounded-[14px] bg-incog-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview, never uploaded as is */}
            <img src={p.previewUrl} alt="" className={cn("size-full object-cover", p.error ? "opacity-40" : "opacity-70")} draggable={false} />
            {p.error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 p-1 text-center">
                <span className={cn("line-clamp-2 text-white", T.micro)}>{p.error}</span>
                <div className="flex gap-1">
                  <IconButton icon={RotateCw} aria-label="Retry upload" size="sm" variant="glass" onClick={() => onRetry(p)} className="size-7" />
                  <IconButton icon={X} aria-label="Cancel upload" size="sm" variant="glass" onClick={() => onCancel(p)} className="size-7" />
                </div>
              </div>
            ) : (
              <div className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-white/25">
                <div className="h-full w-1/2 rounded-full bg-incog-accent motion-safe:animate-pulse" />
              </div>
            )}
          </div>
        ))}
        {canAdd ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            aria-label={`Add photos, ${used} of ${BUZZ_LIMITS.images}`}
            className="flex size-24 shrink-0 flex-col items-center justify-center gap-1 rounded-[14px] border border-dashed border-incog-line-strong bg-incog-surface-1 text-incog-ink-3 transition-colors hover:text-incog-ink"
          >
            <ImagePlus size={22} strokeWidth={1.75} aria-hidden="true" />
            <span className={T.micro}>
              {used}/{BUZZ_LIMITS.images}
            </span>
          </button>
        ) : null}
      </div>
      <p className={cn("text-incog-ink-3", T.caption)}>{BUZZ_COMPOSER_COPY.mediaHint}</p>
    </div>
  );
}

/* ───────────────────────────── the sheet ───────────────────────────── */

export function BuzzComposer() {
  const open = useBuzzUi((s) => s.composerOpen);
  if (!open) return null;
  return <ComposerSheet />;
}

function ComposerSheet() {
  const draft = useBuzzUi((s) => s.draft);
  const feedScope = useBuzzUi((s) => s.scope);
  const meta = useBuzzMeta(feedScope, true).data;
  const posting = usePostingStatus(true).data;
  const now = useNow();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [video, setVideo] = useState<{ phase: "uploading" | "processing"; progress: number } | null>(null);
  const [submitting, setPosting] = useState(false);

  const campus = meta?.campus?.shortName ?? "your campus";
  const pollsLocked = posting?.pollsUnlockAt != null && posting.pollsUnlockAt > now;
  const text = draft.text.trim();
  const title = draft.title.trim();
  const options = draft.options.map((o) => o.trim());
  const filled = options.filter(Boolean);
  const pollValid = !draft.pollOn || (filled.length >= BUZZ_LIMITS.pollMinOptions && filled.length === options.length && new Set(options.map((o) => o.toLowerCase())).size === options.length);
  const photosBusy = pendingPhotos.some((p) => p.error === null);
  const uploading = photosBusy || video !== null;
  const canSubmit = (text.length > 0 || title.length > 0) && text.length <= BUZZ_LIMITS.text && title.length <= BUZZ_LIMITS.title && pollValid && !uploading && !submitting && (!draft.pollOn || !pollsLocked);
  const prompt = draft.promptId && meta?.prompt?.id === draft.promptId ? meta.prompt : null;
  const category = buzzCategory(draft.category);

  /* photos */
  const upload = (p: PendingPhoto) => {
    buzzApi
      .uploadPhoto(p.file)
      .then((photo) => {
        setPendingPhotos((list) => list.filter((x) => x.key !== p.key));
        URL.revokeObjectURL(p.previewUrl);
        const images = buzzUi.get().draft.images;
        buzzActions.setDraft({ images: [...images, { url: photo.url, width: photo.width, height: photo.height, blur: photo.blur }].slice(0, BUZZ_LIMITS.images) });
      })
      .catch((e: unknown) => {
        setPendingPhotos((list) => list.map((x) => (x.key === p.key ? { ...x, error: e instanceof Error ? e.message : "Upload failed" } : x)));
      });
  };
  const addPhotos = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = Math.max(0, BUZZ_LIMITS.images - draft.images.length - pendingPhotos.length);
    const picked = Array.from(files)
      .filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name))
      .slice(0, room);
    if (picked.length === 0) {
      toast.info(`You can add up to ${BUZZ_LIMITS.images} photos.`);
      return;
    }
    const tiles = picked.map((file) => ({ key: `photo-${++photoSeq}`, file, previewUrl: URL.createObjectURL(file), error: null }));
    setPendingPhotos((list) => [...list, ...tiles]);
    // Photos and a video don't mix: adding photos drops the video.
    if (draft.video) buzzActions.setDraft({ video: null });
    tiles.forEach(upload);
  };
  const retryPhoto = (p: PendingPhoto) => {
    setPendingPhotos((list) => list.map((x) => (x.key === p.key ? { ...x, error: null } : x)));
    upload({ ...p, error: null });
  };
  const cancelPhoto = (p: PendingPhoto) => {
    setPendingPhotos((list) => list.filter((x) => x.key !== p.key));
    URL.revokeObjectURL(p.previewUrl);
  };

  /* video */
  const pickVideo = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const m = await readVideoMeta(file);
      if (m.durationSeconds !== null && m.durationSeconds > BUZZ_VIDEO_MAX_SECONDS) {
        toast.error(BUZZ_COMPOSER_COPY.videoTooLong);
        return;
      }
      setVideo({ phase: "uploading", progress: 0 });
      const res = await buzzApi.uploadVideo(file, (progress, phase) => setVideo({ phase, progress }));
      buzzActions.setDraft({ video: { ...res, previewUrl: URL.createObjectURL(file) }, images: [] });
    } catch (err) {
      toast.error(err instanceof BuzzVideoTooLong ? BUZZ_COMPOSER_COPY.videoTooLong : err instanceof Error ? err.message : "The video could not be uploaded.");
    } finally {
      setVideo(null);
    }
  };
  const removeVideo = () => {
    if (draft.video?.previewUrl) URL.revokeObjectURL(draft.video.previewUrl);
    buzzActions.setDraft({ video: null });
  };

  /* poll */
  const setOption = (i: number, v: string) => buzzActions.setDraft({ options: draft.options.map((o, k) => (k === i ? v : o)) });
  const addOption = () => draft.options.length < BUZZ_LIMITS.pollMaxOptions && buzzActions.setDraft({ options: [...draft.options, ""] });
  const removeOption = (i: number) => draft.options.length > BUZZ_LIMITS.pollMinOptions && buzzActions.setDraft({ options: draft.options.filter((_, k) => k !== i) });

  const submit = async () => {
    if (!canSubmit) return;
    const body: CreateBuzzRequest = {
      text,
      scope: draft.scope,
      ...(draft.category ? { category: draft.category } : {}),
      ...(title ? { title } : {}),
      ...(draft.video
        ? { video: { playbackId: draft.video.playbackId, posterUrl: draft.video.posterUrl, width: draft.video.width, height: draft.video.height, durationSeconds: draft.video.durationSeconds } }
        : draft.images.length
          ? { images: draft.images.map((i) => i.url), imageMeta: draft.images }
          : {}),
      ...(draft.pollOn ? { poll: { options, durationDays: draft.durationDays } } : {}),
      ...(draft.promptId ? { promptId: draft.promptId } : {}),
    };
    setPosting(true);
    try {
      const res = await buzzApi.create(body);
      showModerationNotice(res.moderation);
      if (res.moderation.status !== "held") toast.success(BUZZ_COMPOSER_COPY.posted(res.scope, res.alias.label));
      // Show the feed the buzz went to, so it's right there.
      if (buzzUi.get().scope !== res.scope) buzzActions.setScope(res.scope);
      buzzActions.clearDraft();
      buzzActions.closeComposer();
      invalidateQueries(buzzKeys.feeds);
      invalidateQueries(buzzKeys.mine);
    } catch (e) {
      if (!handleBuzzWriteError(e, { onEdit: () => textRef.current?.focus() })) toast.error(buzzErrorMessage(e));
    } finally {
      setPosting(false);
    }
  };

  return (
    <Sheet
      open
      onClose={buzzActions.closeComposer}
      title={BUZZ_COMPOSER_COPY.title}
      size="full"
      footer={
        <ComposerGuard>
          {/* Its own line: next to the chips on a phone it would be cut off. */}
          {uploading || pollsLocked ? <p className={cn("mb-2 text-incog-ink-3", T.caption)}>{uploading ? "Uploading…" : BUZZ_COMPOSER_COPY.pollsLocked}</p> : null}
          <div className="flex items-center gap-2">
            <Chip selected={draft.pollOn} leftIcon={BarChart3} disabled={pollsLocked || submitting} onClick={() => buzzActions.setDraft({ pollOn: !draft.pollOn })}>
              Poll
            </Chip>
            <Chip selected={draft.video !== null} leftIcon={Clapperboard} disabled={video !== null || submitting} onClick={() => (draft.video ? removeVideo() : videoInput.current?.click())}>
              Video
            </Chip>
            <span className="flex-1" />
            <Button variant="hero" size="md" disabled={!canSubmit} loading={submitting} onClick={() => void submit()} data-testid="buzz-submit">
              {BUZZ_COMPOSER_COPY.submit}
            </Button>
          </div>
        </ComposerGuard>
      }
    >
      <div className="flex flex-col gap-4 px-4 pt-1 pb-4" data-testid="buzz-composer">
        <ComposerModeBanner note={meta?.smallCampusNote ? BUZZ_COMPOSER_COPY.smallCampusNote : BUZZ_COMPOSER_COPY.defaultNote} />
        {prompt ? (
          <div className="flex items-center gap-2 rounded-[14px] bg-incog-surface-3 px-3 py-2">
            <Sparkles size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-incog-accent-ink" />
            <span className={cn("min-w-0 flex-1 truncate text-incog-ink-2", T.footnote)}>{BUZZ_COMPOSER_COPY.promptAttached(prompt.text)}</span>
            <IconButton icon={X} aria-label="Detach prompt" size="sm" onClick={() => buzzActions.setDraft({ promptId: null })} />
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Segmented aria-label="Post to" value={draft.scope} onChange={(scope) => buzzActions.setDraft({ scope })} options={SCOPE_OPTIONS} className="self-start" />
          <span className={cn("text-incog-ink-3", T.caption)}>{draft.scope === "campus" ? BUZZ_COMPOSER_COPY.campusScopeNote(campus) : BUZZ_COMPOSER_COPY.globalScopeNote}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <div role="group" aria-label={BUZZ_CATEGORY_COPY.label} data-no-swipe="" className="-mx-4 flex flex-nowrap gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none]">
            {BUZZ_CATEGORIES.map((c) => (
              <Chip key={c.value} size="sm" selected={draft.category === c.value} onClick={() => buzzActions.setDraft({ category: buzzUi.get().draft.category === c.value ? null : c.value })}>
                <span aria-hidden="true">{c.emoji}</span> {c.label}
              </Chip>
            ))}
          </div>
          <span className={cn("text-incog-ink-3", T.caption)}>{category ? `${category.label}: ${category.hint}` : BUZZ_CATEGORY_COPY.none}</span>
        </div>
        <AutoTextarea
          ref={titleRef}
          data-autofocus=""
          aria-label="Title"
          placeholder={BUZZ_COMPOSER_COPY.titlePlaceholder}
          value={draft.title}
          maxLength={BUZZ_LIMITS.title}
          minRows={1}
          maxRows={3}
          onChange={(e) => buzzActions.setDraft({ title: e.target.value.replace(/\n/g, " ") })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              textRef.current?.focus();
            }
          }}
          className={T.bodyLg}
        />
        <AutoTextarea
          ref={textRef}
          aria-label="Your buzz"
          placeholder={BUZZ_COMPOSER_COPY.bodyPlaceholder}
          value={draft.text}
          maxLength={BUZZ_LIMITS.text}
          minRows={4}
          maxRows={12}
          showCount
          onChange={(e) => buzzActions.setDraft({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          className={T.bodyLg}
        />
        <input ref={videoInput} type="file" accept="video/mp4,video/quicktime" hidden onChange={(e) => void pickVideo(e)} />
        {video ? (
          <div className="flex flex-col gap-2 rounded-[20px] border border-incog-line bg-incog-surface-1 p-3" aria-live="polite">
            <span className={cn("text-incog-ink", T.labelSm)}>{video.phase === "uploading" ? `Uploading video… ${video.progress}%` : "Making it streamable…"}</span>
            <div className="h-1.5 overflow-hidden rounded-full bg-incog-surface-3" role="progressbar" aria-label="Video upload" aria-valuenow={video.progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-incog-accent transition-[width] duration-300" style={{ width: `${video.phase === "processing" ? 100 : video.progress}%` }} />
            </div>
          </div>
        ) : draft.video ? (
          <div
            className="relative overflow-hidden rounded-[20px] bg-incog-surface-1"
            style={{ aspectRatio: draft.video.width && draft.video.height ? String(Math.min(1.78, Math.max(0.75, draft.video.width / draft.video.height))) : "16 / 9" }}
          >
            {draft.video.previewUrl ? <video src={`${draft.video.previewUrl}#t=0.1`} controls playsInline preload="metadata" className="absolute inset-0 size-full object-contain" aria-label="Your video" /> : null}
            <IconButton icon={X} aria-label="Remove video" size="sm" variant="glass" className="absolute top-2 right-2" onClick={removeVideo} />
          </div>
        ) : (
          <PhotoTray
            images={draft.images}
            pending={pendingPhotos}
            disabled={submitting}
            onAdd={addPhotos}
            onRemove={(i) => buzzActions.setDraft({ images: draft.images.filter((_, k) => k !== i) })}
            onRetry={retryPhoto}
            onCancel={cancelPhoto}
          />
        )}
        {draft.pollOn ? (
          <div className="flex flex-col gap-3 rounded-[20px] border border-incog-line bg-incog-surface-1 p-3" data-testid="buzz-poll-builder">
            <div className="flex items-center justify-between gap-2">
              <span className={cn("text-incog-ink", T.labelSm)}>Poll</span>
              <span className={cn("text-incog-ink-3", T.caption)}>{BUZZ_COMPOSER_COPY.pollHint}</span>
            </div>
            {draft.options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <TextInput aria-label={`Option ${i + 1}`} placeholder={`Option ${i + 1}`} value={o} maxLength={BUZZ_LIMITS.pollOptionText} onChange={(e) => setOption(i, e.target.value)} />
                {draft.options.length > BUZZ_LIMITS.pollMinOptions ? <IconButton icon={X} aria-label={`Remove option ${i + 1}`} size="sm" onClick={() => removeOption(i)} /> : null}
              </div>
            ))}
            {draft.options.length < BUZZ_LIMITS.pollMaxOptions ? (
              <Button variant="ghost" size="sm" leftIcon={Plus} onClick={addOption} className="self-start">
                Add option
              </Button>
            ) : null}
            <ChipGroup<`${BuzzPollDuration}`>
              aria-label="Poll duration"
              size="sm"
              value={`${draft.durationDays}`}
              onChange={(v) => buzzActions.setDraft({ durationDays: Number(v) as BuzzPollDuration })}
              options={BUZZ_POLL_DURATIONS.map((d) => ({ value: `${d}` as `${BuzzPollDuration}`, label: d === 1 ? "1 day" : `${d} days` }))}
            />
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
