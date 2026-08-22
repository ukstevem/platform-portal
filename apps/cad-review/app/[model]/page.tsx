import Link from "next/link";
import { ReviewQueue } from "@/components/ReviewQueue";

export const dynamic = "force-dynamic";

const CAD_SERVICE_URL =
  process.env.CAD_SERVICE_URL ?? "http://host.docker.internal:8001";

async function getModel(id: string) {
  try {
    const res = await fetch(`${CAD_SERVICE_URL}/api/v1/models`, { cache: "no-store" });
    if (!res.ok) return null;
    const all = await res.json();
    return all.find((m: { id: string }) => m.id === id) ?? null;
  } catch {
    return null;
  }
}

export default async function ModelReviewPage({
  params,
}: {
  params: Promise<{ model: string }>;
}) {
  const { model } = await params;
  const m = await getModel(model);

  return (
    <main className="p-6 max-w-5xl">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">
        ← all models
      </Link>

      <div className="mt-2 mb-6">
        <h1 className="text-2xl font-semibold">
          {m?.project_ref ?? "Review"}
          {m?.name && <span className="ml-3 text-base font-normal text-slate-500">{m.name}</span>}
        </h1>
      </div>

      <ReviewQueue modelId={model} />
    </main>
  );
}
