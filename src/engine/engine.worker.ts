/// <reference lib="webworker" />
// The engine: reads files, keeps the condensed dataset, and runs every calculation. The page only sends
// settings and receives small results, so it never holds the large arrays and never freezes.
import { NeedsMapping, parseCsv, parseExample, parseExcel, type Parsed } from "../data/parse";
import type { Dataset } from "../data/types";
import { allocate } from "../model/allocate";
import { computeDemand, type Demand } from "../model/demand";
import { makeMasks, type Masks } from "../model/filters";
import { trends } from "../model/trends";
import type { Meta, Request, Response } from "./protocol";

const post = (m: Response) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
let ds: Dataset | null = null;
let masksKey = "", masks: Masks | null = null;
let demandKey = "", demand: Demand | null = null;

const getMasks = (f: unknown) => {
  const k = JSON.stringify(f);
  if (!masks || k !== masksKey) { masks = makeMasks(ds!, f as Parameters<typeof makeMasks>[1]); masksKey = k; demandKey = ""; }
  return masks;
};

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  const t0 = performance.now();
  try {
    if (req.type === "load") {
      const progress = (stage: string, pct: number, rows: number) => post({ id: req.id, type: "progress", stage, pct, rows });
      let p: Parsed;
      if (req.source.kind === "example") { progress("Building example data", 10, 0); p = parseExample(); }
      else {
        const { file, dayfirst, mapping, sheet } = req.source;
        p = /\.(csv|txt)$/i.test(file.name) ? await parseCsv(file, dayfirst, mapping, progress) : await parseExcel(file, dayfirst, mapping, sheet, progress);
      }
      ds = p.dataset; masks = null; masksKey = ""; demand = null; demandKey = "";
      const meta: Meta = { fileName: ds.fileName, headers: p.headers, mapping: p.mapping, sheets: p.sheets, sheet: p.sheet, ms: performance.now() - t0,
        has: ds.has, diag: ds.diag, minDay: ds.minDay, maxDay: ds.maxDay, stockFacts: ds.m, channels: ds.channels,
        lfl: [...new Set(ds.stores.map((s) => s.lfl))].sort(), fabrics: [...new Set(ds.styles.map((s) => s.fabric))].sort() };
      post({ id: req.id, type: "loaded", meta });
      return;
    }
    if (!ds) throw new Error("No data loaded yet.");
    if (req.type === "trends") {
      const q = req.q;
      post({ id: req.id, type: "trends", result: trends(ds, getMasks(q.filters), q.mode, q.fy, q.measure, q.dim, q.lflOnly, q.review) });
      return;
    }
    if (req.type === "plan") {
      const M = getMasks(req.q.filters);
      const k = JSON.stringify(req.q.demand);
      if (!demand || k !== demandKey) { demand = computeDemand(ds, M, req.q.demand); demandKey = k; }
      const A = allocate(demand, req.q.alloc);
      post({ id: req.id, type: "plan", D: demand, A, ms: performance.now() - t0 });
    }
  } catch (err) {
    if (err instanceof NeedsMapping) post({ id: req.id, type: "error", message: err.message, headers: err.headers, mapping: err.mapping, sheets: err.sheets, sheet: err.sheet });
    else post({ id: req.id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
