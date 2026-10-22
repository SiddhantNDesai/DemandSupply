import { useMemo } from "react";
import { dayFull, dayLabel } from "../data/types";
import type { Demand } from "../model/demand";
import { PaceChart } from "./Charts";
import { downloadCsv, fmt, pct, shade, Spark, SpeedChip, SPEED_VAR, Tile } from "./format";

const MAX_ROWS = 200;

export function SkuTab({ D }: { D: Demand }) {
  const wl = (t: number) => dayLabel(D.start + 7 * t);
  const pace = useMemo(() => (["Fast", "Medium", "Slow"] as const).map((sp) => {
    const cur = new Float64Array(D.T); D.styles.filter((s) => s.speed === sp).forEach((s) => s.curve.forEach((v, t) => (cur[t] += v)));
    const tot = cur.reduce((a, b) => a + b, 0); let c = 0;
    return { speed: sp, cum: Array.from(cur, (v) => { c += v; return tot > 0 ? c / tot : 0; }), n: D.styles.filter((s) => s.speed === sp).length };
  }).filter((x) => x.n > 0), [D]);
  const st = D.stats, styles = D.styles.slice(0, MAX_ROWS), clusters = D.clusters;
  const cellOf = useMemo(() => new Map(D.cells.map((c) => [c.style + "|" + c.cluster, c])), [D]);
  const mxMu = Math.max(1, ...D.cells.map((c) => c.mu));
  const fpW = D.styles.filter((s) => s.fullPricePct !== null), fp = fpW.length ? fpW.reduce((a, s) => a + (s.fullPricePct ?? 0) * s.unitsSold, 0) / fpW.reduce((a, s) => a + s.unitsSold, 0) / 100 : null;
  return (
    <div className="pane">
      <p className="hint">Season {dayFull(D.start)} to {dayFull(D.end)} · {D.T} weeks · {st.byStock ? (st.bySize ? "stockouts found from SOH, by size" : "stockouts found from SOH, by style (no UPC column)") : "stockouts inferred from sales gaps (no stock data)"}</p>
      <div className="tiles">
        <Tile k="Styles analysed" v={D.styles.length} n={`${D.styles.filter((s) => s.speed === "Fast").length} fast movers · ${st.stores} stores`} />
        <Tile k="True demand last season" v={fmt(st.sold + st.lost)} n={`${fmt(st.sold)} sold + ${fmt(st.lost)} lost (${pct(st.sold > 0 ? st.lost / st.sold : 0)})`} />
        <Tile k="Sell-through" v={pct(st.sellThrough)} n={st.byStock ? "NSQ ÷ (NSQ + closing SOH)" : "Needs SOH"} />
        <Tile k="Return rate" v={pct(st.gross > 0 ? st.returns / st.gross : null)} n={`${fmt(st.returns)} units returned`} />
        <Tile k="Full-price sell share" v={pct(fp)} n="Units at ≤10% discount" />
        <Tile k="Forecast this season" v={fmt(st.forecast)} n={`Growth ${(D.settings.growth * 100).toFixed(0)}% · store changes applied`} />
      </div>
      <section className="card">
        <div className="card-h"><div><h2>Sell-through pace by speed class</h2><p>Share of each class's season demand (sold + lost) reached by each week. A steep early curve means stock must be in stores before the season starts.</p></div>
          <div className="legend">{pace.map((p) => <span key={p.speed}><i className="line" style={{ background: `var(${SPEED_VAR[p.speed]})` }} />{p.speed} movers</span>)}</div></div>
        <PaceChart series={pace} weekLabel={wl} />
      </section>
      <section className="card">
        <div className="card-h"><div><h2>Style performance and forecast</h2><p>Speed class ranks styles by rate of sale (true demand per store per selling week): top 30% fast, bottom 30% slow. In-stock % is the share of store-size weeks that closed with stock, weighted by demand.{D.styles.length > MAX_ROWS ? ` Showing ${MAX_ROWS} of ${D.styles.length} styles; the download has all.` : ""}</p></div>
          <button type="button" onClick={() => downloadCsv("sku_demand.csv", [["Style", "Group", "Speed", "Stores", "Units sold", "Est. lost", "True demand", "Rate of sale", "Sell-through %", "In-stock %", "Return rate %", "Full-price %", "50% by week", "Peak week", "Stock in stores now", "Forecast"],
            ...D.styles.map((s) => [s.style, s.group, s.speed, s.storesSelling, Math.round(s.unitsSold), Math.round(s.estLost), Math.round(s.trueDemand), s.rateOfSale.toFixed(3), s.sellThroughPct?.toFixed(1), s.inStockPct?.toFixed(1), s.returnRatePct?.toFixed(1), s.fullPricePct?.toFixed(1), s.w50 + 1, s.peakWeek + 1, Math.round(s.stockNow), Math.round(s.forecast)])])}>Download CSV</button></div>
        <div className="scroll"><table><thead><tr><th>Style</th><th className="l">Group</th><th className="l">Speed</th><th>Stores</th><th>Units sold</th><th>Est. lost</th><th>True demand</th><th>Rate of sale<br />/store/wk</th><th>Sell-<br />through</th><th>In-stock</th><th>Return<br />rate</th><th>Full-price<br />sell</th><th>50% sold<br />by week</th><th>Peak</th><th className="l">Weekly demand</th><th>Stock in<br />stores now</th><th>Forecast</th></tr></thead>
          <tbody>{styles.map((s) => (<tr key={s.style}><td>{s.style}</td><td className="l">{s.group}</td><td className="l"><SpeedChip s={s.speed} /></td><td className="num">{s.storesSelling}</td><td className="num">{fmt(s.unitsSold)}</td><td className="num">{fmt(s.estLost)}</td><td className="num">{fmt(s.trueDemand)}</td><td className="num">{s.rateOfSale.toFixed(2)}</td>
            <td className="num">{s.sellThroughPct === null ? "–" : s.sellThroughPct.toFixed(0) + "%"}</td>
            <td className="num" style={{ color: s.inStockPct !== null && s.inStockPct < 80 ? "var(--warn)" : undefined }}>{s.inStockPct === null ? "–" : s.inStockPct.toFixed(0) + "%"}</td>
            <td className="num">{s.returnRatePct === null ? "–" : s.returnRatePct.toFixed(1) + "%"}</td><td className="num">{s.fullPricePct === null ? "–" : s.fullPricePct.toFixed(0) + "%"}</td>
            <td className="num">{s.w50 < 0 ? "–" : "W" + (s.w50 + 1)}<small>{s.w50 < 0 ? "" : wl(s.w50)}</small></td><td className="num">W{s.peakWeek + 1}<small>{wl(s.peakWeek)}</small></td>
            <td className="l"><Spark values={s.curve} color={SPEED_VAR[s.speed]} /></td><td className="num">{fmt(s.stockNow)}</td><td className="num"><b>{fmt(s.forecast)}</b></td></tr>))}</tbody></table></div>
      </section>
      <section className="card">
        <div className="card-h"><div><h2>Forecast by style and cluster</h2><p>True demand last season × (stores this season ÷ stores last season) × (1 + growth). Darker cells hold more demand.{st.byStock ? " The small figure is the in-stock rate last season." : ""}</p></div></div>
        <div className="scroll"><table className="heat"><thead><tr><th>Style</th>{clusters.map((K) => <th key={K.cluster}>{K.cluster}</th>)}<th>Total</th></tr></thead>
          <tbody>{styles.map((s) => (<tr key={s.style}><td>{s.style}</td>{clusters.map((K) => { const c = cellOf.get(s.style + "|" + K.cluster); const v = c?.mu ?? 0;
            return <td key={K.cluster} className="h" style={{ background: shade(v / mxMu, 0.6) }}>{fmt(v)}{c?.inStockRate != null && <small>{pct(c.inStockRate, 0)} in stock</small>}</td>; })}<td className="num">{fmt(s.forecast)}</td></tr>))}
            <tr className="total"><td>Total</td>{clusters.map((K) => <td key={K.cluster} className="num" style={{ textAlign: "center" }}>{fmt(K.forecast)}</td>)}<td className="num">{fmt(st.forecast)}</td></tr></tbody></table></div>
      </section>
    </div>
  );
}
