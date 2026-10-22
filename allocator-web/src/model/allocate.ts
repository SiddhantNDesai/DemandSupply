// Steps 6-8: allocation under supply / space limits, baseline comparison, planner recommendations.
import type { Cell, Demand } from "./demand";
import { cellStats, largestRemainder, MaxHeap, pGE } from "./stats";

export interface AllocSettings {
  mode: "pool" | "style";
  supplyPct: number;           // default supply as share of need
  poolUnits: number | null;    // pool size (null = default)
  supplyByStyle: Record<string, number>;
  spacePerStore: number | null; // max units per store across styles, incl. stock already there
  minProb: number;             // do not ship a unit whose chance of selling is below this
  fastPriority: number;        // weight on fast movers (1 = maximise total units)
  byValue: boolean;            // weight units by average selling price
  countStoreStock: boolean;    // latest SOH in stores counts as already allocated
  pushPct: number; coverWeeks: number;
}
export const defaultAllocSettings: AllocSettings = { mode: "pool", supplyPct: 0.9, poolUnits: null, supplyByStyle: {}, spacePerStore: null,
  minProb: 0.05, fastPriority: 1.25, byValue: false, countStoreStock: false, pushPct: 0.65, coverWeeks: 4 };

export interface ACell extends Cell { inStore: number; alloc: number; allocLY: number; allocNP: number; es: number; esLY: number; esNP: number;
  lostE: number; lostLY: number; risk: number; riskLY: number; riskNP: number; opening: number }
export interface Summ { forecast: number; allocated: number; allocLY: number; fill: number; fillLY: number; risk: number; riskLY: number;
  lost: number; lostLY: number; es: number; esLY: number }
export interface AStyle extends Summ { style: string; speed: string; supply: number; inStore: number; heldAtDC: number; valueNextUnit: number;
  gainNext100: number; next100To: string[]; heldSpaceLimited: boolean; price: number }
export interface ACluster extends Summ { cluster: string; region: string; storesLY: number; storesTY: number; inStore: number; space: number;
  push: number; reserve: number; opening: number; openingShort: boolean; spaceUsed: number | null; spaceBound: boolean; peakWeek: number }
export interface Allocation { cells: ACell[]; styles: AStyle[]; clusters: ACluster[]; totals: Record<string, number | boolean>; recs: [string, string][]; settings: AllocSettings }

function summ(cs: ACell[]): Summ {
  const mu = cs.reduce((a, c) => a + c.mu, 0), sum = (f: (c: ACell) => number) => cs.reduce((a, c) => a + f(c), 0);
  return { forecast: mu, allocated: sum((c) => c.alloc), allocLY: sum((c) => c.allocLY), fill: mu ? sum((c) => c.es) / mu : 0,
    fillLY: mu ? sum((c) => c.esLY) / mu : 0, risk: mu ? sum((c) => c.risk * c.mu) / mu : 0, riskLY: mu ? sum((c) => c.riskLY * c.mu) / mu : 0,
    lost: sum((c) => c.lostE), lostLY: sum((c) => c.lostLY), es: sum((c) => c.es), esLY: sum((c) => c.esLY) };
}

