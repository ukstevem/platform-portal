import Link from "next/link";
import { Isolation } from "@/components/Isolation";

export const dynamic = "force-dynamic";

/**
 * One node of the model on its own (bd kl1y). Reached from "Work in isolation" on a scope-tree
 * row; the node is named by its instance path in `?prefix=`, so a link to it can be shared and
 * the browser's back button walks back up the way it came down.
 */
export default async function IsolatePage({
  params, searchParams,
}: {
  params: Promise<{ model: string }>;
  searchParams: Promise<{ prefix?: string }>;
}) {
  const { model } = await params;
  const { prefix } = await searchParams;

  return (
    <main className="p-6 max-w-[95rem]">
      <Link href={`/${model}/`} className="text-sm text-slate-500 hover:text-slate-800">
        ← back to the scope tree
      </Link>
      {prefix
        ? <Isolation modelId={model} prefix={prefix} />
        : <p className="mt-4 text-sm text-slate-500">No node chosen.</p>}
    </main>
  );
}
