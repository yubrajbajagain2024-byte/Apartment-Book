"use client";

import { useState } from "react";
import { Copy, Plus, X } from "lucide-react";
import {
  addHoursDays,
  defaultBusinessHours,
  HOURS_DAY_LABELS,
  HOURS_DAYS,
  HOURS_TIMEZONES,
  localTimeIn,
  MAX_HOURS_RANGES,
  MAX_SPECIAL_HOURS,
  minutesOfClock,
  type BusinessHours,
  type HoursDay,
  type HoursRange,
  type SpecialHours,
} from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { bizButton, bizField, Panel } from "./ui";

const ALL_DAY: HoursRange[] = [{ open: "00:00", close: "24:00" }];
const isAllDay = (ranges: HoursRange[]) => ranges.length === 1 && ranges[0].open === "00:00" && ranges[0].close === "24:00";

/** An on/off switch, as iOS draws one. */
function Switch({ checked, onChange, label, testId }: { checked: boolean; onChange: (on: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      data-testid={testId}
      className={cn(
        "relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-biz-accent",
        checked ? "bg-biz-success" : "bg-biz-surface-3 ring-1 ring-inset ring-biz-line",
      )}
    >
      <span className={cn("h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200", checked ? "translate-x-[20px]" : "translate-x-[2px]")} />
    </button>
  );
}

/** A time field; midnight at the end of the day ("24:00") reads as 00:00, which closes at midnight too. */
function TimeField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="time"
      step={300}
      required
      aria-label={label}
      value={value === "24:00" ? "00:00" : value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(bizField, "h-10 w-[7.75rem] px-3 tabular-nums")}
    />
  );
}

/** One day's ranges: opening and closing times, more than one for a break, or open around the clock. */
function Ranges({ ranges, onChange, name }: { ranges: HoursRange[]; onChange: (r: HoursRange[]) => void; name: string }) {
  if (isAllDay(ranges)) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[15px] font-medium text-biz-ink">Open 24 hours</span>
        <button type="button" onClick={() => onChange([{ open: "09:00", close: "17:00" }])} className="text-[13px] font-medium text-biz-accent-ink hover:underline">
          Set hours
        </button>
      </div>
    );
  }
  const set = (i: number, patch: Partial<HoursRange>) => onChange(ranges.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      {ranges.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <TimeField value={r.open} onChange={(v) => set(i, { open: v })} label={`${name}: opens`} />
          <span className="text-biz-ink-4">–</span>
          <TimeField value={r.close} onChange={(v) => set(i, { close: v })} label={`${name}: closes`} />
          {ranges.length > 1 ? (
            <button type="button" onClick={() => onChange(ranges.filter((_, j) => j !== i))} aria-label={`Remove these hours on ${name}`} className="flex h-8 w-8 items-center justify-center rounded-full text-biz-ink-4 hover:bg-biz-surface-3 hover:text-biz-ink-2">
              <X className="h-4 w-4" />
            </button>
          ) : null}
          {r.close !== "24:00" && minutesOfClock(r.close) <= minutesOfClock(r.open) && r.open !== r.close ? <span className="text-[12px] text-biz-ink-4">closes after midnight</span> : null}
        </div>
      ))}
      <div className="flex gap-4">
        {ranges.length < MAX_HOURS_RANGES ? (
          <button
            type="button"
            onClick={() => onChange([...ranges, { open: ranges[ranges.length - 1]?.close === "24:00" ? "18:00" : (ranges[ranges.length - 1]?.close ?? "09:00"), close: "21:00" }])}
            className="text-[13px] font-medium text-biz-accent-ink hover:underline"
          >
            Add hours
          </button>
        ) : null}
        <button type="button" onClick={() => onChange(ALL_DAY)} className="text-[13px] font-medium text-biz-accent-ink hover:underline">
          Open 24 hours
        </button>
      </div>
    </div>
  );
}

/**
 * The business's opening hours in its profile form: shown or not, its time zone, each weekday open (with its times) or
 * closed, and special hours for holidays and events, which replace a date's usual hours. The form sends them as JSON in
 * one hidden field (businessHoursSchema checks it, and so does the database); "null" takes them off the profile.
 */
