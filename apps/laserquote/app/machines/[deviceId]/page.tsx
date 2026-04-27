"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase/client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

const POLL_MS = 20000;
const FALSE_START_THRESHOLD_S = 5;
const REAL_RUN_MIN_S = 30;
const TIMELINE_START_HOUR = 6;
const TIMELINE_END_HOUR = 17;

type DeviceStatus = {
  site: string;
  stream: string;
  device_id: string;
  status: string;
  rssi: number | null;
  firmware: string | null;
  last_seen: string;
};

type StateEvent = {
  id: number;
  ts: string;
  device_id: string;
  field: string;
  from_value: string | null;
  to_value: string | null;
};

type ProgramRun = {
  id: number;
  ts: string;
  device_id: string;
  program: string | null;
  comment: string | null;
  part_name: string | null;
  ended_state: string | null;
  runtime_seconds: number | null;
  cutting_time_s_end: number | null;
  operation_time_s_end: number | null;
  part_count_end: number | null;
  material: string | null;
  sheet_thickness: string | null;
};

type QuoteMatch = {
  importId: string;
  quoteId: number;
  quoteNumber: number;
  totalValue: number | null;
  status: string;
};

// Only confirmed orders count toward turnover and surface in the runs table.
// Drafts/issued/revised/error are still in the quote phase; lost/cancelled
// are dead. Once a quote reaches "won" or beyond it represents real revenue.
const QUOTE_CONFIRMED_STATUSES = new Set([
  "won",
  "completed",
  "ready_for_collection",
  "delivered",
]);

function normaliseProgram(name: string | null | undefined): string | null {
  if (!name) return null;
  return name.trim().toUpperCase();
}

// Fetch quote matches for a list of program names (case-insensitive)
async function fetchQuoteMatches(programNames: string[]): Promise<Map<string, QuoteMatch>> {
  const result = new Map<string, QuoteMatch>();
  if (programNames.length === 0) return result;

  // Build an or() filter using ilike for case-insensitive match
  const orParts = programNames
    .filter((n) => n && n.trim() !== "")
    .map((n) => `program_name.ilike.${n.replace(/[(),]/g, "\\$&")}`);
  if (orParts.length === 0) return result;

  const { data } = await supabase
    .from("laser_program")
    .select(
      "program_name, import_id, import:laser_import!inner(quotes:laser_quote(id, quote_number, total_value, status, updated_at))"
    )
    .or(orParts.join(","));

  type Row = {
    program_name: string;
    import_id: string;
    import: { quotes: { id: number; quote_number: number; total_value: number | null; status: string; updated_at: string }[] } | null;
  };

  for (const row of (data as Row[] | null) ?? []) {
    const key = normaliseProgram(row.program_name);
    if (!key) continue;
    if (result.has(key)) continue;
    const quotes = (row.import?.quotes ?? []).filter((q) =>
      QUOTE_CONFIRMED_STATUSES.has(q.status)
    );
    if (quotes.length === 0) continue;
    quotes.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    const q = quotes[0];
    result.set(key, {
      importId: row.import_id,
      quoteId: q.id,
      quoteNumber: q.quote_number,
      totalValue: q.total_value,
      status: q.status,
    });
  }

  return result;
}

// Colours for the timeline. READY is intentionally omitted — it's the default
// state, so absence-of-colour communicates "running normally" and lets the
// problem states stand out.
const EXEC_COLOURS: Record<string, string> = {
  ACTIVE: "#16a34a",
  FEED_HOLD: "#f59e0b",
  STOPPED: "#dc2626",
  INTERRUPTED: "#dc2626",
};

const EXEC_BADGE: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  READY: "bg-blue-100 text-blue-800",
  FEED_HOLD: "bg-amber-100 text-amber-800",
  STOPPED: "bg-red-100 text-red-800",
  INTERRUPTED: "bg-red-100 text-red-800",
};

type DateRangeKey = "today" | "7d" | "month" | "custom";

