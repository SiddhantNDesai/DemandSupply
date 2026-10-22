// Steps 2-5: seasonality index, true demand (lost sales from SOH stockouts), SKU analysis, forecast.
import { BAND_UPPER, mondayOf, type Dataset } from "../data/types";
import type { Masks } from "./filters";

export interface DemandSettings {
  from: number | null; to: number | null; // season window (day numbers); null = latest 52 weeks
  maxDisc: number;      // keep sales in discount bands up to this % (100 = all)
  impute: boolean;      // add estimated lost sales
  useStock: boolean;    // stockouts from SOH when available
  minGap: number;       // gap method: weeks of zero sales
  minExpected: number;  // gap method: expected units for a gap to count
  maxUplift: number;    // lost sales cap, share of units sold per store-size
  growth: number;       // vs last season
  cv: number;           // forecast error (coefficient of variation)
  tyStores: Record<string, number>; // stores this season per cluster
}
export const defaultDemandSettings: DemandSettings = { from: null, to: null, maxDisc: 100, impute: true, useStock: true, minGap: 2,
  minExpected: 4, maxUplift: 1, growth: 0, cv: 0.3, tyStores: {} };

export function defaultSeason(ds: Dataset): [number, number] {
  return [ds.maxDay - ds.minDay > 371 ? ds.maxDay - 363 : ds.minDay, ds.maxDay];
}

export interface Cell {
  style: string; styleId: number; cluster: string; seg: string; sold: number; lost: number; trueDemand: number; mu: number; base: number; sd: number;
  stores: number; seasonEndStock: number; sellThrough: number | null; inStockRate: number | null; curve: Float64Array; stockNow: number;
  speed: Speed; price: number;
}
export type Speed = "Fast" | "Medium" | "Slow";
export interface StyleRow {
  style: string; group: string; storesSelling: number; unitsSold: number; estLost: number; trueDemand: number; rateOfSale: number;
  sellThroughPct: number | null; inStockPct: number | null; returnRatePct: number | null; fullPricePct: number | null;
  w50: number; w80: number; peakWeek: number; forecast: number; base: number; stockNow: number; price: number; curve: Float64Array; speed: Speed;
}
export interface ClusterRow {
  cluster: string; region: string; storesLY: number; storesTY: number; sold: number; lost: number; forecast: number;
  seasonEndStock: number; stockNow: number; sellThroughPct: number | null; phase: number[]; peakWeek: number;
}
export interface AuditRow {
  key: string; cluster: string; sold: Float64Array; soh: Float64Array | null; index: Float64Array; rate: number; lost: Float64Array;
  flag: Uint8Array; added: number; capped: boolean; method: "stock" | "gap";
}
export interface Demand {
  T: number; start: number; end: number; cells: Cell[]; styles: StyleRow[]; clusters: ClusterRow[]; audit: AuditRow[];
  stats: { sold: number; lost: number; forecast: number; lostStock: number; lostGap: number; stores: number; facts: number; hasStock: boolean;
    returns: number; gross: number; sellThrough: number | null; stockNow: number; byStock: boolean; bySize: boolean };
  settings: DemandSettings;
}

