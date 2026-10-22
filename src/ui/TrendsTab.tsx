import { useState } from "react";
import { engine, useEngine } from "../engine/client";
import type { Meta } from "../engine/protocol";
import type { Filters } from "../model/filters";
import type { Dim, Measure, Mode, TrendResult } from "../model/trends";
import { TrendChart } from "./Charts";
import { compact, Delta, downloadCsv, fmt, pct, shade, Spark, Tile } from "./format";

const DIMS: [Dim, string][] = [["cluster", "Cluster"], ["region", "Region"], ["seg", "Fabric group"], ["lfl", "LFL / NLFL"], ["style", "Style"]];

export function TrendsTab({ meta, filters }: { meta: Meta; filters: Filters }) {
  const [measure, setMeasure] = useState<Measure>("qty");
  const [mode, setMode] = useState<Mode>("Q");
  const [fy, setFy] = useState(true);
  const [dim, setDim] = useState<Dim>("cluster");
  const [review, setReview] = useState<number | undefined>(undefined);
  const [lfl, setLfl] = useState(false);
  const mk: Measure = meta.has.value ? measure : "qty";
  const q = { filters, mode, fy, measure: mk, dim, lflOnly: lfl, review };
  const key = JSON.stringify([meta.fileName, meta.ms, q]);
  const res = useEngine<TrendResult>(key, () => engine.send<"trends">({ type: "trends", q }).then((r) => r.result));
  if (res.error && !res.data) return <div className="msg err">{res.error}</div>;
  if (!res.data) return <div className="msg">Calculating trends…</div>;
  const tr = res.data;
  const pname = mode === "M" ? "month" : "quarter", money = mk === "val";
  const dimName = DIMS.find((d) => d[0] === dim)![1];
  const fv = (v: number) => (money ? compact(v, true) : fmt(v));
  const rows = tr.rows.slice(0, 40);
  const mv = tr.hasLY ? [...tr.rows].sort((a, b) => (b.chgLY ?? 0) - (a.chgLY ?? 0)).slice(0, 12) : [];
  const mvMax = Math.max(1, ...mv.map((x) => Math.abs(x.chgLY ?? 0)));
  const gcell = (g: number | null, pp?: boolean) => g === null ? <td className="num" style={{ textAlign: "center" }}>–</td>
    : <td className="num" style={{ background: shade(Math.min(1, Math.abs(g) / (pp ? 0.05 : 0.4)), 0.45, g >= 0 ? "--pos" : "--neg") }}>{(g >= 0 ? "+" : "") + (g * 100).toFixed(1) + (pp ? " pp" : "%")}</td>;
  return (
    <div className="pane">
      <div className="toolbar">
        <label className="f">Measure<select value={mk} onChange={(e) => setMeasure(e.target.value as Measure)}><option value="qty">Units (NSQ)</option><option value="val" disabled={!meta.has.value}>Value (NSV)</option></select></label>
        <label className="f">Period<select value={mode} onChange={(e) => { setMode(e.target.value as Mode); setReview(undefined); }}><option value="Q">Quarter</option><option value="M">Month</option></select></label>
        <label className="f">Quarters<select value={fy ? "fy" : "cy"} disabled={mode === "M"} onChange={(e) => { setFy(e.target.value === "fy"); setReview(undefined); }}><option value="fy">Financial year (Apr–Mar)</option><option value="cy">Calendar year</option></select></label>
        <label className="f">Break down by<select value={dim} onChange={(e) => setDim(e.target.value as Dim)}>{DIMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="f">Period to review<select value={tr.review} onChange={(e) => setReview(+e.target.value)}>{tr.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
        <label className="toggle"><input type="checkbox" checked={lfl} onChange={(e) => setLfl(e.target.checked)} /><span>Like-for-like stores only</span></label>
      </div>
      <div className="tiles">
        {tr.kpis.map((k) => (
          <Tile key={k.kpi} k={`${k.label} · ${tr.label}`}
            v={k.value === null ? "–" : k.pct ? pct(k.value) : k.kpi === "qty" ? fmt(k.value) : k.kpi === "asp" ? "₹" + fmt(k.value) : compact(k.value, true)}
            n={<><span>vs prev {pname} <Delta g={k.vsPrev} pp={k.pct} /></span><span>vs last year <Delta g={k.vsLY} pp={k.pct} /></span></>} />
        ))}
      </div>
      {tr.partial && <p className="hint flag">{tr.label} is only partly covered by the data, so its growth figures understate the full period.</p>}
      {!tr.hasLY && <p className="hint">No sales a year before {tr.label} in this file, so year-on-year comparisons are blank. Upload at least two years of data to see them.</p>}
      <section className="card">
        <div className="card-h"><div><h2>{money ? "Sales value" : "Units sold (net of returns)"} by {pname}</h2><p>Bars show each {pname}. The line shows the same {pname} one year earlier. Hover a {pname} for the numbers.</p></div>
          <div className="legend"><span><i style={{ background: "var(--s1)" }} />This {pname}</span><span><i className="line" style={{ background: "var(--s2)" }} />Same {pname} last year</span></div></div>
        <TrendChart tr={tr} money={money} pname={pname} />
      </section>
      <div className="two">
        <section className="card">
          <div className="card-h"><div><h2>{dimName} trend</h2><p>Last 6 {pname}s, then growth for {tr.label}. Share change is in percentage points.{tr.rows.length > 40 ? ` Showing the top 40 of ${tr.rows.length}; the download has all.` : ""}</p></div>
            <button type="button" onClick={() => downloadCsv(`trend_${dim}.csv`, [[dimName, ...tr.histIds.map((_, i) => tr.series.find((s) => s.id === tr.histIds[i])!.label), "vs prev %", "vs last year %", "share %", "share change pp"],
              ...tr.rows.map((r) => [r.key, ...r.hist.map(Math.round), r.vsPrev === null ? "" : (r.vsPrev * 100).toFixed(1), r.vsLY === null ? "" : (r.vsLY * 100).toFixed(1), (r.share * 100).toFixed(1), r.shareChg === null ? "" : (r.shareChg * 100).toFixed(2)])])}>Download CSV</button></div>
          <div className="scroll"><table><thead><tr><th>{dimName}</th><th className="l">Last 12 {pname}s</th>{tr.histIds.map((i) => <th key={i}>{tr.series.find((s) => s.id === i)!.label}</th>)}<th>vs prev {pname}</th><th>vs last year</th><th>Share</th><th>Share change<br />vs last year</th></tr></thead>
            <tbody>{rows.map((r) => (<tr key={r.key}><td>{r.key}</td><td className="l"><Spark values={r.spark} /></td>{r.hist.map((v, i) => <td key={i} className="num">{fv(v)}</td>)}{gcell(r.vsPrev)}{gcell(r.vsLY)}<td className="num">{pct(r.share)}</td>{gcell(r.shareChg, true)}</tr>))}</tbody></table></div>
        </section>
        <section className="card">
          <div className="card-h"><div><h2>Biggest movers vs last year</h2><p>Change in {money ? "sales value" : "units"} for {tr.label} against the same {pname} last year.</p></div></div>
          {!mv.length ? <p className="hint">Needs data from a year earlier.</p> : (
            <div className="movers">{mv.map((x) => { const d = x.chgLY ?? 0; return (<FragmentRow key={x.key} name={x.key} d={d} w={(Math.abs(d) / mvMax) * 50} g={x.vsLY} fv={fv} />); })}</div>)}
        </section>
      </div>
    </div>
  );
}

function FragmentRow({ name, d, w, g, fv }: { name: string; d: number; w: number; g: number | null; fv: (v: number) => string }) {
  return (<>
    <span>{name}</span>
    <span className="track"><span className="mb" style={{ background: `var(${d >= 0 ? "--pos" : "--neg"})`, [d >= 0 ? "left" : "right"]: "50%", width: w.toFixed(1) + "%" }} /></span>
    <span className="num" style={{ textAlign: "right" }}>{(d >= 0 ? "+" : "−") + fv(Math.abs(d))} {g !== null && <span className={"d " + (g >= 0 ? "up" : "dn")}>{(g >= 0 ? "+" : "") + (g * 100).toFixed(0)}%</span>}</span>
  </>);
}
