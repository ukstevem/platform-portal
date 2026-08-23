import Link from "next/link";
import { ErectionPlanner } from "@/components/ErectionPlanner";

export const dynamic = "force-dynamic";

const CAD_SERVICE_URL =
  process.env.CAD_SERVICE_URL ?? "http://host.docker.internal:8001";

type Model = { id: string; project_ref: string | null; name: string };

async function getModel(id: string): Promise<Model | null> {
  try {
    const res = await fetch(`${CAD_SERVICE_URL}/api/v1/models`, { cache: "no-store" });
    if (!res.ok) return null;
    const all: Model[] = await res.json();
    return all.find((m) => m.id === id) ?? null;
  } catch {
    return null;
  }
}

export default async function PlannerPage({
  params,
}: {
  params: Promise<{ model: string }>;
}) {
  const { model } = await params;
  const m = await getModel(model);

  return (
    <main className="flex h-[calc(100vh-3rem)] flex-col gap-3 p-4">
      <div>
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">
          ← all models
        </Link>
        <h1 className="mt-1 text-xl font-semibold">
          {m?.project_ref ?? "Erection sequence"}
          {m?.name && (
            <span className="ml-3 text-base font-normal text-slate-500">{m.name}</span>
          )}
        </h1>
      </div>

      <div className="min-h-0 flex-1">
        <ErectionPlanner
          modelId={model}
          projectRef={m?.project_ref ?? null}
          modelName={m?.name ?? null}
        />
      </div>
    </main>
  );
}