export function computeDemand(ds: Dataset, M: Masks, s: DemandSettings): Demand {
  const [f0, t0] = defaultSeason(ds);
  const from = s.from ?? f0, to = s.to ?? t0;
  const bandMax = BAND_UPPER.findIndex((u, b) => b < 7 && u >= s.maxDisc - 1e-9);
  const bandOk = (b: number) => b === 7 || s.maxDisc >= 100 || b <= (bandMax < 0 ? 6 : bandMax);
  const inWin = (i: number) => M.factOk[i] && ds.fDay[i] >= from && ds.fDay[i] <= to && bandOk(ds.fBand[i]);

  let minB = Infinity, maxB = -Infinity, facts = 0;
  for (let i = 0; i < ds.n; i++) if (inWin(i)) { facts++; if (ds.fDay[i] < minB) minB = ds.fDay[i]; if (ds.fDay[i] > maxB) maxB = ds.fDay[i]; }
  if (!facts) throw new Error("No sales between the season dates. Widen the dates or relax the filters.");
  const start = mondayOf(minB), T = Math.floor((mondayOf(maxB) - start) / 7) + 1;
  const wk = (day: number) => Math.floor((mondayOf(day) - start) / 7);
  const byStock = s.useStock && ds.has.stock;
  const bySize = byStock && ds.has.upc;
  const nItems = bySize ? ds.upcs.length : ds.styles.length;
  const itemOf = (upc: number) => (bySize ? upc : M.upcStyle[upc]);
  const itemStyle = (item: number) => (bySize ? M.upcStyle[item] : item);

  // units (store x size, or store x style) with weekly net sales
  interface Unit { store: number; item: number; style: number; cluster: string; seg: string; w: Float64Array; soh: Float64Array | null }
  const units = new Map<number, Unit>();
  const unit = (store: number, item: number) => {
    const k = store * nItems + item;
    let u = units.get(k);
    if (!u) { const sty = itemStyle(item); u = { store, item, style: sty, cluster: M.storeCluster[store], seg: M.styleSeg[sty], w: new Float64Array(T), soh: null }; units.set(k, u); }
    return u;
  };
  const sty = { units: new Float64Array(ds.styles.length), val: new Float64Array(ds.styles.length), mrpv: new Float64Array(ds.styles.length),
    fp: new Float64Array(ds.styles.length), dn: new Float64Array(ds.styles.length), gross: new Float64Array(ds.styles.length), ret: new Float64Array(ds.styles.length) };
  const nSty = ds.styles.length;
  const storeStyle = new Set<number>();               // (store, style) pairs seen, for store counts per cell
  const weekOf = new Int32Array(maxB - minB + 1);       // day -> week index, computed once per day
  for (let d = minB; d <= maxB; d++) weekOf[d - minB] = wk(d);
  let lastKey = -1, lastUnit: Unit | null = null;
  for (let i = 0; i < ds.n; i++) {
    if (!M.factOk[i]) continue;
    const day = ds.fDay[i];
    if (day < from || day > to || !bandOk(ds.fBand[i])) continue;
    const st = ds.fStore[i], upc = ds.fUpc[i], y = M.upcStyle[upc];
    const item = bySize ? upc : y, k = st * nItems + item;
    const u = k === lastKey ? lastUnit! : (lastKey = k, lastUnit = unit(st, item));
    const q = ds.qty[i];
    u.w[weekOf[day - minB]] += q;
    sty.units[y] += q; sty.val[y] += ds.val[i]; sty.mrpv[y] += ds.mrpv[i]; sty.gross[y] += ds.gross[i]; sty.ret[y] += ds.ret[i];
    if (ds.fBand[i] !== 7) { sty.dn[y] += ds.gross[i]; if (ds.fBand[i] <= 1) sty.fp[y] += ds.gross[i]; }
    storeStyle.add(st * nSty + y);
  }
  const cellStores = new Map<string, number>();
  const storesSeen = new Set<number>();
  for (const v of storeStyle) {
    const st = Math.floor(v / nSty), y = v % nSty, ck = y + "|" + M.storeCluster[st];
    cellStores.set(ck, (cellStores.get(ck) ?? 0) + 1);
    storesSeen.add(st);
  }
  // closing stock per unit-week: last snapshot of the week, carried forward, negatives as 0
  if (byStock) {
    const raw = new Map<number, Float64Array>();
    for (let j = 0; j < ds.m; j++) {
      if (!M.stockOk[j]) continue;
      const w = ds.kWeek[j]; if (w < mondayOf(from) || w > to) continue;
      const t = (w - start) / 7; if (t < 0 || t >= T) continue;
      const item = itemOf(ds.kUpc[j]); const k = ds.kStore[j] * nItems + item;
      let a = raw.get(k); if (!a) { a = new Float64Array(T).fill(NaN); raw.set(k, a); }
      a[t] = Number.isNaN(a[t]) ? Math.max(0, ds.kSoh[j]) : a[t] + Math.max(0, ds.kSoh[j]); // sums sizes only when not by size
    }
    for (const [k, a] of raw) {
      for (let t = 1; t < T; t++) if (Number.isNaN(a[t]) && !Number.isNaN(a[t - 1])) a[t] = a[t - 1];
      const store = Math.floor(k / nItems), item = k % nItems;
      unit(store, item).soh = a;
    }
  }

  // Step 2: weekly index per cluster x fabric group
  const idxSrc = new Map<string, Float64Array>();
  for (const u of units.values()) {
    const key = u.cluster + "|" + u.seg;
    let a = idxSrc.get(key); if (!a) { a = new Float64Array(T); idxSrc.set(key, a); }
    for (let t = 0; t < T; t++) a[t] += u.w[t];
  }
  const idx = new Map<string, Float64Array | null>();
  for (const [k, a] of idxSrc) { const mean = a.reduce((x, y) => x + y, 0) / T; idx.set(k, mean > 0 ? a.map((v) => Math.max(0, v) / mean) : null); }

  // Step 3: lost sales
  const audit: AuditRow[] = [];
  let nStock = 0, nGap = 0;
  interface Acc { sold: Float64Array; lost: Float64Array; curve: Float64Array; endStock: number; ins: number; rng: number; style: number; cluster: string; seg: string }
  const acc = new Map<string, Acc>();
  for (const u of units.values()) {
    const I = idx.get(u.cluster + "|" + u.seg) ?? null;
    const w = u.w, soh = u.soh;
    const lostArr = new Float64Array(T);
    let ins = 0, rng = 0, instock: Uint8Array | null = null, oos: Uint8Array | null = null;
    if (soh) {
      let first = -1;
      for (let t = 0; t < T; t++) if (!Number.isNaN(soh[t]) || w[t] !== 0) { first = t; break; }
      instock = new Uint8Array(T); oos = new Uint8Array(T);
      for (let t = Math.max(first, 0); t < T; t++) if (!Number.isNaN(soh[t])) { if (soh[t] > 0) { instock[t] = 1; ins++; } else oos[t] = 1; }
      rng = ins + oos.reduce((a, b) => a + b, 0);
    }
    if (s.impute && I) {
      let rate = 0, lost: Float64Array | null = null, flag: Uint8Array | null = null, method: "stock" | "gap" = "stock";
      if (soh && instock && oos) {
        let den = 0, sold = 0, anyOos = false;
        for (let t = 0; t < T; t++) { if (instock[t]) { den += I[t]; sold += Math.max(0, w[t]); } if (oos[t]) anyOos = true; }
        if (den > 0 && sold > 0 && anyOos) {
          rate = sold / den; lost = new Float64Array(T); flag = new Uint8Array(T);
          for (let t = 0; t < T; t++) if (oos[t]) { lost[t] = Math.max(0, rate * I[t] - Math.max(0, w[t])); flag[t] = lost[t] > 0 ? 1 : 0; }
        }
      } else if (!soh) {
        method = "gap";
        let f = -1, l = -1; for (let t = 0; t < T; t++) if (w[t] > 0) { if (f < 0) f = t; l = t; }
        if (f >= 0) {
          const runs: [number, number][] = []; let a = -1;
          for (let t = f; t <= T; t++) { const z = t < T && w[t] <= 0; if (z && a < 0) a = t; if (!z && a >= 0) { if (t - a >= s.minGap) runs.push([a, t - 1]); a = -1; } }
          if (runs.length) {
            const inRun = new Uint8Array(T); runs.forEach(([x, y]) => { for (let t = x; t <= y; t++) inRun[t] = 1; });
            let den = 0, sold = 0; for (let t = f; t <= l; t++) if (!inRun[t]) { den += I[t]; sold += Math.max(0, w[t]); }
            if (den > 0 && sold > 0) {
              rate = sold / den; lost = new Float64Array(T); flag = new Uint8Array(T);
              for (const [x, y] of runs) { let e = 0; for (let t = x; t <= y; t++) e += rate * I[t]; if (e < s.minExpected) continue; for (let t = x; t <= y; t++) { lost[t] = rate * I[t]; flag[t] = 1; } }
            }
          }
        }
      }
      if (lost && flag) {
        const tot = lost.reduce((a, b) => a + b, 0);
        if (tot > 0) {
          const units_ = w.reduce((a, b) => a + Math.max(0, b), 0);
          const scale = units_ > 0 ? Math.min(1, (units_ * s.maxUplift) / tot) : 0;
          for (let t = 0; t < T; t++) lostArr[t] = lost[t] * scale;
          if (method === "stock") nStock++; else nGap++;
          const label = ds.stores[u.store].code + " · " + (bySize ? ds.upcs[u.item].code : ds.styles[u.style].code);
          audit.push({ key: label, cluster: u.cluster, sold: w, soh, index: I, rate, lost: lostArr, flag, added: tot * scale, capped: scale < 1, method });
        }
      }
    }
    const ck = u.style + "|" + u.cluster;
    let a = acc.get(ck);
    if (!a) { a = { sold: new Float64Array(T), lost: new Float64Array(T), curve: new Float64Array(T), endStock: 0, ins: 0, rng: 0, style: u.style, cluster: u.cluster, seg: u.seg }; acc.set(ck, a); }
    for (let t = 0; t < T; t++) { a.sold[t] += w[t]; a.lost[t] += lostArr[t]; a.curve[t] += Math.max(0, w[t]) + lostArr[t]; }
    if (soh) { const last = soh[T - 1]; a.endStock += Number.isNaN(last) ? 0 : last; }
    a.ins += ins; a.rng += rng;
  }
  audit.sort((x, y) => y.added - x.added);

  // stock in stores now: latest snapshot per store x UPC over the whole file
  const nowMap = new Map<string, number>();
  if (byStock) {
    const latest = new Map<number, number>();
    for (let j = 0; j < ds.m; j++) {
      if (!M.stockOk[j]) continue;
      const k = ds.kStore[j] * ds.upcs.length + ds.kUpc[j], cur = latest.get(k);
      if (cur === undefined || ds.kWeek[j] > ds.kWeek[cur]) latest.set(k, j);
    }
    for (const j of latest.values()) {
      const ck = ds.upcs[ds.kUpc[j]].style + "|" + M.storeCluster[ds.kStore[j]];
      nowMap.set(ck, (nowMap.get(ck) ?? 0) + Math.max(0, ds.kSoh[j]));
    }
  }

  // Step 4: store counts by cluster (last season vs this season)
  const lyStores = new Map<string, number>();
  for (const st of storesSeen) lyStores.set(M.storeCluster[st], (lyStores.get(M.storeCluster[st]) ?? 0) + 1);
  const clusterNames = [...lyStores.keys()].sort();
  const regionOf = new Map<string, string>();
  for (const st of storesSeen) if (!regionOf.has(M.storeCluster[st])) regionOf.set(M.storeCluster[st], ds.stores[st].region);
  const ratio = (cl: string) => { const ly = lyStores.get(cl) ?? 0; return ly > 0 ? (s.tyStores[cl] ?? ly) / ly : 1; };

  // Step 5: forecast per style x cluster
  const cells: Cell[] = [];
  for (const a of acc.values()) {
    const sold = Math.max(0, a.sold.reduce((x, y) => x + y, 0)), lost = a.lost.reduce((x, y) => x + y, 0), adj = sold + lost;
    const r = ratio(a.cluster), mu = adj * r * (1 + s.growth);
    cells.push({ style: ds.styles[a.style].code, styleId: a.style, cluster: a.cluster, seg: a.seg, sold, lost, trueDemand: adj, mu,
      base: sold * r * (1 + s.growth), sd: Math.max(0.5, Math.sqrt(mu + (s.cv * mu) ** 2)), stores: cellStores.get(a.style + "|" + a.cluster) ?? 0,
      seasonEndStock: a.endStock, sellThrough: byStock && sold + a.endStock > 0 ? sold / (sold + a.endStock) : null,
      inStockRate: byStock && a.rng > 0 ? a.ins / a.rng : null, curve: a.curve, stockNow: nowMap.get(a.style + "|" + a.cluster) ?? 0,
      speed: "Medium", price: 1 });
  }

  // Step 4 (cont.): style summary and speed class
  const byStyle = new Map<number, Cell[]>();
  for (const c of cells) { const l = byStyle.get(c.styleId); if (l) l.push(c); else byStyle.set(c.styleId, [c]); }
  let styles: StyleRow[] = [];
  for (const [y, cs] of byStyle) {
    const curve = new Float64Array(T); cs.forEach((c) => c.curve.forEach((v, t) => (curve[t] += v)));
    const adj = cs.reduce((a, c) => a + c.trueDemand, 0), sold = cs.reduce((a, c) => a + c.sold, 0), es = cs.reduce((a, c) => a + c.seasonEndStock, 0);
    let f = -1, l = -1; curve.forEach((v, t) => { if (v > 0) { if (f < 0) f = t; l = t; } });
    const weeks = f < 0 ? 1 : l - f + 1, stores = cs.reduce((a, c) => a + c.stores, 0);
    let cum = 0, w50 = -1, w80 = -1, pk = 0;
    curve.forEach((v, t) => { cum += v; if (w50 < 0 && cum >= 0.5 * adj) w50 = t; if (w80 < 0 && cum >= 0.8 * adj) w80 = t; if (v > curve[pk]) pk = t; });
    const isr = cs.filter((c) => c.inStockRate !== null);
    const isrW = isr.reduce((a, c) => a + c.trueDemand, 0);
    const price = sty.units[y] > 0 && sty.val[y] > 0 ? sty.val[y] / sty.units[y] : sty.units[y] > 0 && sty.mrpv[y] > 0 ? sty.mrpv[y] / sty.units[y] : 1;
    styles.push({ style: ds.styles[y].code, group: M.styleSeg[y], storesSelling: stores, unitsSold: sold, estLost: adj - sold, trueDemand: adj,
      rateOfSale: stores ? adj / stores / weeks : 0, sellThroughPct: byStock && sold + es > 0 ? (sold / (sold + es)) * 100 : null,
      inStockPct: isr.length && isrW > 0 ? (isr.reduce((a, c) => a + (c.inStockRate ?? 0) * c.trueDemand, 0) / isrW) * 100 : null,
      returnRatePct: sty.gross[y] > 0 ? (sty.ret[y] / sty.gross[y]) * 100 : null, fullPricePct: sty.dn[y] > 0 ? (sty.fp[y] / sty.dn[y]) * 100 : null,
      w50, w80, peakWeek: pk, forecast: cs.reduce((a, c) => a + c.mu, 0), base: cs.reduce((a, c) => a + c.base, 0),
      stockNow: cs.reduce((a, c) => a + c.stockNow, 0), price, curve, speed: "Medium" });
  }
  styles.sort((a, b) => b.rateOfSale - a.rateOfSale);
  const n = styles.length, nf = Math.max(1, Math.round(n * 0.3)), ns = n >= 3 ? Math.max(1, Math.round(n * 0.3)) : 0;
  styles.forEach((x, i) => (x.speed = i < nf ? "Fast" : i >= n - ns ? "Slow" : "Medium"));
  const speedOf = new Map(styles.map((x) => [x.style, x])), priceOf = speedOf;
  cells.forEach((c) => { c.speed = speedOf.get(c.style)!.speed; c.price = priceOf.get(c.style)!.price; });
  styles = styles.sort((a, b) => b.forecast - a.forecast);

  const clusters: ClusterRow[] = clusterNames.map((cl) => {
    const cs = cells.filter((c) => c.cluster === cl);
    const ph = new Float64Array(T); cs.forEach((c) => c.curve.forEach((v, t) => (ph[t] += v)));
    const tt = ph.reduce((a, b) => a + b, 0), phase = Array.from(ph, (v) => (tt > 0 ? v / tt : 0));
    const sold = cs.reduce((a, c) => a + c.sold, 0), es = cs.reduce((a, c) => a + c.seasonEndStock, 0);
    return { cluster: cl, region: regionOf.get(cl) ?? "", storesLY: lyStores.get(cl) ?? 0, storesTY: s.tyStores[cl] ?? lyStores.get(cl) ?? 0,
      sold, lost: cs.reduce((a, c) => a + c.lost, 0), forecast: cs.reduce((a, c) => a + c.mu, 0), seasonEndStock: es,
      stockNow: cs.reduce((a, c) => a + c.stockNow, 0), sellThroughPct: byStock && sold + es > 0 ? (sold / (sold + es)) * 100 : null,
      phase, peakWeek: phase.indexOf(Math.max(...phase)) };
  });
  const sum = (k: "sold" | "lost" | "mu" | "seasonEndStock" | "stockNow") => cells.reduce((a, c) => a + c[k], 0);
  const gross = sty.gross.reduce((a, b) => a + b, 0), ret = sty.ret.reduce((a, b) => a + b, 0);
  return { T, start, end: start + 7 * T - 1, cells, styles, clusters, audit: audit.slice(0, 60), settings: s,
    stats: { sold: sum("sold"), lost: sum("lost"), forecast: sum("mu"), lostStock: nStock, lostGap: nGap, stores: storesSeen.size, facts,
      hasStock: byStock, returns: ret, gross, sellThrough: byStock ? sum("sold") / (sum("sold") + sum("seasonEndStock")) : null,
      stockNow: sum("stockNow"), byStock, bySize } };
}
