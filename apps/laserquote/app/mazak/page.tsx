"use client";

import { useEffect, useMemo, useState } from "react";
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

const DEVICE_ID = "MAZAK-SN328525";
const SITE = "foxwood";
const STREAM = "mazak";
const POLL_MS = 20000;

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
  auto_cutting_time_s_end: number | null;
  auto_operation_time_s_end: number | null;
  part_count_end: number | null;
  material: string | null;
  sheet_thickness: string | null;
};

const EXECUTION_COLORS: Record<string, string> = {
  ACTIVE: "#16a34a",
  READY: "#3b82f6",
  STOPPED: "#dc2626",
  FEED_HOLD: "#f59e0b",
  INTERRUPTED: "#dc2626",
};

const EXECUTION_BADGE: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  READY: "bg-blue-100 text-blue-800",
  STOPPED: "bg-red-100 text-red-800",
  FEED_HOLD: "bg-amber-100 text-amber-800",
  INTERRUPTED: "bg-red-100 text-red-800",
};

type DateRangeKey = "today" | "7d" | "month" | "custom";

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

function londonDayRange(dateStr: string): { start: Date; end: Date } {
  // Compute London offset for that date at noon
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const offsetPart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "longOffset",
  })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName");
  const m = offsetPart?.value.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetMin = m ? (m[1] === "+" ? 1 : -1) * (parseInt(m[2]) * 60 + parseInt(m[3])) : 0;
  const start = new Date(`${dateStr}T00:00:00Z`);
  start.setMinutes(start.getMinutes() - offsetMin);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(d: Date): string {
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRuntime(secs: number | null): string {
  if (!secs || secs < 0) return "—";
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
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export default function MazakPage() {
  const { user, loading: authLoading } = useAuth();
  const [now, setNow] = useState(new Date());
  const [device, setDevice] = useState<DeviceStatus | null>(null);
  const [currentExecution, setCurrentExecution] = useState<string | null>(null);
  const [currentProgram, setCurrentProgram] = useState<string | null>(null);
  const [currentMaterial, setCurrentMaterial] = useState<string | null>(null);
  const [currentThickness, setCurrentThickness] = useState<string | null>(null);

  const [timelineDate, setTimelineDate] = useState<string>(() => londonDateString());
  const [timelineEvents, setTimelineEvents] = useState<StateEvent[]>([]);
  const [timelinePriorState, setTimelinePriorState] = useState<string | null>(null);
  const [timelinePrograms, setTimelinePrograms] = useState<{ ts: Date; program: string | null }[]>([]);

  const [rangeKey, setRangeKey] = useState<DateRangeKey>("today");
  const [customFrom, setCustomFrom] = useState<string>(() => londonDateString());
  const [customTo, setCustomTo] = useState<string>(() => londonDateString());
  const [runs, setRuns] = useState<ProgramRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [sortKey, setSortKey] = useState<keyof ProgramRun>("ts");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState("");

  const [dailyHours, setDailyHours] = useState<{ day: string; hours: number }[]>([]);

  // Ticker for "last seen" age
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Live device status + most-recent execution + program/material/thickness
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      const [devRes, execRes, progRes, matRes, thickRes] = await Promise.all([
        supabase
          .from("device_status")
          .select("*")
          .eq("site", SITE)
          .eq("stream", STREAM)
          .eq("device_id", DEVICE_ID)
          .maybeSingle(),
        supabase
          .from("mazak_state_events")
          .select("*")
          .eq("device_id", DEVICE_ID)
          .eq("field", "execution")
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("mazak_state_events")
          .select("*")
          .eq("device_id", DEVICE_ID)
          .eq("field", "program")
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("mazak_telemetry")
          .select("material, sheet_thickness, ts")
          .eq("device_id", DEVICE_ID)
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle(),
        Promise.resolve({ data: null }),
      ]);

      if (cancelled) return;
      setDevice((devRes.data as DeviceStatus) ?? null);
      setCurrentExecution((execRes.data as StateEvent | null)?.to_value ?? null);
      setCurrentProgram((progRes.data as StateEvent | null)?.to_value ?? null);
      const mat = (matRes.data as { material: string | null; sheet_thickness: string | null }) ?? null;
      setCurrentMaterial(mat?.material ?? null);
      setCurrentThickness(mat?.sheet_thickness ?? null);
    };

    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user]);

  // Timeline for selected day
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      const { start, end } = londonDayRange(timelineDate);

      const [eventsRes, priorRes, progsRes] = await Promise.all([
        supabase
          .from("mazak_state_events")
          .select("*")
          .eq("device_id", DEVICE_ID)
          .eq("field", "execution")
          .gte("ts", start.toISOString())
          .lt("ts", end.toISOString())
          .order("ts", { ascending: true }),
        supabase
          .from("mazak_state_events")
          .select("to_value")
          .eq("device_id", DEVICE_ID)
          .eq("field", "execution")
          .lt("ts", start.toISOString())
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("mazak_state_events")
          .select("ts, to_value")
          .eq("device_id", DEVICE_ID)
          .eq("field", "program")
          .gte("ts", start.toISOString())
          .lt("ts", end.toISOString())
          .order("ts", { ascending: true }),
      ]);

      if (cancelled) return;
      setTimelineEvents(((eventsRes.data as StateEvent[] | null) ?? []));
      setTimelinePriorState((priorRes.data as { to_value: string } | null)?.to_value ?? null);
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
  }, [user, timelineDate]);

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
        .from("mazak_program_runs")
        .select("*")
        .eq("device_id", DEVICE_ID)
        .gte("ts", start.toISOString())
        .lt("ts", end.toISOString())
        .order("ts", { ascending: false });

      if (cancelled) return;
      setRuns(((data as ProgramRun[] | null) ?? []));
      setRunsLoading(false);
    };

    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user, rangeKey, customFrom, customTo]);

  // Daily cutting hours for last 30 days
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 29);
      const { data } = await supabase
        .from("mazak_program_runs")
        .select("ts, runtime_seconds, ended_state")
        .eq("device_id", DEVICE_ID)
        .eq("ended_state", "READY")
        .gte("ts", start.toISOString())
        .lt("ts", end.toISOString())
        .order("ts", { ascending: true });
      if (cancelled) return;

      const buckets = new Map<string, number>();
      for (let i = 0; i < 30; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        buckets.set(londonDateString(d), 0);
      }
      for (const r of (data as ProgramRun[] | null) ?? []) {
        if (!r.ts || !r.runtime_seconds) continue;
        const day = londonDateString(new Date(r.ts));
        if (buckets.has(day)) {
          buckets.set(day, buckets.get(day)! + r.runtime_seconds);
        }
      }
      setDailyHours(
        Array.from(buckets.entries()).map(([day, secs]) => ({
          day: day.slice(5),
          hours: Math.round((secs / 3600) * 10) / 10,
        }))
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Timeline segments
  const timelineSegments = useMemo(() => {
    const { start, end } = londonDayRange(timelineDate);
    const segments: { from: Date; to: Date; state: string; program: string | null }[] = [];
    let cursor = start;
    let state = timelinePriorState ?? "READY";

    const events = timelineEvents;
    for (const ev of events) {
      const ts = new Date(ev.ts);
      if (ts > cursor) {
        segments.push({ from: cursor, to: ts, state, program: programAt(cursor) });
      }
      state = ev.to_value ?? state;
      cursor = ts;
    }
    if (cursor < end) {
      segments.push({ from: cursor, to: end, state, program: programAt(cursor) });
    }
    return segments;

    function programAt(when: Date): string | null {
      let prog: string | null = null;
      for (const p of timelinePrograms) {
        if (p.ts <= when) prog = p.program;
        else break;
      }
      return prog;
    }
  }, [timelineDate, timelineEvents, timelinePriorState, timelinePrograms]);

  // Program runs display (filter + sort + parts-made delta)
  const displayRuns = useMemo(() => {
    const sorted = [...runs].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });

    // Parts made delta: compute against next run (by ts ascending per device)
    const byTsAsc = [...runs].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    const prevCount = new Map<number, number | null>();
    let last: number | null = null;
    for (const r of byTsAsc) {
      prevCount.set(r.id, last);
      last = r.part_count_end;
    }

    const f = filter.trim().toLowerCase();
    const filtered = f
      ? sorted.filter((r) =>
          [r.program, r.comment, r.material, r.sheet_thickness, r.ended_state]
            .some((v) => (v ?? "").toLowerCase().includes(f))
        )
      : sorted;

    return filtered.map((r) => ({
      ...r,
      parts_made:
        r.part_count_end != null && prevCount.get(r.id) != null
          ? r.part_count_end - (prevCount.get(r.id) as number)
          : null,
    }));
  }, [runs, sortKey, sortDir, filter]);

  const utilisation = useMemo(() => {
    const readyRuns = runs.filter((r) => r.ended_state === "READY");
    const totalSecs = readyRuns.reduce((s, r) => s + (r.runtime_seconds ?? 0), 0);
    const totalPrograms = readyRuns.length;
    const byTsAsc = [...runs].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    let parts = 0;
    let prev: number | null = null;
    for (const r of byTsAsc) {
      if (r.part_count_end != null && prev != null) {
        parts += Math.max(0, r.part_count_end - prev);
      }
      prev = r.part_count_end;
    }
    return { totalSecs, totalPrograms, parts };
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
        <h1 className="text-2xl font-semibold" style={{ color: "var(--pss-navy)" }}>Mazak</h1>
        <AuthButton redirectTo="/laserquote/mazak" />
      </div>
    );
  }

  const toggleSort = (key: keyof ProgramRun) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader title="Mazak Laser" />

      {/* Header status */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <p className="text-xs text-gray-500">Device</p>
            <p className="font-mono text-sm font-bold">{DEVICE_ID}</p>
            <p className="text-xs text-gray-400">
              {device?.status === "online" ? "Online" : "Offline"} · seen {ageLabel(device?.last_seen ?? null, now)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Execution</p>
            <span
              className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${EXECUTION_BADGE[currentExecution ?? ""] ?? "bg-gray-100 text-gray-700"}`}
            >
              {currentExecution ?? "—"}
            </span>
          </div>
          <div>
            <p className="text-xs text-gray-500">Program</p>
            <p className="font-mono text-sm font-medium">{currentProgram ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Material</p>
            <p className="text-sm font-medium">
              {currentMaterial ?? "—"}
              {currentThickness ? ` · ${currentThickness}mm` : ""}
            </p>
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
        <Timeline
          dateStr={timelineDate}
          segments={timelineSegments}
        />
        <div className="flex gap-4 mt-2 text-xs">
          {Object.entries(EXECUTION_COLORS).map(([state, color]) => (
            <div key={state} className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: color }} />
              <span className="text-gray-600">{state}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Utilisation summary */}
      <div>
        <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--pss-navy)" }}>
          Utilisation
        </h2>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <Tile label="Cutting Time" value={formatRuntime(utilisation.totalSecs)} />
          <Tile label="Programs Completed" value={String(utilisation.totalPrograms)} />
          <Tile label="Parts Made" value={String(utilisation.parts)} />
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-2">Cutting hours · last 30 days</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyHours} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={4} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  formatter={(v: number) => [`${v} hrs`, "Cutting"]}
                  labelStyle={{ fontSize: 12 }}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="hours" fill="#16a34a" />
              </BarChart>
            </ResponsiveContainer>
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
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter..."
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 w-48"
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
                  <SortTh label="Program" keyName="program" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortTh label="Comment" keyName="comment" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortTh label="Material" keyName="material" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortTh label="Thick." keyName="sheet_thickness" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortTh label="End" keyName="ts" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <SortTh label="Runtime" keyName="runtime_seconds" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <th className="py-2 pr-3 font-medium text-right">Parts</th>
                  <SortTh label="Ended" keyName="ended_state" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {displayRuns.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 pr-3 font-mono text-xs font-bold">{r.program ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs">{r.comment ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs">{r.material ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs">{r.sheet_thickness ?? "—"}</td>
                    <td className="py-2 pr-3 text-right text-xs whitespace-nowrap">{formatDateTime(new Date(r.ts))}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{formatRuntime(r.runtime_seconds)}</td>
                    <td className="py-2 pr-3 text-right text-xs">{r.parts_made ?? "—"}</td>
                    <td className="py-2 text-xs">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${EXECUTION_BADGE[r.ended_state ?? ""] ?? "bg-gray-100 text-gray-600"}`}>
                        {r.ended_state ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
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

function SortTh({
  label,
  keyName,
  sortKey,
  sortDir,
  onClick,
  align = "left",
}: {
  label: string;
  keyName: keyof ProgramRun;
  sortKey: keyof ProgramRun;
  sortDir: "asc" | "desc";
  onClick: (k: keyof ProgramRun) => void;
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
  const { start, end } = londonDayRange(dateStr);
  const total = end.getTime() - start.getTime();

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="relative h-10 bg-gray-50 rounded overflow-hidden">
        {segments.map((seg, i) => {
          const left = ((seg.from.getTime() - start.getTime()) / total) * 100;
          const width = ((seg.to.getTime() - seg.from.getTime()) / total) * 100;
          return (
            <div
              key={i}
              className="absolute top-0 h-full hover:opacity-80 transition-opacity"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: EXECUTION_COLORS[seg.state] ?? "#d1d5db",
              }}
              title={`${seg.state} · ${formatTime(seg.from)}–${formatTime(seg.to)}${seg.program ? ` · ${seg.program}` : ""}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-xs text-gray-400">
        {Array.from({ length: 13 }).map((_, i) => {
          const h = i * 2;
          return (
            <span key={h}>{String(h).padStart(2, "0")}:00</span>
          );
        })}
      </div>
    </div>
  );
}
