"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Circle, RotateCcw, Square, X } from "lucide-react";
import { TOUR_CHECKLIST } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Step = (typeof TOUR_CHECKLIST)[number];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

function fmt(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Records an apartment tour in the browser with a room-by-room checklist.
 * Produces a File the uploader sends to the video provider untouched.
 */
export function TourRecorder({ steps = TOUR_CHECKLIST, onDone, onClose }: { steps?: readonly Step[]; onDone: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState(0);
  const [result, setResult] = useState<{ file: File; url: string } | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");

  // Camera preview.
  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      } catch {
        setError("Camera access was blocked. Allow the camera in your browser settings, or upload a video instead.");
      }
    }
    if (!result) start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing, result]);

  // Timer while recording.
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || "video/webm";
      const ext = type.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunksRef.current, { type });
      const file = new File([blob], `tour-${Date.now()}.${ext}`, { type });
      setResult({ file, url: URL.createObjectURL(blob) });
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    recorder.start(1000);
    recorderRef.current = recorder;
    setSeconds(0);
    setRecording(true);
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  function markCurrent() {
    const step = steps[current];
    if (!step) return;
    setDone((prev) => new Set(prev).add(step.key));
    setCurrent((i) => Math.min(steps.length - 1, i + 1));
  }

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="Record a video tour">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10" aria-label="Close">
          <X className="h-6 w-6" />
        </button>
        <span className={cn("rounded-full px-3 py-1 text-sm font-semibold", recording ? "bg-red-600" : "bg-white/10")}>
          {recording ? `● REC ${fmt(seconds)}` : result ? "Preview" : "Ready"}
        </span>
        {!result ? (
          <button type="button" onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10" aria-label="Switch camera">
            <RotateCcw className="h-5 w-5" />
          </button>
        ) : (
          <span className="w-10" />
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {result ? (
          <video src={result.url} controls playsInline className="h-full w-full object-contain" />
        ) : (
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        )}
        {error ? <p className="absolute inset-x-4 top-4 rounded-lg bg-red-600/90 px-3 py-2 text-sm">{error}</p> : null}

        {!result ? (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-4 pb-4 pt-10">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/70">Tour checklist</p>
            <ol className="flex flex-col gap-1">
              {steps.map((step, i) => {
                const checked = done.has(step.key);
                const active = i === current && !checked;
                return (
                  <li key={step.key} className={cn("flex items-center gap-2 text-sm", checked ? "text-white/50 line-through" : active ? "font-semibold" : "text-white/80")}>
                    {checked ? <Check className="h-4 w-4 text-brand-500" /> : <Circle className={cn("h-4 w-4", active ? "text-accent-500" : "text-white/40")} />}
                    <span>{step.label}</span>
                    {active ? <span className="text-xs font-normal text-white/60">· {step.hint}</span> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-center gap-4 px-4 py-4">
        {result ? (
          <>
            <Button variant="secondary" onClick={() => { setResult(null); setDone(new Set()); setCurrent(0); }}>
              Record again
            </Button>
            <Button onClick={() => onDone(result.file)}>Use this video</Button>
          </>
        ) : recording ? (
          <>
            <Button variant="secondary" onClick={markCurrent} disabled={current >= steps.length && done.size === steps.length}>
              <Check className="h-4 w-4" /> Next room
            </Button>
            <button type="button" onClick={stopRecording} className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-red-600" aria-label="Stop recording">
              <Square className="h-6 w-6 fill-white" />
            </button>
          </>
        ) : (
          <button type="button" onClick={startRecording} disabled={Boolean(error)} className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-red-600 disabled:opacity-40" aria-label="Start recording">
            <Circle className="h-6 w-6 fill-white" />
          </button>
        )}
      </div>
    </div>
  );
}
