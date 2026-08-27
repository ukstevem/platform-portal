import Link from "next/link";
import { UploadModel } from "@/components/UploadModel";

export const dynamic = "force-dynamic";

type Model = {
  id: string;
  project_ref: string | null;
  name: string;
  status: string | null;
  ingested_at: string | null;
};

/** Rows sharing a project AND a filename cannot be told apart by either (bd dup).
 *  Job 10353 holds two, ingested 49 minutes apart from the same file. */
function ambiguous(models: Model[]): Set<string> {
  const seen = new Map<string, string[]>();
  for (const m of models) {
    const k = `${m.project_ref ?? ""}|${m.name}`;
    seen.set(k, [...(seen.get(k) ?? []), m.id]);
  }
  return new Set([...seen.values()].filter((ids) => ids.length > 1).flat());
}

const CAD_SERVICE_URL =
  process.env.CAD_SERVICE_URL ?? "http://host.docker.internal:8001";

async function getModels(): Promise<{ models: Model[]; error: string | null }> {
  try {
    const res = await fetch(`${CAD_SERVICE_URL}/api/v1/models`, { cache: "no-store" });
    if (!res.ok) return { models: [], error: `CAD service returned ${res.status}` };
    return { models: await res.json(), error: null };
  } catch {
    // Say WHICH host failed. "Could not connect" with no address is the message that
    // costs ten minutes of guessing.
    return { models: [], error: `Could not reach the CAD service at ${CAD_SERVICE_URL}` };
  }
}

export default async function ModelsPage() {
  const { models, error } = await getModels();
  const dupes = ambiguous(models);

  return (
    <main className="p-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-1">CAD Review</h1>
      <p className="text-sm text-slate-500 mb-6">
        Pick a model to review the parts the pipeline could not settle on its own.
      </p>

      <div className="mb-6">
        <UploadModel />
      </div>

      {error && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </div>
      )}

      {!error && models.length === 0 && (
        <p className="text-sm text-slate-500">No models ingested yet.</p>
      )}

      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {models.map((m) => (
          <li key={m.id}>
            <Link
              href={`/${m.id}/`}
              className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition"
            >
              <span className="font-mono text-sm font-semibold text-slate-900 w-20 shrink-0">
                {m.project_ref ?? "—"}
              </span>
              <span className="flex-1 truncate text-sm text-slate-700">{m.name}</span>
              {/* The TIME, but only where the date cannot separate them — noise otherwise. */}
              <span className="shrink-0 text-xs tabular-nums text-slate-400">
                {m.ingested_at
                  ? dupes.has(m.id)
                    ? new Date(m.ingested_at).toLocaleString("en-GB",
                        { day: "2-digit", month: "2-digit", year: "numeric",
                          hour: "2-digit", minute: "2-digit" })
                    : new Date(m.ingested_at).toLocaleDateString("en-GB")
                  : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
