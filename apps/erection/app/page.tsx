import Link from "next/link";

export const dynamic = "force-dynamic";

type Model = {
  id: string;
  project_ref: string | null;
  name: string;
  status: string | null;
  ingested_at: string | null;
};

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

  return (
    <main className="p-6 max-w-5xl">
      <h1 className="text-2xl font-semibold">Erection Planner</h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        Pick a model, then select its pieces in the order they go up.
      </p>

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
              className="flex items-center gap-4 px-4 py-3 transition hover:bg-slate-50"
            >
              <span className="w-20 shrink-0 font-mono text-sm font-semibold text-slate-900">
                {m.project_ref ?? "—"}
              </span>
              <span className="flex-1 truncate text-sm text-slate-700">{m.name}</span>
              <span className="shrink-0 text-xs text-slate-400">
                {m.ingested_at ? new Date(m.ingested_at).toLocaleDateString("en-GB") : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
