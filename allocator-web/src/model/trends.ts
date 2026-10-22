// QoQ / MoM / YoY trends from the weekly facts (buckets never cross a month, so months and quarters are exact).
import { dateOf, dayOf, MONS, type Dataset } from "../data/types";
import type { Masks } from "./filters";

export type Mode = "Q" | "M";
export type Measure = "qty" | "val";
export type Dim = "cluster" | "region" | "seg" | "lfl" | "style";

export function periodOf(day: number, mode: Mode, fy: boolean) {
  const x = dateOf(day), y = x.getUTCFullYear(), m0 = x.getUTCMonth();
  if (mode === "M") return y * 12 + m0;
  if (fy) return (m0 >= 3 ? y + 1 : y) * 4 + Math.floor(((m0 - 3 + 12) % 12) / 3);
  return y * 4 + Math.floor(m0 / 3);
}
export function periodStart(i: number, mode: Mode, fy: boolean) {
  if (mode === "M") return dayOf(Math.floor(i / 12), (i % 12) + 1, 1);
  const q = ((i % 4) + 4) % 4, y = Math.floor(i / 4);
  if (fy) { const m0 = (3 + 3 * q) % 12; return dayOf(q < 3 ? y - 1 : y, m0 + 1, 1); }
  return dayOf(y, 3 * q + 1, 1);
}
export function periodLabel(i: number, mode: Mode, fy: boolean) {
  if (mode === "M") return MONS[i % 12] + " " + String(Math.floor(i / 12)).slice(2);
  const q = (i % 4) + 1, y = Math.floor(i / 4);
  return fy ? `Q${q} FY${String(y).slice(2)}` : `Q${q} ${y}`;
}

interface Agg { q: number; v: number; m: number; dq: number; dn: number; g: number; r: number }
const agg0 = (): Agg => ({ q: 0, v: 0, m: 0, dq: 0, dn: 0, g: 0, r: 0 });
export type Kpi = "qty" | "val" | "asp" | "disc" | "ret";
export function metric(a: Agg | undefined, k: Kpi): number | null {
  if (!a) return null;
  switch (k) {
    case "qty": return a.q;
    case "val": return a.v;
    case "asp": return a.q > 0 ? a.v / a.q : null;
    case "disc": return a.m > 0 ? 1 - a.v / a.m : a.dn > 0 ? a.dq / a.dn / 100 : null;
    case "ret": return a.g > 0 ? a.r / a.g : null;
  }
}
const growth = (c: number | null, p: number | null) => (c === null || p === null || p === 0 ? null : (c - p) / Math.abs(p));

export interface TrendResult {
  p0: number; p1: number; review: number; label: string; partial: boolean; hasLY: boolean; lag: number;
  options: { id: number; label: string }[];
  kpis: { label: string; kpi: Kpi; value: number | null; vsPrev: number | null; vsLY: number | null; pct: boolean }[];
  series: { id: number; label: string; value: number; ly: number | null; partial: boolean }[];
  rows: { key: string; hist: number[]; cur: number; vsPrev: number | null; vsLY: number | null; share: number; shareChg: number | null; chgLY: number | null; spark: number[] }[];
  histIds: number[];
}

