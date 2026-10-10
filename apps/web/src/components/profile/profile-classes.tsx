"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Plus, X } from "lucide-react";
import { classCodeProblem, type ProfileClass } from "@apartment-book/shared";
import { addClassAction, removeClassAction } from "@/lib/actions/profile-page";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

export type ClassGroup = { term: string; current: boolean; classes: ProfileClass[] };

const CLASS_TITLE_MAX = 80;

/**
 * The Classes tab: classes grouped by semester, this one first. The owner adds them (code, optional name, semester)
 * and removes them here; the page re-renders with the list from the database after each change.
 */
export function ProfileClasses({ isOwner, groups, terms }: { isOwner: boolean; groups: ClassGroup[]; /** This semester first, then the next and the last one. */ terms: string[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [term, setTerm] = useState(terms[0] ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [, startRemoving] = useTransition();
  /** Classes removed here, hidden straight away rather than when the refreshed list arrives. */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const codeRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const visible = groups.map((g) => ({ ...g, classes: g.classes.filter((c) => !hidden.has(c.id)) })).filter((g) => g.classes.length > 0);
  const empty = visible.length === 0;

  function openForm() {
    setAdding(true);
    setFormError(null);
    // The input exists after this render.
    requestAnimationFrame(() => codeRef.current?.focus());
  }

  function closeForm() {
    setAdding(false);
    setFormError(null);
    setCode("");
    setTitle("");
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const problem = classCodeProblem(code);
    if (problem) {
      setFormError(problem);
      codeRef.current?.focus();
      return;
    }
    setFormError(null);
    startSaving(async () => {
      const result = await addClassAction({ term, code, title });
      if (result.error) {
        setFormError(result.error);
        return;
      }
      // Ready for the next one.
      setCode("");
      setTitle("");
      codeRef.current?.focus();
      router.refresh();
    });
  }

  function remove(item: ProfileClass) {
    setListError(null);
    setHidden((h) => new Set(h).add(item.id));
    // The button pressed is about to disappear: keep the focus in the tab.
    (addButtonRef.current ?? codeRef.current)?.focus();
    startRemoving(async () => {
      const result = await removeClassAction(item.id);
      if (result.error) {
        setHidden((h) => {
          const next = new Set(h);
          next.delete(item.id);
          return next;
        });
        setListError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4" data-testid="profile-classes">
      {isOwner ? (
        adding ? (
          <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl bg-gray-50 p-3.5 ring-1 ring-gray-100" aria-label="Add a class" data-testid="profile-class-form">
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-800">
                Class code
                <input
                  ref={codeRef}
                  name="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="CS 3358"
                  maxLength={20}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  aria-invalid={formError ? true : undefined}
                  className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm uppercase text-gray-900 placeholder:normal-case placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 aria-[invalid=true]:border-red-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-800">
                Class name (optional)
                <input
                  name="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Data Structures"
                  maxLength={CLASS_TITLE_MAX}
                  autoComplete="off"
                  className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </label>
            </div>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium text-gray-800">Semester</legend>
              <div className="flex flex-wrap gap-2">
                {terms.map((t, i) => (
                  <label
                    key={t}
                    className={cn(
                      "inline-flex h-8 cursor-pointer items-center rounded-full px-3 text-[13px] font-semibold ring-1 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500",
                      term === t ? "bg-gray-900 text-white ring-gray-900" : "bg-white text-gray-800 ring-gray-300 hover:bg-gray-100",
                    )}
                  >
                    <input type="radio" name="term" value={t} checked={term === t} onChange={() => setTerm(t)} className="sr-only" />
                    {t}
                    {i === 0 ? <span className={cn("ml-1 font-normal", term === t ? "text-white/80" : "text-gray-500")}>· This semester</span> : null}
                  </label>
                ))}
              </div>
            </fieldset>
            {formError ? (
              <p role="alert" className="text-sm text-red-600">
                {formError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeForm} className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-gray-700 hover:bg-gray-200">
                Done
              </button>
              <button type="submit" aria-disabled={saving || undefined} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 aria-disabled:opacity-60">
                {saving ? <Spinner className="h-4 w-4" /> : null}
                Add
              </button>
            </div>
          </form>
        ) : (
          <div className={cn("flex items-center gap-3", empty && "flex-col py-6 text-center")}>
            {empty ? (
              <>
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-700">
                  <GraduationCap className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Add your classes</p>
                  <p className="mt-0.5 text-sm text-gray-500">Show classmates which classes you are taking this semester.</p>
                </div>
              </>
            ) : null}
            <button
              ref={addButtonRef}
              type="button"
              onClick={openForm}
              className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg bg-gray-100 px-3.5 text-sm font-semibold text-gray-900 hover:bg-gray-200", !empty && "ml-auto")}
              data-testid="profile-add-class"
            >
              <Plus className="h-4 w-4" /> Add class
            </button>
          </div>
        )
      ) : null}

      {listError ? (
        <p role="alert" className="text-sm text-red-600">
          {listError}
        </p>
      ) : null}

      {empty ? (
        isOwner ? null : (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-700">
              <GraduationCap className="h-6 w-6" />
            </span>
            <p className="text-sm font-semibold text-gray-900">No classes listed</p>
          </div>
        )
      ) : (
        visible.map((group) => (
          <section key={group.term} aria-label={group.term} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-gray-900">
              {group.term}
              {group.current ? <span className="font-normal text-gray-500"> · This semester</span> : null}
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {group.classes.map((item) => (
                <li key={item.id} className="flex items-center gap-3 rounded-xl bg-gray-50 px-3 py-2.5 ring-1 ring-gray-100" data-testid="profile-class">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-gray-700 ring-1 ring-gray-200">
                    <GraduationCap className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-gray-900">{item.code}</span>
                    {item.title ? <span className="block truncate text-xs text-gray-500">{item.title}</span> : null}
                  </span>
                  {isOwner ? (
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      aria-label={`Remove ${item.code}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-900"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
