import { useState } from "react";
import { dayLabel } from "../data/types";
import type { Demand } from "../model/demand";
import { fmt } from "./format";

export function MethodTab({ D }: { D: Demand | null }) {
  const [pick, setPick] = useState(0);
  const s = D?.settings;
  const a = D?.audit[Math.min(pick, (D?.audit.length ?? 1) - 1)];
  const mx = a ? Math.max(1, ...Array.from(a.sold), ...Array.from(a.lost)) : 1;
  return (
    <div className="pane">
      <section className="card method">
        <h2>How the numbers are worked out</h2>
        <p>The model runs in eight steps. Settings named in bold can be changed in the left panel or on the Allocation tab. Thresholds are adjustable starting points, not industry constants.</p>
        <h3>1. Read and condense the data</h3>
        <p>The file is read in a background worker. Each row is added straight into weekly totals per store × UPC × channel × discount band, with weeks split at month ends so months and quarters stay exact. NSQ is net of returns (negative rows); SOH is closing stock, with negative SOH treated as 0. If SOH is not mapped, SOH = AVAL − NSQ.</p>
        <h3>2. Seasonality: cluster weekly index</h3>
        <div className="formula">{"index[week] = cluster units that week ÷ average weekly cluster units over the season"}</div>
        <h3>3. True demand: lost sales in stockout weeks</h3>
        <p>Worked out for each store × size. A week that <b>closes with SOH ≤ 0</b> is a stockout: customers who came after the shelf emptied are missing from NSQ. Demand is fully seen only in weeks that closed with stock left.</p>
        <div className="formula">{`rate        = units sold in weeks that closed with stock ÷ sum of index over those weeks
lost        = max(0, rate × index − units sold), in each stockout week
cap         = total lost ≤ ${Math.round((s?.maxUplift ?? 1) * 100)}% of that store-size's units sold
true demand = net sales + lost`}</div>
        <p>Without stock data, stockouts are inferred from runs of at least <b>{s?.minGap ?? 2}</b> zero-sale weeks where at least <b>{s?.minExpected ?? 4}</b> units were expected (the chance of selling nothing when 4 are expected is about 2%).</p>
        <h3>4. SKU analysis</h3>
        <div className="formula">{`rate of sale  = true demand ÷ stores ÷ weeks between first and last sale
speed class   = top 30% by rate of sale → Fast, bottom 30% → Slow, rest → Medium
sell-through  = NSQ ÷ (NSQ + closing SOH)
in-stock %    = store-size weeks closing with stock ÷ weeks ranged
return rate   = returned units ÷ gross units sold`}</div>
        <h3>5. Forecast by style and cluster</h3>
        <div className="formula">{`forecast μ     = true demand × (stores this season ÷ stores last season) × (1 + growth)
uncertainty σ  = √(μ + (CV × μ)²)        CV = ${Math.round((s?.cv ?? 0.3) * 100)}%
P(demand ≥ k)  = 1 − Φ((k − 0.5 − μ) ÷ σ)`}</div>
        <h3>6. Optimise the allocation under constraints</h3>
        <div className="formula">{`maximise   Σ E[min(demand, stock in store + Q)]
subject to Σ over clusters Q ≤ supply of the style    (or one shared pool)
           Σ over styles  (Q + stock in store) ≤ stores × space per store
           no unit is shipped if its chance of selling is below the threshold`}</div>
        <p>Stock goes out in small blocks, each to the style-cluster where the next unit has the highest chance of selling, multiplied by price when prioritising by value and by the fast-mover priority. Each extra unit adds less than the one before, so with supply limits alone this order is optimal; with a space limit it is a close heuristic.</p>
        <h3>7. Compare with last year's split</h3>
        <div className="formula">{`expected sales = μ − σ · L(z),  z = (available − μ) ÷ σ,  L(z) = φ(z) − z(1 − Φ(z))
fill rate      = expected sales ÷ μ
stockout risk  = P(demand > available)`}</div>
        <p>The baseline splits the same supply by last year's units sold. Both plans are scored against the model's own forecast, so this is a projection. To validate it, run an earlier season and compare the plan with what actually sold in the next one.</p>
        <h3>8. Recommendations and store push</h3>
        <div className="formula">{`initial push   = allocation × push %;   DC reserve = allocation − push
opening demand = forecast × share of the style-cluster's season demand in weeks 1–N`}</div>
      </section>
      <section className="card">
        <div className="card-h"><div><h2>Check the lost-sales estimate</h2><p>Pick a store and size to see, week by week, where the model found a stockout and how many units it added. Listed by units added, largest first.</p></div></div>
        {!D || !D.audit.length || !a ? <p className="hint">No lost sales were estimated with the current settings.</p> : (<>
          <label className="f" style={{ maxWidth: 480 }}>Store · size<select value={pick} onChange={(e) => setPick(+e.target.value)}>{D.audit.map((x, i) => <option key={i} value={i}>{x.key} — {x.cluster} — +{fmt(x.added)} units ({x.method})</option>)}</select></label>
          <p className="hint" style={{ margin: "10px 0" }}>Rate of sale <b className="num">{a.rate.toFixed(2)}</b> units per index point · units sold <b className="num">{fmt(Array.from(a.sold).reduce((x, y) => x + Math.max(0, y), 0))}</b> · lost sales added <b className="num">{fmt(a.added)}</b>{a.capped ? " (capped)" : ""}</p>
          <div className="scroll"><table><thead><tr><th>Week</th><th>Week of</th><th>Cluster index</th><th>Expected</th><th>Units sold</th><th>Closing SOH</th><th>Lost added</th><th className="l">Sold + lost</th></tr></thead>
            <tbody>{Array.from({ length: D.T }, (_, t) => (<tr key={t} style={a.flag[t] ? { background: "var(--warn-bg)" } : undefined}>
              <td>W{t + 1}{a.flag[t] ? <small className="flag">stockout</small> : null}</td><td>{dayLabel(D.start + 7 * t)}</td><td className="num">{a.index[t].toFixed(2)}</td><td className="num">{(a.rate * a.index[t]).toFixed(1)}</td>
              <td className="num">{fmt(a.sold[t])}</td><td className="num">{a.soh && !Number.isNaN(a.soh[t]) ? fmt(a.soh[t]) : "–"}</td><td className="num">{a.lost[t] ? a.lost[t].toFixed(1) : ""}</td>
              <td className="l"><span style={{ display: "inline-block", height: 9, borderRadius: 2, background: "var(--s1)", width: (Math.max(0, a.sold[t]) / mx) * 90 }} /><span style={{ display: "inline-block", height: 9, borderRadius: 2, background: "var(--s2)", marginLeft: 2, width: (a.lost[t] / mx) * 90 }} /></td></tr>))}</tbody></table></div>
          <div className="legend" style={{ marginTop: 8 }}><span><i style={{ background: "var(--s1)" }} />Units sold</span><span><i style={{ background: "var(--s2)" }} />Lost sales added</span></div>
        </>)}
      </section>
    </div>
  );
}
