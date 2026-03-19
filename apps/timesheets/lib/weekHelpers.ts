/** Return the Monday of the week containing the given date */
export function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  // Sunday = 0, shift to previous Monday
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Return an array of 7 dates (Mon–Sun) for the week starting at monday */
export function getWeekDates(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

/** Format a Date as YYYY-MM-DD */
export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Short day labels */
export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Format a date range for display, e.g. "10 Mar – 16 Mar 2026" */
export function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const start = monday.toLocaleDateString("en-GB", opts);
  const end = sunday.toLocaleDateString("en-GB", {
    ...opts,
    year: "numeric",
  });
  return `${start} – ${end}`;
}
