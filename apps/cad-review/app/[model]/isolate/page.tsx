import Link from "next/link";
import { Isolation } from "@/components/Isolation";
import { PieceView } from "@/components/PieceView";

export const dynamic = "force-dynamic";

/**
 * One node of the model on its own (bd kl1y), or - with `&piece=` - one kind of piece in it,
 * opened up to be refined (bd kl1y.6). The node is named by its instance path in `?prefix=`, so a
 * link can be shared and the browser's back button walks back up the way it came down.
 */
export default async function IsolatePage({
  params, searchParams,
}: {
  params: Promise<{ model: string }>;
  searchParams: Promise<{ prefix?: string; piece?: string }>;
}) {
  const { model } = await params;
  const { prefix, piece } = await searchParams;

  return (
    <main className="p-6 max-w-[95rem]">
      <Link href={`/${model}/`} className="text-sm text-slate-500 hover:text-slate-800">
        ← back to the scope tree
      </Link>
      {!prefix ? <p className="mt-4 text-sm text-slate-500">No node chosen.</p>
        : piece ? <PieceView modelId={model} prefix={prefix} piece={piece} />
        : <Isolation modelId={model} prefix={prefix} />}
    </main>
  );
}
