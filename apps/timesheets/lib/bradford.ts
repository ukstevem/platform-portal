/**
 * Bradford Factor: B = S² × D
 * S = number of separate sickness spells
 * D = total sick days (Mon–Thu only)
 *
 * Consecutive sick days (Mon–Thu) count as one spell.
 * Fri/Sat/Sun are excluded as they are elective overtime days.
 */

export type BradfordResult = {
  score: number;
  spells: number;
  days: number;
  level: "green" | "amber" | "red";
};

/** Mon=1, Tue=2, Wed=3, Thu=4 in JS Date.getDay() */
function isCountableDay(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 4=Thu
  return day >= 1 && day <= 4;
}

/**
 * Calculate Bradford Factor from a list of sick-day dates.
 * Dates should be ISO strings (YYYY-MM-DD) where SICK-01 hours > 0.
 */
export function calculateBradford(sickDates: string[]): BradfordResult {
  // Filter to Mon–Thu only and sort
  const countable = sickDates
    .filter(isCountableDay)
    .sort();

  const days = countable.length;

  if (days === 0) {
    return { score: 0, spells: 0, days: 0, level: "green" };
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

  return { score, spells, days, level };
}

export const BRADFORD_THRESHOLDS = {
  green: { max: 49, label: "Low", color: "text-green-600", bg: "bg-green-100" },
  amber: { max: 199, label: "Caution", color: "text-amber-600", bg: "bg-amber-100" },
  red: { max: Infinity, label: "High", color: "text-red-600", bg: "bg-red-100" },
} as const;