export function allocate(D: Demand, a: AllocSettings): Allocation {
  const cells: ACell[] = D.cells.filter((c) => c.mu > 0 || c.base > 0).map((c) => ({ ...c, inStore: a.countStoreStock ? Math.round(c.stockNow) : 0,
    alloc: 0, allocLY: 0, allocNP: 0, es: 0, esLY: 0, esNP: 0, lostE: 0, lostLY: 0, risk: 0, riskLY: 0, riskNP: 0, opening: 0 }));
  const need = (c: ACell) => Math.max(0, c.mu - c.inStore);
  const needStyle = new Map<string, number>(); cells.forEach((c) => needStyle.set(c.style, (needStyle.get(c.style) ?? 0) + need(c)));
  const supplyOf = new Map<string, number>();
  let pool = 0, totalSupply = 0;
  if (a.mode === "style") {
    for (const st of D.styles) { const v = a.supplyByStyle[st.style] ?? Math.round((needStyle.get(st.style) ?? 0) * a.supplyPct); supplyOf.set(st.style, v); totalSupply += v; }
  } else { pool = a.poolUnits ?? Math.round(cells.reduce((s, c) => s + need(c), 0) * a.supplyPct); totalSupply = pool; }
  const inStoreCl = new Map<string, number>(); cells.forEach((c) => inStoreCl.set(c.cluster, (inStoreCl.get(c.cluster) ?? 0) + c.inStore));
  const space = new Map(D.clusters.map((K) => [K.cluster, a.spacePerStore ? K.storesTY * a.spacePerStore : Infinity]));
  const step = Math.max(1, Math.ceil(totalSupply / 6000));
  const baseW = (c: ACell) => (a.byValue ? c.price : 1);

  // Step 6: greedy on the (weighted) chance the next unit sells
  function greedy(key: "alloc" | "allocNP", fw: number) {
    const remS = new Map(supplyOf); let remP = pool;
    const cap = new Map([...space].map(([k, v]) => [k, v - (inStoreCl.get(k) ?? 0)]));
    const blocked = new Set<string>();
    const wt = (c: ACell) => baseW(c) * (c.speed === "Fast" ? fw : 1);
    const hp = new MaxHeap<ACell>();
    for (const c of cells) if (c.mu > 0) hp.push(wt(c) * pGE(c.inStore + 1 + (step - 1) / 2, c.mu, c.sd), c);
    while (hp.size) {
      const c = hp.pop().x, have = c.inStore + c[key];
      if (pGE(have + 1, c.mu, c.sd) < a.minProb) continue;
      const avail = a.mode === "pool" ? remP : remS.get(c.style) ?? 0;
      if (avail <= 0) continue;
      const capR = cap.get(c.cluster)!;
      if (capR <= 0) { blocked.add(c.cluster); continue; }
      const amt = Math.min(step, avail, capR);
      c[key] += amt; cap.set(c.cluster, capR - amt);
      if (a.mode === "pool") remP -= amt; else remS.set(c.style, avail - amt);
      hp.push(wt(c) * pGE(c.inStore + c[key] + 1 + (step - 1) / 2, c.mu, c.sd), c);
    }
    return { remP, blocked };
  }
  const run = greedy("alloc", a.fastPriority);
  if (a.fastPriority !== 1) greedy("allocNP", 1);

  // Step 7: baseline = split the same supply by last year's units sold
  const byStyle = new Map<string, ACell[]>(); cells.forEach((c) => { const l = byStyle.get(c.style); if (l) l.push(c); else byStyle.set(c.style, [c]); });
  const baseSupply = new Map<string, number>();
  if (a.mode === "pool") {
    const names = D.styles.map((s) => s.style), w = names.map((n) => (byStyle.get(n) ?? []).reduce((s, c) => s + Math.max(0, c.base), 0));
    largestRemainder(w, pool).forEach((v, i) => baseSupply.set(names[i], v));
  } else supplyOf.forEach((v, k) => baseSupply.set(k, v));
  for (const [st, cs] of byStyle) {
    let w = cs.map((c) => Math.max(0, c.base)); if (w.every((v) => v <= 0)) w = cs.map((c) => c.mu);
    largestRemainder(w, baseSupply.get(st) ?? 0).forEach((v, i) => (cs[i].allocLY = v));
  }
  if (a.spacePerStore) for (const K of D.clusters) {
    const cs = cells.filter((c) => c.cluster === K.cluster), tq = cs.reduce((s, c) => s + c.allocLY, 0);
    const capK = Math.max(0, space.get(K.cluster)! - (inStoreCl.get(K.cluster) ?? 0));
    if (tq > capK) cs.forEach((c) => (c.allocLY = Math.floor((c.allocLY * capK) / tq)));
  }
  // score both plans on the same forecast (available = stock in store + allocation)
  const N = Math.min(a.coverWeeks, D.T);
  for (const c of cells) {
    const o = cellStats(c.inStore + c.alloc, c.mu, c.sd), b = cellStats(c.inStore + c.allocLY, c.mu, c.sd), np = cellStats(c.inStore + c.allocNP, c.mu, c.sd);
    c.es = o.es; c.lostE = o.lost; c.risk = o.risk; c.esLY = b.es; c.lostLY = b.lost; c.riskLY = b.risk; c.esNP = np.es; c.riskNP = np.risk;
    const tt = c.curve.reduce((x, y) => x + y, 0); let cum = 0; for (let t = 0; t < N; t++) cum += c.curve[t];
    c.opening = tt > 0 ? (c.mu * cum) / tt : 0;
  }

  const styles: AStyle[] = D.styles.map((s) => {
    const cs = byStyle.get(s.style) ?? [], S = summ(cs), live = cs.filter((c) => c.mu > 0);
    const supply = a.mode === "style" ? supplyOf.get(s.style) ?? 0 : S.allocated;
    const held = a.mode === "style" ? Math.max(0, supply - S.allocated) : 0;
    const q = live.map((c) => c.inStore + c.alloc);
    const nu = live.length ? Math.max(...live.map((c, i) => pGE(q[i] + 1, c.mu, c.sd))) : 0;
    let gain = 0; const dest = new Map<string, number>();
    for (let u = 0; u < 100 && live.length; u++) {
      let bi = -1, bv = -1; live.forEach((c, i) => { const v = pGE(q[i] + 1, c.mu, c.sd); if (v > bv) { bv = v; bi = i; } });
      if (bv <= 0) break; q[bi]++; gain += bv; dest.set(live[bi].cluster, (dest.get(live[bi].cluster) ?? 0) + 1);
    }
    return { ...S, style: s.style, speed: s.speed, supply, inStore: cs.reduce((x, c) => x + c.inStore, 0), heldAtDC: held, valueNextUnit: nu,
      gainNext100: gain, next100To: [...dest].sort((x, y) => y[1] - x[1]).slice(0, 2).map((x) => x[0]), heldSpaceLimited: held > 0 && nu >= a.minProb, price: s.price };
  });
  const clusters: ACluster[] = D.clusters.map((K) => {
    const cs = cells.filter((c) => c.cluster === K.cluster), S = summ(cs), push = Math.round(S.allocated * a.pushPct), inStore = inStoreCl.get(K.cluster) ?? 0;
    const opening = cs.reduce((x, c) => x + c.opening, 0), sp = space.get(K.cluster)!;
    return { ...S, cluster: K.cluster, region: K.region, storesLY: K.storesLY, storesTY: K.storesTY, inStore, space: sp, push, reserve: S.allocated - push,
      opening, openingShort: push + inStore < opening * S.fill, spaceUsed: isFinite(sp) ? (S.allocated + inStore) / sp : null,
      spaceBound: run.blocked.has(K.cluster), peakWeek: K.peakWeek };
  });
  const T0 = summ(cells), fast = cells.filter((c) => c.speed === "Fast"), fmu = fast.reduce((s, c) => s + c.mu, 0);
  const totals: Record<string, number | boolean> = {
    supply: totalSupply, forecast: T0.forecast, inStore: cells.reduce((s, c) => s + c.inStore, 0), fill: T0.fill, fillLY: T0.fillLY,
    es: T0.es, esLY: T0.esLY, lost: T0.lost, lostLY: T0.lostLY, fastShare: T0.forecast ? fmu / T0.forecast : 0,
    fastRisk: fmu ? fast.reduce((s, c) => s + c.risk * c.mu, 0) / fmu : NaN, fastRiskLY: fmu ? fast.reduce((s, c) => s + c.riskLY * c.mu, 0) / fmu : NaN,
    fastLost: fast.reduce((s, c) => s + c.lostE, 0), fastLostLY: fast.reduce((s, c) => s + c.lostLY, 0),
    valueGain: cells.reduce((s, c) => s + (c.es - c.esLY) * c.price, 0),
    held: a.mode === "pool" ? run.remP : styles.reduce((s, x) => s + x.heldAtDC, 0),
    poolSpaceLimited: a.mode === "pool" && run.remP > 0 && cells.some((c) => c.mu > 0 && pGE(c.inStore + c.alloc + 1, c.mu, c.sd) >= a.minProb),
  };
  if (a.fastPriority !== 1 && fmu > 0) { totals.npEs = cells.reduce((s, c) => s + c.esNP, 0); totals.npFastRisk = fast.reduce((s, c) => s + c.riskNP * c.mu, 0) / fmu; }
  return { cells, styles, clusters, totals, recs: recommendations(D, a, cells, styles, clusters, totals), settings: a };
}

