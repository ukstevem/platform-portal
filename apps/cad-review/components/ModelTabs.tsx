"use client";

import { useState } from "react";
import { ReviewQueue } from "./ReviewQueue";
import { PartsList } from "./PartsList";
import { ScopeCandidates } from "./ScopeCandidates";
import { ScopeTree } from "./ScopeTree";
import { StockNesting } from "./StockNesting";
import { BomTable } from "./BomTable";
import { MasterBom } from "./MasterBom";

/**
 * Two questions, two views. "What still needs me?" (review) and "what did we make, and give
 * me the file" (parts). They are different jobs — one is adjudication, the other is
 * collecting output — so mixing them into one table would serve neither.
 */
type TabKey = "tree" | "scope" | "review" | "parts" | "bom" | "master" | "nest";
const TABS: TabKey[] = ["tree", "scope", "review", "parts", "bom", "master", "nest"];

export function ModelTabs({ modelId, projectRef, initialTab }: {
  modelId: string; projectRef?: string | null; initialTab?: string;
}) {
  // ?tab= opens a tab directly, so a link can land on the master BOM.
  const [tab, setTab] = useState<TabKey>(
    TABS.includes(initialTab as TabKey) ? (initialTab as TabKey) : "tree");
  // Bump to force the sibling views to refetch after a scope decision changes
  // what is billable underneath them.
  const [gen, setGen] = useState(0);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-slate-200">
        {([["tree", "Scope the model"], ["scope", "Possible bought-outs"],
          ["review", "Review"], ["parts", "Parts & cut files"],
          ["bom", "Bill of materials"], ["master", "Master BOM"],
          ["nest", "Stock & nesting"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${
              tab === k
                ? "border-slate-900 font-medium text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Scope comes FIRST: reviewing parts that should never have been analysed
          is pure waste, so clearing the decks belongs before per-part review. */}
      {/* Scoping comes FIRST and starts at the TOP: keep-whole stops the descent, so
          deciding here is what keeps everything downstream small (bd iip). */}
      {tab === "tree" && (
        <ScopeTree key={`t${gen}`} modelId={modelId} onChanged={() => setGen(gen + 1)} />)}
      {tab === "scope" && (
        <ScopeCandidates key={`s${gen}`} modelId={modelId}
                         onChanged={() => setGen(gen + 1)} />)}
      {tab === "review" && <ReviewQueue key={`r${gen}`} modelId={modelId} />}
      {tab === "parts" && <PartsList key={`p${gen}`} modelId={modelId} />}
      {/* Last in the strip because it is last in the job: nothing should be nested until the
          scope is settled and the lengths are verified. */}
      {/* Between the cut files and the nest: it is the whole job in one table, and the place
          someone checks a part against a drawing before anything is cut. */}
      {tab === "bom" && (
        <BomTable key={`b${gen}`} modelId={modelId} projectRef={projectRef} />
      )}
      {/* Assemblies and material from every node marked done while working in isolation, and
          what is not covered yet (bd kl1y.7). */}
      {tab === "master" && <MasterBom key={`m${gen}`} modelId={modelId} />}
      {tab === "nest" && (
        <StockNesting key={`n${gen}`} modelId={modelId} projectRef={projectRef} />
      )}
    </div>
  );
}