export function HoursEditor({ initial, error }: { initial: BusinessHours | null; error?: string[] }) {
  const [enabled, setEnabled] = useState(initial !== null);
  const [hours, setHours] = useState<BusinessHours>(initial ?? defaultBusinessHours());
  const setDay = (day: HoursDay, ranges: HoursRange[]) => setHours((h) => ({ ...h, week: { ...h.week, [day]: ranges } }));
  const setSpecial = (i: number, patch: Partial<SpecialHours>) => setHours((h) => ({ ...h, special: h.special.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const addSpecial = () =>
    setHours((h) => {
      const today = localTimeIn(h.timezone, new Date())?.date ?? new Date().toISOString().slice(0, 10);
      // The first free day from today on, closed until the owner says otherwise.
      let date = today;
      while (h.special.some((s) => s.date === date)) date = addHoursDays(date, 1);
      return { ...h, special: [...h.special, { date, label: null, closed: true, hours: [] }] };
    });
  const dates = hours.special.map((s) => s.date);

  return (
    <Panel className="flex flex-col gap-5 p-6" data-testid="hours-editor">
      <input type="hidden" name="hours" value={enabled ? JSON.stringify(hours) : "null"} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-semibold text-biz-ink">Hours</h2>
          <p className="mt-0.5 text-[13px] text-biz-ink-3">Students see whether you&apos;re open right now, and your week, on your profile.</p>
        </div>
        <Switch checked={enabled} onChange={setEnabled} label="Show hours on your profile" testId="hours-enabled" />
      </div>
      {error?.[0] ? <p className="text-[13px] text-biz-danger">{error[0]}</p> : null}

      {enabled ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-biz-ink-2">Time zone</span>
              <select value={hours.timezone} onChange={(e) => setHours((h) => ({ ...h, timezone: e.target.value }))} className={cn(bizField, "h-10 w-56")} aria-label="Time zone">
                {HOURS_TIMEZONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setHours((h) => ({ ...h, week: { ...h.week, tue: h.week.mon, wed: h.week.mon, thu: h.week.mon, fri: h.week.mon } }))} className={bizButton({ variant: "ghost", size: "sm" })}>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy Monday to weekdays
            </button>
          </div>

          <ul className="divide-y divide-biz-line rounded-2xl ring-1 ring-biz-line" aria-label="Weekly hours">
            {HOURS_DAYS.map((day) => {
              const ranges = hours.week[day];
              const open = ranges.length > 0;
              return (
                <li key={day} className="grid grid-cols-[6.5rem_auto_1fr] items-start gap-x-4 px-4 py-3 sm:grid-cols-[8rem_auto_1fr]" data-testid={`hours-${day}`}>
                  <span className="pt-2 text-[15px] font-medium text-biz-ink">{HOURS_DAY_LABELS[day]}</span>
                  <span className="pt-[7px]">
                    <Switch checked={open} onChange={(on) => setDay(day, on ? [{ open: "09:00", close: "17:00" }] : [])} label={`Open on ${HOURS_DAY_LABELS[day]}`} />
                  </span>
                  {open ? <Ranges ranges={ranges} onChange={(r) => setDay(day, r)} name={HOURS_DAY_LABELS[day]} /> : <span className="pt-2 text-[15px] text-biz-ink-4">Closed</span>}
                </li>
              );
            })}
          </ul>

          <div className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold text-biz-ink">Holiday and special hours</h3>
                <p className="mt-0.5 text-[13px] text-biz-ink-3">A date&apos;s hours replace your usual ones, such as closed on Thanksgiving. Past dates drop off.</p>
              </div>
              {hours.special.length < MAX_SPECIAL_HOURS ? (
                <button type="button" onClick={addSpecial} className={bizButton({ variant: "secondary", size: "sm" })} data-testid="hours-add-special">
                  <Plus className="h-4 w-4" aria-hidden="true" /> Add a date
                </button>
              ) : null}
            </div>
            {hours.special.length ? (
              <ul className="flex flex-col gap-2">
                {hours.special.map((s, i) => (
                  <li key={i} className="flex flex-wrap items-start gap-3 rounded-2xl bg-biz-surface-2 p-3 ring-1 ring-biz-line" data-testid="hours-special">
                    <input
                      type="date"
                      required
                      value={s.date}
                      onChange={(e) => setSpecial(i, { date: e.target.value })}
                      aria-label="Date"
                      className={cn(bizField, "h-10 w-[10.5rem] px-3", dates.indexOf(s.date) !== i && "ring-2 ring-biz-danger")}
                    />
                    <input
                      value={s.label ?? ""}
                      onChange={(e) => setSpecial(i, { label: e.target.value || null })}
                      maxLength={40}
                      placeholder="Name, e.g. Thanksgiving"
                      aria-label="Name of the day"
                      className={cn(bizField, "h-10 min-w-0 flex-1 basis-40")}
                    />
                    <div className="flex h-10 items-center rounded-xl bg-biz-surface-3 p-1" role="group" aria-label="Open or closed">
                      {[true, false].map((closed) => (
                        <button
                          key={String(closed)}
                          type="button"
                          aria-pressed={s.closed === closed}
                          onClick={() => setSpecial(i, closed ? { closed: true, hours: [] } : { closed: false, hours: s.hours.length ? s.hours : [{ open: "10:00", close: "14:00" }] })}
                          className={cn("h-8 rounded-lg px-3 text-[13px] font-medium transition-colors", s.closed === closed ? "bg-biz-surface text-biz-ink shadow-sm" : "text-biz-ink-3 hover:text-biz-ink")}
                        >
                          {closed ? "Closed" : "Open"}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setHours((h) => ({ ...h, special: h.special.filter((_, j) => j !== i) }))}
                      aria-label={`Remove ${s.label ?? s.date}`}
                      className="ml-auto flex h-10 w-10 items-center justify-center rounded-full text-biz-ink-4 hover:bg-biz-surface-3 hover:text-biz-ink-2"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    {s.closed ? null : (
                      <div className="basis-full">
                        <Ranges ranges={s.hours} onChange={(r) => setSpecial(i, { hours: r })} name={s.label ?? s.date} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-[15px] text-biz-ink-3">Your profile shows no hours. Turn this on to set them.</p>
      )}
    </Panel>
  );
}