function recommendations(D: Demand, a: AllocSettings, cells: ACell[], styles: AStyle[], clusters: ACluster[], t: Record<string, number | boolean>): [string, string][] {
  const R: [string, string][] = [], n = (k: string) => t[k] as number;
  const f = (x: number) => Math.round(x).toLocaleString("en-IN"), p = (x: number) => (x * 100).toFixed(0) + "%";
  const gain = n("es") - n("esLY");
  const stockTxt = a.countStoreStock && n("inStore") ? ` plus ${f(n("inStore"))} units already in stores` : "";
  R.push(["Summary", `With ${f(n("supply"))} units of supply${stockTxt} against ${f(n("forecast"))} units of forecast demand, the optimised split is projected to sell ` +
    `${f(n("es"))} units (${(n("fill") * 100).toFixed(1)}% fill rate), against ${f(n("esLY"))} (${(n("fillLY") * 100).toFixed(1)}%) when supply is split by last year's sales: ` +
    `${gain >= 0 ? "+" : "−"}${f(Math.abs(gain))} units` + (a.byValue ? ` and ₹${f(n("valueGain"))} of sales value` : "") +
    (gain < 0 && t.npFastRisk !== undefined ? ", because fast-mover priority gives up some total units (see Trade-off)." : " from the same stock.")]);
  const fastNames = styles.filter((s) => s.speed === "Fast").map((s) => s.style);
  if (fastNames.length && !isNaN(n("fastRisk")))
    R.push(["Fast movers", `Fast movers (${fastNames.slice(0, 4).join(", ")}${fastNames.length > 4 ? ` and ${fastNames.length - 4} more` : ""}) hold ${p(n("fastShare"))} of demand. ` +
      `Their projected stockout risk moves from ${p(n("fastRiskLY"))} to ${p(n("fastRisk"))}, and expected lost sales from ${f(n("fastLostLY"))} to ${f(n("fastLost"))} units.`]);
  if (t.npFastRisk !== undefined) {
    if (Math.abs(n("npFastRisk") - n("fastRisk")) < 0.005)
      R.push(["Note", "Fast-mover priority has no effect here: each style has its own supply and stores have no space limit, so styles never compete for stock. It takes effect with one shared pool or a space limit."]);
    else { const cost = n("npEs") - n("es");
      R.push(["Trade-off", `Fast-mover priority (×${a.fastPriority}) lowers fast-mover stockout risk from ${p(n("npFastRisk"))} (plan that maximises total units) to ${p(n("fastRisk"))}, for ` +
        (cost >= 0.5 ? `${f(cost)} fewer expected units sold overall.` : "almost no loss in total units.")]); }
  }
  const sh = cells.map((c) => ({ c, d: c.alloc - c.allocLY })).filter((x) => x.d > 0).sort((x, y) => y.d - x.d).slice(0, 3);
  if (sh.length) R.push(["Rebalance", "Biggest moves against last year's split: " + sh.map((x) => `+${f(x.d)} ${x.c.style} to ${x.c.cluster}` +
    (x.c.lost >= 1 ? ` (${D.stats.hasStock ? "stockouts hid" : "sales gaps suggest"} about ${f(x.c.lost)} units of demand there)` : "")).join("; ") +
    ". The units come from clusters where extra stock was less likely to sell."]);
  const adds = styles.filter((s) => s.gainNext100 > 0 && (a.mode === "pool" || s.heldAtDC === 0))
    .sort((x, y) => y.gainNext100 * (a.byValue ? y.price : 1) - x.gainNext100 * (a.byValue ? x.price : 1)).slice(0, 3);
  if (adds.length) R.push(["Buy more", "If more supply can be found, the next 100 units add the most sales in " +
    adds.map((s) => `${s.style} (about ${f(s.gainNext100)} extra units sold, mostly in ${s.next100To.join(" / ")})`).join(", ") + "."]);
  if (a.mode === "pool" && n("held") > 0) R.push(["Excess", `${f(n("held"))} units of the pool ` + (t.poolSpaceLimited
    ? "could not be placed because stores ran out of space. Hold them at the DC for replenishment, or raise the space limit."
    : `have under ${p(a.minProb)} chance of selling in any cluster. Hold them at the DC, or reduce the buy.`)]);
  if (a.mode === "style") {
    const sp = styles.filter((s) => s.heldSpaceLimited).reduce((x, s) => x + s.heldAtDC, 0);
    if (sp > 0) R.push(["Excess", `${f(sp)} units could not be placed because stores ran out of space. They stay at the DC for replenishment.`]);
    const over = styles.filter((s) => s.heldAtDC > 0 && !s.heldSpaceLimited).sort((x, y) => y.heldAtDC - x.heldAtDC).slice(0, 3);
    if (over.length) R.push(["Excess", over.map((s) => `${f(s.heldAtDC)} units of ${s.style}`).join(", ") +
      ` have under ${p(a.minProb)} chance of selling in any cluster. Keep them at the DC, cut the buy, or plan an early markdown.`]);
  }
  if (a.countStoreStock) {
    const heavy = cells.filter((c) => c.inStore - c.mu >= 1).sort((x, y) => y.inStore - y.mu - (x.inStore - x.mu)).slice(0, 3);
    if (heavy.length) R.push(["Transfer", "Stores already hold more than forecast demand for " + heavy.map((c) => `${c.style} in ${c.cluster} (${f(c.inStore - c.mu)} units over)`).join("; ") +
      ". Consider inter-store transfers to clusters short of the same style."]);
  }
  if (D.stats.hasStock) {
    const low = D.styles.filter((s) => s.inStockPct !== null && s.inStockPct < 80).sort((x, y) => (x.inStockPct ?? 0) - (y.inStockPct ?? 0)).slice(0, 3);
    if (low.length) R.push(["In-stock", "Lowest in-stock rates last season: " + low.map((s) => `${s.style} (${(s.inStockPct ?? 0).toFixed(0)}% of store-size weeks in stock)`).join(", ") +
      ". These styles carry the most hidden demand; protect their replenishment."]);
  }
  const bound = clusters.filter((K) => K.spaceBound).map((K) => K.cluster);
  if (bound.length) R.push(["Space", `${bound.join(", ")} ${bound.length > 1 ? "are" : "is"} at the space limit, so the lowest-value units were left out there. More space or fewer slow styles would release more sales.`]);
  const short = clusters.filter((K) => K.openingShort).map((K) => K.cluster);
  if (short.length) R.push(["Timing", `The initial push does not cover the first ${a.coverWeeks} weeks of demand in ${short.join(", ")}. Raise the push % or send their reserve in week 1.`]);
  return R;
}
