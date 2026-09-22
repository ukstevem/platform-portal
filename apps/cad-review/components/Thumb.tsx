"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A picture that waits its turn (bd jj0p).
 *
 * Every row of the scope tree carries a picture, because Steve identifies a node by looking at
 * it, not by its name (bd tr2b). Opening one node therefore asks for thirty pictures. Two limits
 * keep that from getting in the way:
 *
 *  - Only rows NEAR THE SCREEN ask. A picture of a part three screens down is work nobody is
 *    waiting for.
 *  - At most MAX_LOADING pictures are in flight. Over plain HTTP a browser opens about six
 *    connections to one host; thirty picture requests would hold all six, and the tree and tag
 *    requests Steve IS waiting on would queue behind them. The CAD service limits its own
 *    drawing too - this limit is about the browser's connections, not the server's CPU.
 *
 * Fetched rather than set as an <img> src, because three answers need telling apart and an
 * image element reports all of them as one "error":
 *    200  the picture
 *    204  nothing to draw (a zero-solid wrapper) - an empty box, for good
 *    202  not prepared yet - the service will not parse a model's file to draw a picture,
 *         because on a large model that stalls it for minutes. Reported through onNotReady so
 *         the page can offer to prepare them.
 * The browser's HTTP cache still applies to fetch, so a picture seen once is not asked for again.
 */

const MAX_LOADING = 2;
// Bumped when the pictures are drawn differently. They are served as immutable for a year, so
// without a new address a browser keeps the old drawing: 2 = depth-buffer renderer (kl1y.10).
const RENDER = 2;
let active = 0;
const waiting: Array<() => void> = [];

/** Run `start` when a slot is free. Returns a function that gives the slot back (or leaves
 *  the queue, if the slot never came). Safe to call more than once. */
function takeSlot(start: () => void): () => void {
  let state: "waiting" | "running" | "done" = "waiting";
  const run = () => { state = "running"; start(); };
  if (active < MAX_LOADING) { active++; run(); } else waiting.push(run);
  return () => {
    if (state === "waiting") {
      const i = waiting.indexOf(run);
      if (i >= 0) waiting.splice(i, 1);
    } else if (state === "running") {
      active--;
      const next = waiting.shift();
      if (next) { active++; next(); }
    }
    state = "done";
  };
}

type Shown = "wait" | "ok" | "none" | "later";

export function Thumb({ src, className, onNotReady }: {
  src: string; className: string; onNotReady?: () => void;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<Shown>("wait");
  // A ref, so a new callback identity from the parent does not refetch the picture.
  const notReady = useRef(onNotReady);
  useEffect(() => { notReady.current = onNotReady; }, [onNotReady]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // A generous margin, so a picture is usually ready by the time its row scrolls into view.
    const io = new IntersectionObserver((seen) => {
      if (seen.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Keyed on `near` and `src`. A parent that wants a fresh look (pictures just prepared)
  // remounts this with a new key rather than changing props.
  useEffect(() => {
    if (!near) return;
    const ctl = new AbortController();
    let made: string | null = null;
    let giveBack = () => {};
    giveBack = takeSlot(async () => {
      try {
        const address = `${src}${src.includes("?") ? "&" : "?"}r=${RENDER}`;
        const res = await fetch(address, { signal: ctl.signal });
        if (res.status === 200) {
          made = URL.createObjectURL(await res.blob());
          setUrl(made); setState("ok");
        } else if (res.status === 202) {
          setState("later"); notReady.current?.();
        } else {
          setState("none");
        }
      } catch {
        if (!ctl.signal.aborted) setState("none");
      } finally {
        giveBack();
      }
    });
    // A row that closes or refreshes gives its slot back, so a collapsed branch never holds
    // up the one that replaced it.
    return () => { ctl.abort(); giveBack(); if (made) URL.revokeObjectURL(made); };
  }, [near, src]);

  return (
    <span ref={box}
          title={state === "none" ? "Nothing to draw"
               : state === "later" ? "Picture not prepared yet" : undefined}
          className={`relative block shrink-0 overflow-hidden rounded bg-slate-100 ${className}`}>
      {state === "wait" && <span className="absolute inset-0 animate-pulse bg-slate-200" />}
      {state === "later" && (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-400">
          not ready
        </span>
      )}
      {state === "ok" && url && (
        <img alt="" src={url} className="relative h-full w-full object-contain" />
      )}
    </span>
  );
}
