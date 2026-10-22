import type { Dataset } from "../data/types";

export interface Filters {
  channels: string[] | null;   // null = offline only when a channel column exists
  lfl: string[] | null;        // null = all
  fabrics: string[] | null;    // raw fabric values; null = all
  styleQ: string;
  groups: Record<string, string>; // raw fabric -> group name
}

export interface Masks {
  factOk: Uint8Array;   // sales facts passing channel / store / style filters
  stockOk: Uint8Array;  // stock facts passing store / style filters
  styleSeg: string[];   // fabric group per style
  storeCluster: string[];
  upcStyle: Int32Array; // style id per UPC
}

export const defaultChannels = (vals: string[]) => { const off = vals.filter((v) => /offline/i.test(v)); return off.length ? off : vals; };

export function makeMasks(ds: Dataset, f: Filters): Masks {
  const chanSet = new Set(f.channels ?? (ds.has.channel ? defaultChannels(ds.channels) : ds.channels));
  const chanOk = ds.channels.map((c) => chanSet.has(c));
  const lflSet = f.lfl ? new Set(f.lfl) : null;
  const storeOk = ds.stores.map((s) => !lflSet || lflSet.has(s.lfl));
  const fabSet = f.fabrics ? new Set(f.fabrics) : null;
  const q = f.styleQ.trim().toLowerCase();
  const styleOk = ds.styles.map((s) => (!fabSet || fabSet.has(s.fabric)) && (!q || s.code.toLowerCase().includes(q)));
  const styleSeg = ds.styles.map((s) => (ds.has.fabric ? (f.groups[s.fabric] || s.fabric || "(blank)") : "All"));
  const factOk = new Uint8Array(ds.n);
  for (let i = 0; i < ds.n; i++) factOk[i] = chanOk[ds.fChan[i]] && storeOk[ds.fStore[i]] && styleOk[ds.upcs[ds.fUpc[i]].style] ? 1 : 0;
  const stockOk = new Uint8Array(ds.m);
  for (let j = 0; j < ds.m; j++) stockOk[j] = storeOk[ds.kStore[j]] && styleOk[ds.upcs[ds.kUpc[j]].style] ? 1 : 0;
  return { factOk, stockOk, styleSeg, storeCluster: ds.stores.map((s) => s.cluster), upcStyle: Int32Array.from(ds.upcs, (u) => u.style) };
}
