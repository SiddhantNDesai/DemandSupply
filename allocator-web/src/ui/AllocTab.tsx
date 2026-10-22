import { useMemo } from "react";
import { dayLabel } from "../data/types";
import type { Meta } from "../engine/protocol";
import type { AllocSettings, Allocation } from "../model/allocate";
import type { Demand } from "../model/demand";
import { Cmp, downloadCsv, fmt, pct, shade, SpeedChip, Tile } from "./format";

const MAX_ROWS = 200;
const TAG_CLASS: Record<string, string> = { Summary: "ok", "Fast movers": "ok", Rebalance: "act", "Buy more": "act", Excess: "act", Transfer: "act", "In-stock": "act", Space: "act", Timing: "act" };

export function AllocTab({ meta, D, A, a, setA, tyStores, setTyStores }: { meta: Meta; D: Demand; A: Allocation; a: AllocSettings;
  setA: (f: (p: AllocSettings) => AllocSettings) => void; tyStores: Record<string, number>; setTyStores: (v: Record<string, number>) => void }) {
  const set = <K extends keyof AllocSettings>(k: K, v: AllocSettings[K]) => setA((p) => ({ ...p, [k]: v }));
  const ds = { diag: meta.diag, m: meta.stockFacts, has: meta.has };
  const t = A.totals as Record<string, number>;
  const fastRisk = t.fastRisk, wl = (w: number) => dayLabel(D.start + 7 * w);
  const cellOf = useMemo(() => new Map(A.cells.map((c) => [c.style + "|" + c.cluster, c])), [A]);
  const styles = A.styles.slice(0, MAX_ROWS);
  const maxA = Math.max(1, ...A.clusters.map((K) => K.allocated));
  const num = (v: string) => (v === "" ? null : Number(v));
  const N = a.coverWeeks;
  return (
    <div className="pane">
      <div className="toolbar">
        <span className="lab">Supply</span>
        <label className="f">Supply limit<select value={a.mode} onChange={(e) => set("mode", e.target.value as "pool" | "style")}><option value="pool">One pool across styles</option><option value="style">Per style</option></select></label>
        <label className="f">Default supply (% of need)<input type="number" min={0} max={300} step={5} value={Math.round(a.supplyPct * 100)} onChange={(e) => set("supplyPct", (num(e.target.value) ?? 90) / 100)} /></label>
        {a.mode === "pool" && <label className="f">Pool size (units)<input type="number" min={0} step={100} placeholder="auto" value={a.poolUnits ?? ""} onChange={(e) => set("poolUnits", num(e.target.value) || null)} /></label>}
        <label className="f">Space per store (units, all styles)<input type="number" min={0} step={50} placeholder="no limit" value={a.spacePerStore ?? ""} onChange={(e) => set("spacePerStore", num(e.target.value) || null)} /></label>
        <label className="f">Ship only if chance of selling ≥ (%)<input type="number" min={0} max={95} step={5} value={Math.round(a.minProb * 100)} onChange={(e) => set("minProb", (num(e.target.value) ?? 5) / 100)} /></label>
        <label className="f">Fast-mover priority<select value={a.fastPriority} onChange={(e) => set("fastPriority", +e.target.value)}><option value={1}>None (maximise units)</option><option value={1.25}>Moderate (×1.25)</option><option value={1.5}>Strong (×1.5)</option></select></label>
        <label className="toggle"><input type="checkbox" checked={a.countStoreStock} disabled={!D.stats.hasStock} onChange={(e) => set("countStoreStock", e.target.checked)} /><span>Count stock already in stores (latest SOH)</span></label>
        <label className="toggle"><input type="checkbox" checked={a.byValue} onChange={(e) => set("byValue", e.target.checked)} /><span>Prioritise by sales value</span></label>
        <span className="lab">Store push</span>
        <label className="f">Initial push (%)<input type="number" min={0} max={100} step={5} value={Math.round(a.pushPct * 100)} onChange={(e) => set("pushPct", (num(e.target.value) ?? 65) / 100)} /></label>
        <label className="f">Weeks the push must cover<input type="number" min={1} max={20} value={a.coverWeeks} onChange={(e) => set("coverWeeks", num(e.target.value) || 4)} /></label>
      </div>

      <div className="tiles">
        <Tile k="Supply vs forecast" v={fmt(t.supply)} n={`of ${fmt(t.forecast)} forecast${a.countStoreStock ? ` · ${fmt(t.inStore)} already in stores` : ""}`} />
        <Tile k="Projected fill rate" v={pct(t.fill)} n={`vs ${pct(t.fillLY)} on last year's split`} />
        <Tile k="Fast-mover stockout risk" v={pct(fastRisk, 0)} n={`vs ${pct(t.fastRiskLY, 0)} on last year's split`} />
        <Tile k="Expected lost sales" v={fmt(t.lost)} n={`vs ${fmt(t.lostLY)} units on last year's split`} />
      </div>

      <section className="card">
        <div className="card-h"><div><h2>Planner recommendations</h2><p>Generated from the plan below. Both plans are scored against the same forecast, so these are projections, not measured results.</p></div>
          <div className="btns">
            <button type="button" onClick={() => downloadCsv("allocation_plan.csv", [["Style", "Cluster", "Speed", "Forecast", "Already in stores", "Allocate", "LY-split allocation", "Stockout risk %", "Expected sales", "Expected lost"],
              ...A.cells.map((c) => [c.style, c.cluster, c.speed, Math.round(c.mu), c.inStore, c.alloc, c.allocLY, (c.risk * 100).toFixed(1), Math.round(c.es), Math.round(c.lostE)])])}>Download plan (CSV)</button>
            <button type="button" onClick={() => downloadCsv("cluster_plan.csv", [["Cluster", "Region", "Stores LY", "Stores TY", "Forecast", "Already in stores", "Allocate", "LY split", "Fill rate %", "Initial push", "DC reserve", `Wk 1-${N} demand`, "Peak week"],
              ...A.clusters.map((K) => [K.cluster, K.region, K.storesLY, K.storesTY, Math.round(K.forecast), K.inStore, K.allocated, K.allocLY, (K.fill * 100).toFixed(1), K.push, K.reserve, Math.round(K.opening), K.peakWeek + 1])])}>Cluster plan (CSV)</button>
          </div></div>
        <ul className="recs">{A.recs.map(([tag, txt], i) => (<li key={i}><span className={"tag " + (TAG_CLASS[tag] ?? "")}>{tag}</span><span>{txt}</span></li>))}</ul>
      </section>

      <section className="card">
        <div className="card-h"><div><h2>Supply and service by style</h2><p>{a.mode === "style" ? `Type the units you can get for each style. Blank uses ${Math.round(a.supplyPct * 100)}% of need.` : "One pool shared by all styles, so the optimiser also decides which styles get stock."} Fill rate, stockout risk and lost sales show last year's split → optimised.</p></div>
          {a.mode === "style" && <button type="button" onClick={() => set("supplyByStyle", {})}>Reset supply</button>}</div>
        <div className="scroll"><table><thead><tr><th>Style</th><th className="l">Speed</th><th>Forecast</th>{a.countStoreStock && <th>In stores</th>}<th>{a.mode === "style" ? "Supply" : "Pool share"}</th><th>Allocated</th><th>Held at DC</th><th>Fill rate</th><th>Stockout risk</th><th>Expected<br />lost sales</th><th>Value of<br />next unit</th></tr></thead>
          <tbody>{styles.map((s) => (<tr key={s.style}><td>{s.style}</td><td className="l"><SpeedChip s={s.speed} /></td><td className="num">{fmt(s.forecast)}</td>{a.countStoreStock && <td className="num">{fmt(s.inStore)}</td>}
            <td>{a.mode === "style" ? <input type="number" min={0} step={10} value={s.supply} onChange={(e) => { const v = num(e.target.value); const nx = { ...a.supplyByStyle }; if (v === null || v < 0) delete nx[s.style]; else nx[s.style] = Math.round(v); set("supplyByStyle", nx); }} /> : <span className="num">{fmt(s.supply)}</span>}</td>
            <td className="num">{fmt(s.allocated)}</td><td className="num">{s.heldAtDC ? fmt(s.heldAtDC) : "–"}</td><td><Cmp was={pct(s.fillLY, 0)} now={pct(s.fill, 0)} /></td><td><Cmp was={pct(s.riskLY, 0)} now={pct(s.risk, 0)} /></td><td><Cmp was={fmt(s.lostLY)} now={fmt(s.lost)} /></td><td className="num">{s.valueNextUnit.toFixed(2)}</td></tr>))}
            <tr className="total"><td>Total</td><td></td><td className="num">{fmt(t.forecast)}</td>{a.countStoreStock && <td className="num">{fmt(t.inStore)}</td>}<td className="num">{fmt(t.supply)}</td><td className="num">{fmt(A.cells.reduce((x, c) => x + c.alloc, 0))}</td><td className="num">{fmt(t.held)}</td><td><Cmp was={pct(t.fillLY, 0)} now={pct(t.fill, 0)} /></td><td></td><td><Cmp was={fmt(t.lostLY)} now={fmt(t.lost)} /></td><td></td></tr></tbody></table></div>
        <p className="hint" style={{ marginTop: 8 }}>Value of next unit is the chance that one more unit would sell, sent to the cluster where it is most likely to. Use it to compare buy-more options.</p>
      </section>

      <section className="card">
        <div className="card-h"><div><h2>Allocation by cluster</h2><p>Change <b>Stores this season</b> for openings or closures; forecast demand per store carries over.</p></div></div>
        <div className="scroll"><table><thead><tr><th>Cluster</th><th>Stores<br />last season</th><th>Stores<br />this season</th><th>Forecast</th>{a.countStoreStock && <th>In stores</th>}<th>Allocated</th><th>vs last<br />year's split</th>{a.spacePerStore ? <th>Space<br />used</th> : null}<th>Fill rate</th><th>Initial push</th><th>DC reserve</th><th>Wk 1–{N}<br />demand</th><th>Peak week</th></tr></thead>
          <tbody>{A.clusters.map((K) => { const d = K.allocated - K.allocLY; return (<tr key={K.cluster}><td>{K.cluster}{K.region && <small>{K.region}</small>}</td><td className="num">{K.storesLY}</td>
            <td><input type="number" min={0} value={tyStores[K.cluster] ?? K.storesLY} onChange={(e) => { const v = num(e.target.value); const nx = { ...tyStores }; if (v === null || v < 0 || v === K.storesLY) delete nx[K.cluster]; else nx[K.cluster] = v; setTyStores(nx); }} /></td>
            <td className="num">{fmt(K.forecast)}</td>{a.countStoreStock && <td className="num">{fmt(K.inStore)}</td>}<td className="num"><b>{fmt(K.allocated)}</b><span className="bar" style={{ width: Math.round((K.allocated / maxA) * 40) }} /></td>
            <td className="num"><span className={"d " + (d >= 0 ? "up" : "dn")}>{(d >= 0 ? "+" : "−") + fmt(Math.abs(d))}</span></td>{a.spacePerStore ? <td className={"num" + (K.spaceBound ? " flag" : "")}>{pct(K.spaceUsed, 0)}</td> : null}
            <td><Cmp was={pct(K.fillLY, 0)} now={pct(K.fill, 0)} /></td><td className="num">{fmt(K.push)}</td><td className="num">{fmt(K.reserve)}</td><td className={"num" + (K.openingShort ? " flag" : "")}>{fmt(K.opening)}{K.openingShort ? " ▲" : ""}</td><td className="num">W{K.peakWeek + 1}<small>{wl(K.peakWeek)}</small></td></tr>); })}</tbody></table></div>
        {A.clusters.some((K) => K.openingShort) && <p className="hint" style={{ marginTop: 8 }}><span className="flag">▲</span> The initial push plus stock in stores is below expected demand for the first {N} weeks here.</p>}
      </section>

      <section className="card">
        <div className="card-h"><div><h2>Allocation by style and cluster</h2><p>Units to send, with the projected chance of selling out before the season ends. Darker red means higher stockout risk.{A.styles.length > MAX_ROWS ? ` Showing ${MAX_ROWS} styles; the plan download has all.` : ""}</p></div></div>
        <div className="scroll"><table className="heat"><thead><tr><th>Style</th>{A.clusters.map((K) => <th key={K.cluster}>{K.cluster}</th>)}<th>Total</th></tr></thead>
          <tbody>{styles.map((s) => (<tr key={s.style}><td>{s.style}</td>{A.clusters.map((K) => { const c = cellOf.get(s.style + "|" + K.cluster); if (!c) return <td key={K.cluster} className="h">–</td>;
            return <td key={K.cluster} className="h" style={{ background: shade(c.risk, 0.45, "--neg") }}>{fmt(c.alloc)}<small>{pct(c.risk, 0)} risk</small></td>; })}<td className="num">{fmt(s.allocated)}</td></tr>))}</tbody></table></div>
      </section>

      <section className="card">
        <div className="card-h"><div><h2>Weekly demand curve by cluster</h2><p>Share of each cluster's season demand in each week, after adding lost sales. The outlined cell is the peak.</p></div></div>
        <div className="scroll"><table className="heat"><thead><tr><th>Cluster</th>{Array.from({ length: D.T }, (_, w) => <th key={w}>W{w + 1}<br /><span style={{ fontWeight: 400 }}>{wl(w)}</span></th>)}</tr></thead>
          <tbody>{D.clusters.map((K) => { const mx = Math.max(0.0001, ...K.phase); return (<tr key={K.cluster}><td>{K.cluster}</td>{K.phase.map((v, w) => (<td key={w} className="h" style={{ background: shade(v / mx, 0.85), outline: w === K.peakWeek ? "2px solid var(--accent)" : undefined, outlineOffset: -2 }}>{(v * 100).toFixed(1)}</td>))}</tr>); })}</tbody></table></div>
      </section>

      <section className="card">
        <div className="card-h"><h2>Data check</h2></div>
        <ul className="notes">
          <li>{fmt(ds.diag.rows)} rows read and condensed to {fmt(ds.diag.facts)} weekly records ({fmt(ds.m)} stock snapshots). {fmt(D.stats.facts)} records fall in this season.</li>
          <li>Returns: {fmt(ds.diag.returnRows)} rows with negative NSQ ({fmt(ds.diag.returnedUnits)} units), netted out of demand.</li>
          {ds.diag.negSoh > 0 && <li>{fmt(ds.diag.negSoh)} rows had negative SOH (returns or adjustments); treated as 0 stock.</li>}
          {ds.diag.badDate > 0 && <li className="flag">{fmt(ds.diag.badDate)} rows had a date that could not be read. Check the date format setting.</li>}
          {ds.diag.badQty > 0 && <li className="flag">{fmt(ds.diag.badQty)} rows had no numeric NSQ.</li>}
          {ds.has.stock && !ds.has.upc && <li className="flag">No UPC column is mapped, so stock is checked at style level and size stockouts are missed.</li>}
          <li>{D.stats.stores} stores, {D.styles.length} styles, {D.cells.length} style–cluster combinations, {D.T} weeks. Lost sales added for {fmt(D.stats.lostStock)} store-{D.stats.bySize ? "sizes" : "styles"} from SOH and {fmt(D.stats.lostGap)} from sales gaps.</li>
        </ul>
      </section>
    </div>
  );
}
