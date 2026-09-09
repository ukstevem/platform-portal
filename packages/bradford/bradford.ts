/**
 * Bradford Factor: B = S² × D
 * S = number of separate sickness spells
 * D = total sick days (Mon–Thu only)
 *
 * Consecutive sick days (Mon–Thu) count as one spell. Fri/Sat/Sun are
 * excluded as they are elective overtime days, so a Thursday absence
 * followed by a Monday absence is one continuous spell, not two.
 *
 * Scored over a rolling window (default 52 weeks) so absences age out —
 * without one the score only ever climbs and can never be recovered from.
 */

/** Rolling window, in weeks. Backstop value — review with the absence policy. */
export const BRADFORD_WINDOW_WEEKS = 52;

export type BradfordResult = {
  score: number;
  spells: number;
  days: number;
  level: "green" | "amber" | "red";
  /** Inclusive start of the rolling window the score covers (YYYY-MM-DD) */
  windowStart: string;
  /** Inclusive end of the rolling window the score covers (YYYY-MM-DD) */
  windowEnd: string;
};

/** Mon=1, Tue=2, Wed=3, Thu=4 in JS Date.getDay() */
function isCountableDay(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 4=Thu
  return day >= 1 && day <= 4;
}

/** Format a Date as YYYY-MM-DD in local time */
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Calculate Bradford Factor from a list of sick-day dates.
 * Dates should be ISO strings (YYYY-MM-DD) where SICK-01 hours > 0.
 *
 * Only dates inside the rolling window ending at `asOf` are scored; anything
 * older ages out. `asOf` is injectable so the result is deterministic in
 * tests — callers in the app can omit it.
 */
export function calculateBradford(
  sickDates: string[],
  asOf: Date = new Date()
): BradfordResult {
  const windowEndDate = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const windowStartDate = new Date(windowEndDate);
  windowStartDate.setDate(windowStartDate.getDate() - BRADFORD_WINDOW_WEEKS * 7 + 1);

  const windowStart = toISO(windowStartDate);
  const windowEnd = toISO(windowEndDate);

  // Filter to Mon–Thu inside the rolling window, then sort
  const countable = sickDates
    .filter((d) => d >= windowStart && d <= windowEnd)
    .filter(isCountableDay)
    .sort();

  const days = countable.length;

  if (days === 0) {
    return { score: 0, spells: 0, days: 0, level: "green", windowStart, windowEnd };
  }

  // Count spells: consecutive Mon–Thu sick days = 1 spell
  // A gap of any non-countable day (Fri/Sat/Sun) between Thu and Mon
  // still breaks the spell unless Thu and the following Mon are both sick.
  let spells = 1;
  for (let i = 1; i < countable.length; i++) {
    const prev = new Date(countable[i - 1] + "T00:00:00");
    const curr = new Date(countable[i] + "T00:00:00");

    // Check if current day is the next working day after prev
    const expected = new Date(prev);
    if (prev.getDay() === 4) {
      // Thursday → next countable is Monday (+4 days)
      expected.setDate(expected.getDate() + 4);
    } else {
      // Mon/Tue/Wed → next countable is +1 day
      expected.setDate(expected.getDate() + 1);
    }

    if (curr.getTime() !== expected.getTime()) {
      spells++;
    }
  }

  const score = spells * spells * days;
  const level = score >= 200 ? "red" : score >= 50 ? "amber" : "green";

  return { score, spells, days, level, windowStart, windowEnd };
}

export const BRADFORD_THRESHOLDS = {
  green: { max: 49, label: "Low", color: "text-green-600", bg: "bg-green-100" },
  amber: { max: 199, label: "Caution", color: "text-amber-600", bg: "bg-amber-100" },
  red: { max: Infinity, label: "High", color: "text-red-600", bg: "bg-red-100" },
} as const;