// ── Time helpers (UTC ↔ Europe/London) ─────────────────────────────────────
function londonDateString(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const dd = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${dd}`;
}

function londonOffsetMin(probeUtc: Date): number {
  const offsetPart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "longOffset",
  })
    .formatToParts(probeUtc)
    .find((p) => p.type === "timeZoneName");
  const m = offsetPart?.value.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "+" ? 1 : -1) * (parseInt(m[2]) * 60 + parseInt(m[3])) : 0;
}

function londonDayRange(dateStr: string): { start: Date; end: Date } {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const offsetMin = londonOffsetMin(probe);
  const start = new Date(`${dateStr}T00:00:00Z`);
  start.setMinutes(start.getMinutes() - offsetMin);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function londonHourRange(
  dateStr: string,
  startHour: number,
  endHour: number
): { start: Date; end: Date } {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const offsetMin = londonOffsetMin(probe);
  const start = new Date(`${dateStr}T${String(startHour).padStart(2, "0")}:00:00Z`);
  start.setMinutes(start.getMinutes() - offsetMin);
  const end = new Date(`${dateStr}T${String(endHour).padStart(2, "0")}:00:00Z`);
  end.setMinutes(end.getMinutes() - offsetMin);
  return { start, end };
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeSeconds(d: Date): string {
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRuntime(secs: number | null): string {
  if (secs == null || secs < 0) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ageLabel(lastSeen: string | null, now: Date): string {
  if (!lastSeen) return "never";
  const diff = (now.getTime() - new Date(lastSeen).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

// Parse "P11820 11820 MATERIAL: FE37,3000,1500,20 QUANTITY : 1"
function parseProgramComment(comment: string | null): {
  width: number | null;
  length: number | null;
  thickness: number | null;
  grade: string | null;
  quantity: number | null;
} {
  if (!comment) return { width: null, length: null, thickness: null, grade: null, quantity: null };
  const m = comment.match(
    /MATERIAL:\s*([^,\s]+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*QUANTITY\s*:\s*(\d+)/i
  );
  if (!m) return { width: null, length: null, thickness: null, grade: null, quantity: null };
  return {
    grade: m[1],
    width: parseInt(m[2]),
    length: parseInt(m[3]),
    thickness: parseInt(m[4]),
    quantity: parseInt(m[5]),
  };
}

// "FE37-O2" → { grade: "FE37", gas: "O2" }
function splitMaterialGas(material: string | null): { grade: string | null; gas: string | null } {
  if (!material) return { grade: null, gas: null };
  const m = material.match(/^([^-]+)(?:-([A-Z0-9]+))?$/);
  if (!m) return { grade: material, gas: null };
  return { grade: m[1], gas: m[2] ?? null };
}

function GasBadge({ gas }: { gas: string | null }) {
  if (!gas) return null;
  const cls =
    gas === "O2"
      ? "bg-amber-100 text-amber-800"
      : gas === "N2"
        ? "bg-sky-100 text-sky-800"
        : "bg-gray-100 text-gray-700";
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>{gas}</span>;
}

export default function MachinePage() {
  const { deviceId: rawDeviceId } = useParams<{ deviceId: string }>();
  const deviceId = decodeURIComponent(rawDeviceId);

  const { user, loading: authLoading } = useAuth();
  const [now, setNow] = useState(new Date());

  // Live header state
  const [device, setDevice] = useState<DeviceStatus | null>(null);
  const [currentExec, setCurrentExec] = useState<string | null>(null);
  const [currentProgram, setCurrentProgram] = useState<string | null>(null);
  const [currentMode, setCurrentMode] = useState<string | null>(null);
  const [currentMaterial, setCurrentMaterial] = useState<string | null>(null);
  const [currentThickness, setCurrentThickness] = useState<string | null>(null);

  // Timeline
  const [timelineDate, setTimelineDate] = useState<string>(() => londonDateString());
  const [timelineEvents, setTimelineEvents] = useState<StateEvent[]>([]);
  const [timelinePriorState, setTimelinePriorState] = useState<string | null>(null);
  const [timelinePrograms, setTimelinePrograms] = useState<{ ts: Date; program: string | null }[]>([]);

  // Program runs
  const [rangeKey, setRangeKey] = useState<DateRangeKey>("today");
  const [customFrom, setCustomFrom] = useState<string>(() => londonDateString());
  const [customTo, setCustomTo] = useState<string>(() => londonDateString());
  const [hideFalseStarts, setHideFalseStarts] = useState(true);
  const [runs, setRuns] = useState<ProgramRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [sortKey, setSortKey] = useState<keyof ProgramRun | "parts_made" | "dims">("ts");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState("");

  // 30-day charts
  const [dailyHours, setDailyHours] = useState<{ day: string; hours: number }[]>([]);
  const [dailyTurnover, setDailyTurnover] = useState<{ day: string; value: number }[]>([]);

  // Quote lookup for currently displayed runs (program name → quote)
  const [quoteMatches, setQuoteMatches] = useState<Map<string, QuoteMatch>>(new Map());

  // Now ticker for "last seen" age
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Header live state
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      const [devRes, execRes, progRes, modeRes, lastRunRes] = await Promise.all([
        supabase
          .from("device_status")
          .select("*")
          .eq("device_id", deviceId)
          .order("last_seen", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("pss_laser_state_events")
          .select("to_value")
          .eq("device_id", deviceId)
          .eq("field", "execution")
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("pss_laser_state_events")
          .select("to_value")
          .eq("device_id", deviceId)
          .eq("field", "program")
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("pss_laser_state_events")
          .select("to_value")
          .eq("device_id", deviceId)
          .eq("field", "NCmode")
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("pss_laser_program_runs")
          .select("material, sheet_thickness")
          .eq("device_id", deviceId)
          .not("material", "is", null)
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (cancelled) return;
      setDevice((devRes.data as DeviceStatus | null) ?? null);
      setCurrentExec((execRes.data as { to_value: string | null } | null)?.to_value ?? null);
      setCurrentProgram((progRes.data as { to_value: string | null } | null)?.to_value ?? null);
      setCurrentMode((modeRes.data as { to_value: string | null } | null)?.to_value ?? null);
      const lr = (lastRunRes.data as { material: string | null; sheet_thickness: string | null } | null) ?? null;
      setCurrentMaterial(lr?.material ?? null);
      setCurrentThickness(lr?.sheet_thickness ?? null);
    };

    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user, deviceId]);

  // Timeline data
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      const { start, end } = londonDayRange(timelineDate);

      const [eventsRes, priorRes, progsRes] = await Promise.all([
        supabase
          .from("pss_laser_state_events")
          .select("*")
          .eq("device_id", deviceId)
          .eq("field", "execution")
          .gte("ts", start.toISOString())
          .lt("ts", end.toISOString())
          .order("ts", { ascending: true }),
        supabase
          .from("pss_laser_state_events")
          .select("to_value")
          .eq("device_id", deviceId)
          .eq("field", "execution")
          .lt("ts", start.toISOString())
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("pss_laser_state_events")
          .select("ts, to_value")
          .eq("device_id", deviceId)
          .eq("field", "program")
          .lte("ts", end.toISOString())
          .order("ts", { ascending: true }),
      ]);

      if (cancelled) return;
      setTimelineEvents((eventsRes.data as StateEvent[] | null) ?? []);
      setTimelinePriorState((priorRes.data as { to_value: string | null } | null)?.to_value ?? null);
      setTimelinePrograms(
        ((progsRes.data as { ts: string; to_value: string | null }[] | null) ?? []).map((p) => ({
          ts: new Date(p.ts),
          program: p.to_value,
        }))
      );
    };

    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user, deviceId, timelineDate]);

  // Program runs for selected range
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      setRunsLoading(true);
      const today = londonDateString();
      let fromDate = today;
      let toDate = today;
      if (rangeKey === "7d") {
        const d = new Date();
        d.setDate(d.getDate() - 6);
        fromDate = londonDateString(d);
      } else if (rangeKey === "month") {
        const d = new Date();
        d.setDate(1);
        fromDate = londonDateString(d);
      } else if (rangeKey === "custom") {
        fromDate = customFrom;
        toDate = customTo;
      }
      const { start } = londonDayRange(fromDate);
      const { end } = londonDayRange(toDate);

      const { data } = await supabase
        .from("pss_laser_program_runs")
        .select("*")
        .eq("device_id", deviceId)
        .gte("ts", start.toISOString())
        .lt("ts", end.toISOString())
        .order("ts", { ascending: false });

      if (cancelled) return;
      const rows = (data as ProgramRun[] | null) ?? [];
      setRuns(rows);
      setRunsLoading(false);

      // Look up quotes for the distinct program names in this set
      const names = [...new Set(rows.map((r) => normaliseProgram(r.program)).filter(Boolean) as string[])];
      const matches = await fetchQuoteMatches(names);
      if (cancelled) return;
      setQuoteMatches(matches);
    };

    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user, deviceId, rangeKey, customFrom, customTo]);

  // 30-day cutting hours + daily turnover
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 29);
      const { data } = await supabase
        .from("pss_laser_program_runs")
        .select("ts, program, runtime_seconds, ended_state")
        .eq("device_id", deviceId)
        .in("ended_state", ["READY", "FEED_HOLD"])
        .gte("ts", start.toISOString())
        .lt("ts", end.toISOString())
        .order("ts", { ascending: true });
      if (cancelled) return;

      const rows = (data as ProgramRun[] | null) ?? [];

      // Cutting hours per day
      const hoursBuckets = new Map<string, number>();
      for (let i = 0; i < 30; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        hoursBuckets.set(londonDateString(d), 0);
      }
      for (const r of rows) {
        if (!r.ts || !r.runtime_seconds) continue;
        const day = londonDateString(new Date(r.ts));
        if (hoursBuckets.has(day)) {
          hoursBuckets.set(day, hoursBuckets.get(day)! + r.runtime_seconds);
        }
      }
      setDailyHours(
        Array.from(hoursBuckets.entries()).map(([day, secs]) => ({
          day: day.slice(5),
          hours: Math.round((secs / 3600) * 10) / 10,
        }))
      );

      // Turnover per day: each quote attributed once on its first run day in window
      const programNames = [...new Set(
        rows
          .filter((r) => (r.runtime_seconds ?? 0) >= REAL_RUN_MIN_S)
          .map((r) => normaliseProgram(r.program))
          .filter(Boolean) as string[]
      )];
      const matches = await fetchQuoteMatches(programNames);
      if (cancelled) return;

      const turnoverBuckets = new Map<string, number>();
      for (const day of hoursBuckets.keys()) turnoverBuckets.set(day, 0);

      // Walk runs in ascending order; first time we see a quote, attribute its full value
      const seenQuotes = new Set<number>();
      for (const r of rows) {
        if ((r.runtime_seconds ?? 0) < REAL_RUN_MIN_S) continue;
        const key = normaliseProgram(r.program);
        if (!key) continue;
        const match = matches.get(key);
        if (!match || match.totalValue == null) continue;
        if (seenQuotes.has(match.quoteId)) continue;
        seenQuotes.add(match.quoteId);
        const day = londonDateString(new Date(r.ts));
        if (turnoverBuckets.has(day)) {
          turnoverBuckets.set(day, turnoverBuckets.get(day)! + match.totalValue);
        }
      }
      setDailyTurnover(
        Array.from(turnoverBuckets.entries()).map(([day, value]) => ({
          day: day.slice(5),
          value: Math.round(value * 100) / 100,
        }))
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [user, deviceId]);

  // Timeline segments (00:00 → 24:00 of selected day)
  const timelineSegments = useMemo(() => {
    const { start, end } = londonDayRange(timelineDate);
    const segments: { from: Date; to: Date; state: string; program: string | null }[] = [];
    let cursor = start;
    let state = timelinePriorState ?? "READY";

    const programAt = (when: Date): string | null => {
      let prog: string | null = null;
      for (const p of timelinePrograms) {
        if (p.ts <= when) prog = p.program;
        else break;
      }
      return prog;
    };

    for (const ev of timelineEvents) {
      const ts = new Date(ev.ts);
      if (ts > cursor) {
        segments.push({ from: cursor, to: ts, state, program: programAt(cursor) });
      }
      state = ev.to_value ?? state;
      cursor = ts;
    }
    if (cursor < end) {
      const cap = now < end ? now : end;
      if (cap > cursor) {
        segments.push({ from: cursor, to: cap, state, program: programAt(cursor) });
      }
    }
    return segments;
  }, [timelineDate, timelineEvents, timelinePriorState, timelinePrograms, now]);

  // Display rows (filter false starts, parts-made delta, sort)
  const displayRuns = useMemo(() => {
    // parts_made delta computed against previous-by-time row
    const byTsAsc = [...runs].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    const prevCount = new Map<number, number | null>();
    let last: number | null = null;
    for (const r of byTsAsc) {
      prevCount.set(r.id, last);
      if (r.part_count_end != null) last = r.part_count_end;
    }

    const enriched = runs.map((r) => {
      const prev = prevCount.get(r.id);
      const partsMade =
        r.part_count_end != null && prev != null
          ? Math.max(0, r.part_count_end - prev)
          : null;
      const dimensions = parseProgramComment(r.comment);
      return { ...r, parts_made: partsMade, dimensions };
    });

    let filtered = enriched;
    if (hideFalseStarts) {
      filtered = filtered.filter((r) => (r.runtime_seconds ?? 0) >= FALSE_START_THRESHOLD_S);
    }
    const f = filter.trim().toLowerCase();
    if (f) {
      filtered = filtered.filter((r) =>
        [r.program, r.comment, r.material, r.sheet_thickness, r.ended_state, r.dimensions.grade]
          .some((v) => (v ?? "").toString().toLowerCase().includes(f))
      );
    }

    // Sort
    filtered.sort((a, b) => {
      let av: unknown;
      let bv: unknown;
      if (sortKey === "parts_made") {
        av = a.parts_made;
        bv = b.parts_made;
      } else if (sortKey === "dims") {
        av = a.dimensions.thickness;
        bv = b.dimensions.thickness;
      } else {
        av = a[sortKey as keyof ProgramRun];
        bv = b[sortKey as keyof ProgramRun];
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });

    return filtered;
  }, [runs, hideFalseStarts, filter, sortKey, sortDir]);

  // Utilisation tiles for selected range
  const utilisation = useMemo(() => {
    const cuttingSecs = runs
      .filter((r) => r.ended_state === "READY" || r.ended_state === "FEED_HOLD")
      .reduce((s, r) => s + (r.runtime_seconds ?? 0), 0);

    const programsCompleted = new Set<string>();
    for (const r of runs) {
      if ((r.runtime_seconds ?? 0) >= REAL_RUN_MIN_S && r.program) {
        programsCompleted.add(r.program);
      }
    }

    let minPart: number | null = null;
    let maxPart: number | null = null;
    for (const r of runs) {
      if (r.part_count_end == null) continue;
      if (minPart == null || r.part_count_end < minPart) minPart = r.part_count_end;
      if (maxPart == null || r.part_count_end > maxPart) maxPart = r.part_count_end;
    }
    const partsProduced = minPart != null && maxPart != null ? maxPart - minPart : 0;

    return {
      cuttingSecs,
      programsCompleted: programsCompleted.size,
      partsProduced,
    };
  }, [runs]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--pss-navy)" }}>Laser</h1>
        <AuthButton redirectTo={`/laserquote/machines/${deviceId}`} />
      </div>
    );
  }

  const toggleSort = (key: keyof ProgramRun | "parts_made" | "dims") => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const headerMaterial = splitMaterialGas(currentMaterial);
  const isOnline = device?.status === "online";

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader title="Laser" />

      {/* Header / current state */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="text-xs text-gray-500">Device</p>
            <p className="font-mono text-sm font-bold">{deviceId}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              <span className={isOnline ? "text-green-600" : "text-red-600"}>
                {isOnline ? "Online" : "Offline"}
              </span>
              {" · seen "}
              {ageLabel(device?.last_seen ?? null, now)}
            </p>
          </div>
          <div className={isOnline ? "" : "opacity-40"} title={isOnline ? undefined : "Last known — device offline"}>
            <p className="text-xs text-gray-500">
              {isOnline ? "Execution" : "Execution (last known)"}
            </p>
            <span
              className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${EXEC_BADGE[currentExec ?? ""] ?? "bg-gray-100 text-gray-700"}`}
            >
              {currentExec ?? "—"}
            </span>
          </div>
          <div className={isOnline ? "" : "opacity-40"} title={isOnline ? undefined : "Last known — device offline"}>
            <p className="text-xs text-gray-500">Program</p>
            <p className="font-mono text-sm font-medium">{currentProgram ?? "—"}</p>
          </div>
          <div className={isOnline ? "" : "opacity-40"} title={isOnline ? undefined : "Last known — device offline"}>
            <p className="text-xs text-gray-500">Mode</p>
            <p className="text-sm font-medium">{currentMode ?? "—"}</p>
          </div>
          <div className={isOnline ? "" : "opacity-40"} title={isOnline ? undefined : "Last known — device offline"}>
            <p className="text-xs text-gray-500">Material</p>
            <div className="text-sm font-medium flex items-center gap-1.5">
              <span>{headerMaterial.grade ?? "—"}</span>
              <GasBadge gas={headerMaterial.gas} />
              {currentThickness && <span className="text-gray-500">· {currentThickness}mm</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--pss-navy)" }}>
            Execution Timeline
          </h2>
          <input
            type="date"
            value={timelineDate}
            onChange={(e) => setTimelineDate(e.target.value)}
            max={londonDateString()}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <Timeline dateStr={timelineDate} segments={timelineSegments} />
        <div className="flex flex-wrap gap-4 mt-2 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded bg-gray-50 border border-gray-300" />
            <span className="text-gray-600">READY (idle)</span>
          </div>
          {Object.entries(EXEC_COLOURS).map(([state, colour]) => (
            <div key={state} className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: colour }} />
              <span className="text-gray-600">{state}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Utilisation */}
      <div>
        <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--pss-navy)" }}>
          Utilisation
        </h2>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <Tile label="Cutting Time" value={formatRuntime(utilisation.cuttingSecs)} />
          <Tile label="Programs Completed" value={String(utilisation.programsCompleted)} />
          <Tile label="Parts Produced" value={String(utilisation.partsProduced)} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-2">Cutting hours · last 30 days</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyHours} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={4} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(v) => [`${Number(v)} hrs`, "Cutting"]}
                    labelStyle={{ fontSize: 12 }}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="hours" fill="#16a34a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-2">Daily turnover · last 30 days</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyTurnover} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={4} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(v) => [`£${Number(v).toFixed(2)}`, "Turnover"]}
                    labelStyle={{ fontSize: 12 }}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="value" fill="#0d9488" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Program runs */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--pss-navy)" }}>
            Program Runs
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={rangeKey}
              onChange={(e) => setRangeKey(e.target.value as DateRangeKey)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="month">This month</option>
              <option value="custom">Custom</option>
            </select>
            {rangeKey === "custom" && (
              <>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  max={customTo}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <span className="text-xs text-gray-400">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  min={customFrom}
                  max={londonDateString()}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </>
            )}
            <label className="flex items-center gap-1.5 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={hideFalseStarts}
                onChange={(e) => setHideFalseStarts(e.target.checked)}
                className="rounded"
              />
              Hide false starts
            </label>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter..."
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 w-44"
            />
          </div>
        </div>

        {runsLoading ? (
          <p className="text-gray-400 text-sm">Loading runs...</p>
        ) : displayRuns.length === 0 ? (
          <p className="text-gray-500 text-sm">No program runs in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <SortTh label="End" keyName="ts" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortTh label="Program" keyName="program" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortTh label="Dims (W×L×T)" keyName="dims" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortTh label="Material" keyName="material" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortTh label="Runtime" keyName="runtime_seconds" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <SortTh label="Parts" keyName="parts_made" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <SortTh label="Ended" keyName="ended_state" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <th className="py-2 pr-3 font-medium">Quote</th>
                  <th className="py-2 pr-3 font-medium text-right">Value</th>
                  <th className="py-2 pr-3 font-medium">Comment</th>
                </tr>
              </thead>
              <tbody>
                {displayRuns.map((r) => {
                  const isFeedHold = r.ended_state === "FEED_HOLD";
                  const isVeryShort = (r.runtime_seconds ?? 0) < FALSE_START_THRESHOLD_S;
                  const muted = isFeedHold || isVeryShort;
                  const mat = splitMaterialGas(r.material);
                  const dims = r.dimensions;
                  const quote = quoteMatches.get(normaliseProgram(r.program) ?? "");
                  return (
                    <tr
                      key={r.id}
                      className={`border-b last:border-0 hover:bg-gray-50 ${isVeryShort ? "opacity-50" : muted ? "opacity-70" : ""}`}
                    >
                      <td className="py-2 pr-3 text-xs whitespace-nowrap">{formatTimeSeconds(new Date(r.ts))}</td>
                      <td className="py-2 pr-3 font-mono text-xs font-bold">{r.program ?? "—"}</td>
                      <td className="py-2 pr-3 text-xs">
                        {dims.width && dims.length && dims.thickness
                          ? `${dims.width} × ${dims.length} × ${dims.thickness}mm`
                          : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {mat.grade ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span>{mat.grade}</span>
                            <GasBadge gas={mat.gas} />
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-xs">{formatRuntime(r.runtime_seconds)}</td>
                      <td className="py-2 pr-3 text-right text-xs">{r.parts_made ?? "—"}</td>
                      <td className="py-2 pr-3 text-xs">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs ${EXEC_BADGE[r.ended_state ?? ""] ?? "bg-gray-100 text-gray-600"}`}
                        >
                          {r.ended_state ?? "—"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {quote ? (
                          <a
                            href={`/laserquote/imports/${quote.importId}`}
                            className="text-blue-600 hover:underline"
                          >
                            {quote.quoteNumber}
                          </a>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-xs">
                        {quote?.totalValue != null ? `£${quote.totalValue.toFixed(2)}` : <span className="text-gray-300">—</span>}
                      </td>
                      <td
                        className="py-2 pr-3 text-xs text-gray-500 truncate max-w-xs"
                        title={r.comment ?? undefined}
                      >
                        {r.comment ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: "var(--pss-navy)" }}>
        {value}
      </p>
    </div>
  );
}

function SortTh<K extends string>({
  label,
  keyName,
  sortKey,
  sortDir,
  onClick,
  align = "left",
}: {
  label: string;
  keyName: K;
  sortKey: K;
  sortDir: "asc" | "desc";
  onClick: (k: K) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === keyName;
  return (
    <th
      className={`py-2 pr-3 font-medium cursor-pointer select-none ${align === "right" ? "text-right" : "text-left"}`}
      onClick={() => onClick(keyName)}
    >
      {label}
      {active && <span className="ml-1 text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

function Timeline({
  dateStr,
  segments,
}: {
  dateStr: string;
  segments: { from: Date; to: Date; state: string; program: string | null }[];
}) {
  const { start, end } = londonHourRange(dateStr, TIMELINE_START_HOUR, TIMELINE_END_HOUR);
  const total = end.getTime() - start.getTime();

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="relative h-10 bg-gray-50 rounded overflow-hidden">
        {segments.map((seg, i) => {
          // Clip segment to visible window
          const fromMs = Math.max(seg.from.getTime(), start.getTime());
          const toMs = Math.min(seg.to.getTime(), end.getTime());
          if (toMs <= fromMs) return null;
          // READY = default state, render as empty so problem states stand out
          if (seg.state === "READY") return null;
          const fill = EXEC_COLOURS[seg.state];
          if (!fill) return null;
          const left = ((fromMs - start.getTime()) / total) * 100;
          const width = ((toMs - fromMs) / total) * 100;
          const durMin = Math.round((toMs - fromMs) / 60000);
          return (
            <div
              key={i}
              className="absolute top-0 h-full hover:opacity-80 transition-opacity"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: fill,
              }}
              title={`${seg.state} · ${formatTime(new Date(fromMs))}–${formatTime(new Date(toMs))} (${durMin} min)${seg.program ? `\n${seg.program}` : ""}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-xs text-gray-400">
        {Array.from({ length: TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1 }).map((_, i) => {
          const h = TIMELINE_START_HOUR + i;
          return <span key={h}>{String(h).padStart(2, "0")}:00</span>;
        })}
      </div>
    </div>
  );
}