export function trends(ds: Dataset, M: Masks, mode: Mode, fy: boolean, measure: Measure, dim: Dim, lflOnly: boolean, review?: number): TrendResult {
  const pOf = new Map<number, number>();
  const per = (d: number) => { let p = pOf.get(d); if (p === undefined) { p = periodOf(d, mode, fy); pOf.set(d, p); } return p; };
  let p0 = Infinity, p1 = -Infinity;
  for (let i = 0; i < ds.n; i++) if (M.factOk[i]) { const p = per(ds.fDay[i]); if (p < p0) p0 = p; if (p > p1) p1 = p; }
  if (!isFinite(p0)) throw new Error("No rows left after filters.");
  const partial = (i: number) => ds.maxDay < periodStart(i + 1, mode, fy) - 1 || ds.minDay > periodStart(i, mode, fy);
  let rv = review ?? p1;
  if (review === undefined) while (rv > p0 && partial(rv)) rv--;
  const lag = mode === "M" ? 12 : 4;
  let storeOk: Uint8Array | null = null;
  if (lflOnly) {
    const a = new Uint8Array(ds.stores.length), b = new Uint8Array(ds.stores.length);
    for (let i = 0; i < ds.n; i++) if (M.factOk[i] && ds.qty[i] !== 0) {
      const p = per(ds.fDay[i]);
      if (p <= rv && p > rv - lag) a[ds.fStore[i]] = 1; else if (p <= rv - lag && p > rv - 2 * lag) b[ds.fStore[i]] = 1;
    }
    storeOk = a.map((v, i) => (v && b[i] ? 1 : 0));
  }
  const dimOf = (i: number) => {
    const st = ds.stores[ds.fStore[i]], sty = ds.upcs[ds.fUpc[i]].style;
    return dim === "cluster" ? st.cluster : dim === "region" ? st.region || "(blank)" : dim === "lfl" ? st.lfl || "(blank)"
      : dim === "seg" ? M.styleSeg[sty] : ds.styles[sty].code;
  };
  const tot = new Map<number, Agg>(), byDim = new Map<string, Map<number, Agg>>();
  const add = (a: Agg, i: number) => {
    const q = ds.qty[i]; a.q += q; a.v += ds.val[i]; a.m += ds.mrpv[i]; a.g += ds.gross[i]; a.r += ds.ret[i];
    if (ds.fBand[i] !== 7) { a.dq += ds.dq[i]; a.dn += ds.gross[i]; }
  };
  for (let i = 0; i < ds.n; i++) {
    if (!M.factOk[i] || (storeOk && !storeOk[ds.fStore[i]])) continue;
    const p = per(ds.fDay[i]);
    let a = tot.get(p); if (!a) { a = agg0(); tot.set(p, a); } add(a, i);
    const k = dimOf(i);
    let mp = byDim.get(k); if (!mp) { mp = new Map(); byDim.set(k, mp); }
    let b = mp.get(p); if (!b) { b = agg0(); mp.set(p, b); } add(b, i);
  }
  const prev = rv - 1, ly = rv - lag, hasLY = ly >= p0;
  const kpis: TrendResult["kpis"] = [];
  const defs: [string, Kpi, boolean][] = [["Units sold (net)", "qty", false], ["Sales value", "val", false], ["Avg. selling price", "asp", false], ["Avg. discount", "disc", true], ["Return rate", "ret", true]];
  for (const [label, k, isPct] of defs) {
    if ((k === "val" || k === "asp") && !ds.has.value) continue;
    if (k === "disc" && !ds.has.mrpv && !ds.has.disc) continue;
    if (k === "ret" && ![...tot.values()].some((a) => a.r > 0)) continue;
    const c = metric(tot.get(rv), k), p = metric(tot.get(prev), k), l = metric(tot.get(ly), k);
    kpis.push({ label, kpi: k, value: c, pct: isPct,
      vsPrev: isPct ? (c !== null && p !== null ? c - p : null) : growth(c, p),
      vsLY: isPct ? (c !== null && l !== null ? c - l : null) : growth(c, l) });
  }
  const series: TrendResult["series"] = [];
  for (let i = p0; i <= p1; i++) series.push({ id: i, label: periodLabel(i, mode, fy), value: metric(tot.get(i), measure) ?? 0,
    ly: hasLyFor(i) ? metric(tot.get(i - lag), measure) ?? 0 : null, partial: partial(i) });
  function hasLyFor(i: number) { return i - lag >= p0; }
  const totCur = metric(tot.get(rv), measure) ?? 0, totLY = hasLY ? metric(tot.get(ly), measure) ?? 0 : 0;
  const histIds: number[] = []; for (let i = rv - 5; i <= rv; i++) if (i >= p0) histIds.push(i);
  const nSpark = Math.min(12, rv - p0 + 1);
  const rows = [...byDim.entries()].map(([key, mp]) => {
    const c = metric(mp.get(rv), measure) ?? 0, p = metric(mp.get(prev), measure) ?? 0, l = metric(mp.get(ly), measure) ?? 0;
    const spark: number[] = []; for (let i = rv - nSpark + 1; i <= rv; i++) spark.push(metric(mp.get(i), measure) ?? 0);
    return { key, cur: c, hist: histIds.map((i) => metric(mp.get(i), measure) ?? 0), vsPrev: p > 0 ? (c - p) / p : null,
      vsLY: hasLY && l > 0 ? (c - l) / l : null, share: totCur ? c / totCur : 0,
      shareChg: hasLY && totLY && totCur ? c / totCur - l / totLY : null, chgLY: hasLY ? c - l : null, spark };
  }).sort((a, b) => b.cur - a.cur);
  const options: TrendResult["options"] = [];
  for (let i = p1; i >= p0; i--) options.push({ id: i, label: periodLabel(i, mode, fy) + (partial(i) ? " (partial)" : "") });
  return { p0, p1, review: rv, label: periodLabel(rv, mode, fy), partial: partial(rv), hasLY, lag, options, kpis, series, rows, histIds };
}
