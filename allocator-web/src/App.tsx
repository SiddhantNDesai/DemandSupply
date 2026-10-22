import { useCallback, useEffect, useRef, useState } from "react";
import { missingRequired, ROLES, type Mapping } from "./data/columns";
import { EXAMPLE_GROUPS } from "./data/example";
import { dayOf, isoDay } from "./data/types";
import { engine, useEngine } from "./engine/client";
import type { Meta, Source } from "./engine/protocol";
import { defaultAllocSettings, type AllocSettings, type Allocation } from "./model/allocate";
import { defaultDemandSettings, type Demand, type DemandSettings } from "./model/demand";
import { defaultChannels, type Filters } from "./model/filters";
import { AllocTab } from "./ui/AllocTab";
import { fmt } from "./ui/format";
import { MethodTab } from "./ui/MethodTab";
import { SkuTab } from "./ui/SkuTab";
import { TrendsTab } from "./ui/TrendsTab";

type Tab = "trends" | "sku" | "allocation" | "method";
const TABS: [Tab, string][] = [["trends", "Trends"], ["sku", "SKU demand"], ["allocation", "Allocation"], ["method", "How it's calculated"]];
const DISC_OPTS = [100, 50, 40, 30, 20, 10, 0];
const parseIso = (s: string) => { const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? dayOf(+m[1], +m[2], +m[3]) : null; };
const seasonOf = (m: Meta): [number, number] => [m.maxDay - m.minDay > 371 ? m.maxDay - 363 : m.minDay, m.maxDay];

/** Debounce typing so the engine is asked once the user pauses. */
function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [sheet, setSheet] = useState<string | undefined>(undefined);
  const [dayfirst, setDayfirst] = useState(true);
  const [loading, setLoading] = useState<{ stage: string; pct: number; rows: number } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const [tab, setTab] = useState<Tab>(() => { const h = location.hash.slice(1) as Tab; return TABS.some((t) => t[0] === h) ? h : "trends"; });
  const [filters, setFilters] = useState<Filters>({ channels: null, lfl: null, fabrics: null, styleQ: "", groups: EXAMPLE_GROUPS });
  const [demandS, setDemandS] = useState<DemandSettings>(defaultDemandSettings);
  const [allocS, setAllocS] = useState<AllocSettings>(defaultAllocSettings);

  const load = useCallback((source: Source, fresh: boolean) => {
    const n = ++loadSeq.current;
    setLoadErr(null);
    setLoading({ stage: "Starting", pct: 0, rows: 0 });
    engine.send<"load">({ type: "load", source }, (p) => { if (n === loadSeq.current) setLoading({ stage: p.stage, pct: p.pct, rows: p.rows }); })
      .then((r) => {
        if (n !== loadSeq.current) return;
        setMeta(r.meta); setMapping(r.meta.mapping as Mapping); setSheet(r.meta.sheet);
        if (fresh) {
          setFilters({ channels: null, lfl: null, fabrics: null, styleQ: "", groups: source.kind === "example" ? EXAMPLE_GROUPS : {} });
          setDemandS(defaultDemandSettings); setAllocS((a) => ({ ...a, supplyByStyle: {} }));
        }
        setLoading(null);
      })
      .catch((e: Error) => { if (n === loadSeq.current) { setLoadErr(e.message); setLoading(null); } });
  }, []);
  useEffect(() => { load({ kind: "example" }, true); }, [load]);
  useEffect(() => { try { history.replaceState(null, "", "#" + tab); } catch { /* sandboxed preview */ } }, [tab]);

  const onFile = (f: File | null) => { if (!f) return; setFile(f); load({ kind: "file", file: f, dayfirst }, true); };
  const reread = (patch: { mapping?: Mapping; sheet?: string; dayfirst?: boolean }) => {
    if (!file) return;
    const newSheet = patch.sheet !== undefined;
    load({ kind: "file", file, dayfirst: patch.dayfirst ?? dayfirst, sheet: patch.sheet ?? sheet,
      mapping: newSheet ? undefined : ((patch.mapping ?? mapping) as Record<string, string>) }, newSheet);
  };

  // plan = demand + allocation, computed in the engine whenever settings change
  const fDeb = useDebounced(filters), dDeb = useDebounced(demandS), aDeb = useDebounced(allocS);
  const planKey = meta && tab !== "trends" ? JSON.stringify([meta.fileName, meta.ms, fDeb, dDeb, aDeb]) : null;
  const plan = useEngine<{ D: Demand; A: Allocation; ms: number }>(planKey, () =>
    engine.send<"plan">({ type: "plan", q: { filters: fDeb, demand: dDeb, alloc: aDeb } }).then((r) => ({ D: r.D, A: r.A, ms: r.ms })));
  const setS = <K extends keyof DemandSettings>(k: K, v: DemandSettings[K]) => setDemandS((p) => ({ ...p, [k]: v }));

  const season = meta ? seasonOf(meta) : [0, 0];
  const chanSel = meta ? filters.channels ?? (meta.has.channel ? defaultChannels(meta.channels) : meta.channels) : [];
  const toggleIn = (list: string[], v: string, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));
  const miss = missingRequired(mapping);
  const D = plan.data?.D ?? null, A = plan.data?.A ?? null;

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Seasonal Cluster Allocator</h1>
          <p className="sub">Upload store sales (NSQ, SOH) to see trends, estimate true demand including sales lost to stockouts, and allocate limited seasonal stock across store clusters. Files are processed in your browser and never uploaded.</p>
        </div>
        <span className={"chip" + (meta?.fileName === "Example data" ? " warn" : "")}>{meta ? meta.fileName : "Loading…"}</span>
      </header>
      <div className="grid">
        <aside>
          <details className="sec" open>
            <summary>Data</summary>
            <div className="body">
              <label className="f">Sales file (.xlsx, .xls or .csv)<input type="file" accept=".xlsx,.xls,.xlsb,.csv,.txt" onChange={(e) => onFile(e.target.files?.[0] ?? null)} /></label>
              {meta && meta.sheets.length > 1 && <label className="f">Sheet<select value={sheet ?? meta.sheets[0]} onChange={(e) => { setSheet(e.target.value); reread({ sheet: e.target.value }); }}>{meta.sheets.map((s) => <option key={s}>{s}</option>)}</select></label>}
              <label className="f">Text dates are<select value={dayfirst ? "dmy" : "mdy"} onChange={(e) => { const v = e.target.value === "dmy"; setDayfirst(v); reread({ dayfirst: v }); }}><option value="dmy">DD/MM/YYYY</option><option value="mdy">MM/DD/YYYY</option></select></label>
              <button type="button" onClick={() => { setFile(null); load({ kind: "example" }, true); }}>Load example data</button>
              {loading && (<><div className="progress"><i style={{ width: loading.pct + "%" }} /></div><p className="hint">{loading.stage}… {loading.rows ? fmt(loading.rows) + " rows" : ""}</p></>)}
              {loadErr && <p className="hint flag">{loadErr}</p>}
              {meta && !loading && <p className="hint">{fmt(meta.diag.rows)} rows condensed to {fmt(meta.diag.facts)} weekly records in {(meta.ms / 1000).toFixed(1)} s.</p>}
              <p className="hint">Large files are read in the background and condensed as they stream in. CSV uses far less memory than Excel, so save very large sheets (over ~50 MB) as CSV first.</p>
            </div>
          </details>
          <details className="sec">
            <summary>Columns</summary>
            <div className="body">
              <p className="hint">NSQ = net sale qty (negative = returns). SOH = stock on hand. AVAL = NSQ + SOH, used only if SOH is not mapped. Changing a column re-reads the file.</p>
              {ROLES.map((r) => (
                <label key={r.key} className="f">{r.label}{r.req ? " *" : ""}
                  <select value={mapping[r.key] ?? ""} disabled={!file} onChange={(e) => { const m = { ...mapping, [r.key]: e.target.value || undefined }; setMapping(m); if (!missingRequired(m).length) reread({ mapping: m }); }}>
                    <option value="">— none —</option>{(meta?.headers ?? []).map((h) => <option key={h} value={h}>{h}</option>)}
                  </select></label>))}
              {miss.length > 0 && <p className="hint flag">Choose a column for: {miss.join(", ")}</p>}
            </div>
          </details>
          {meta && (<details className="sec" open>
            <summary>Filters</summary>
            <div className="body">
              {meta.has.channel && <><label className="f">Channel</label><div className="checks">{meta.channels.map((c) => <label key={c}><input type="checkbox" checked={chanSel.includes(c)} onChange={(e) => setFilters((p) => ({ ...p, channels: toggleIn(chanSel, c, e.target.checked) }))} />{c || "(blank)"}</label>)}</div></>}
              {meta.has.lfl && <><label className="f">Store type</label><div className="checks">{meta.lfl.map((v) => { const sel = filters.lfl ?? meta.lfl; return <label key={v}><input type="checkbox" checked={sel.includes(v)} onChange={(e) => setFilters((p) => ({ ...p, lfl: toggleIn(sel, v, e.target.checked) }))} />{v || "(blank)"}</label>; })}</div></>}
              {meta.has.fabric && <><label className="f">Fabric types</label><div className="checks">{meta.fabrics.map((v) => { const sel = filters.fabrics ?? meta.fabrics; return <label key={v}><input type="checkbox" checked={sel.includes(v)} onChange={(e) => setFilters((p) => ({ ...p, fabrics: toggleIn(sel, v, e.target.checked) }))} />{v || "(blank)"}</label>; })}</div></>}
              <label className="f">Style contains<input type="text" value={filters.styleQ} placeholder="e.g. TS-T1" onChange={(e) => setFilters((p) => ({ ...p, styleQ: e.target.value }))} /></label>
            </div>
          </details>)}
          {meta && (<details className="sec" open>
            <summary>Season &amp; demand settings</summary>
            <div className="body">
              <div className="row2">
                <label className="f">Season from<input type="date" value={isoDay(demandS.from ?? season[0])} onChange={(e) => setS("from", parseIso(e.target.value))} /></label>
                <label className="f">Season to<input type="date" value={isoDay(demandS.to ?? season[1])} onChange={(e) => setS("to", parseIso(e.target.value))} /></label>
              </div>
              <label className="f">Keep sales with discount up to<select value={demandS.maxDisc} onChange={(e) => setS("maxDisc", +e.target.value)}>{DISC_OPTS.map((d) => <option key={d} value={d}>{d === 100 ? "Any discount" : d + "%"}</option>)}</select></label>
              <label className="toggle"><input type="checkbox" checked={demandS.impute} onChange={(e) => setS("impute", e.target.checked)} /><span>Add estimated lost sales</span></label>
              <label className="toggle"><input type="checkbox" checked={demandS.useStock && meta.has.stock} disabled={!meta.has.stock} onChange={(e) => setS("useStock", e.target.checked)} /><span>Find stockouts from SOH{meta.has.stock ? "" : " (no stock column)"}</span></label>
              {!(demandS.useStock && meta.has.stock) && <div className="row2">
                <label className="f">Min. gap (weeks)<input type="number" min={1} max={20} value={demandS.minGap} onChange={(e) => setS("minGap", +e.target.value || 2)} /></label>
                <label className="f">Min. expected units<input type="number" min={0} step={0.5} value={demandS.minExpected} onChange={(e) => setS("minExpected", +e.target.value)} /></label></div>}
              <div className="row2">
                <label className="f">Max. uplift (%)<input type="number" min={0} max={500} step={10} value={Math.round(demandS.maxUplift * 100)} onChange={(e) => setS("maxUplift", (+e.target.value || 0) / 100)} /></label>
                <label className="f">Growth (%)<input type="number" step={1} value={Math.round(demandS.growth * 100)} onChange={(e) => setS("growth", (+e.target.value || 0) / 100)} /></label>
              </div>
              <label className="f">Forecast error (CV %)<input type="number" min={0} max={200} step={5} value={Math.round(demandS.cv * 100)} onChange={(e) => setS("cv", (+e.target.value || 0) / 100)} /></label>
              <p className="hint">How far actual demand typically lands from forecast. Higher values make the optimiser more cautious about thin allocations.</p>
            </div>
          </details>)}
          {meta?.has.fabric && (<details className="sec">
            <summary>Fabric groups</summary>
            <div className="body">
              <p className="hint">Type the same name for values to merge, e.g. Light for LIGHT and ECOVERO VISCOSE.</p>
              <div className="grp">{meta.fabrics.map((v) => (<FabricRow key={v} v={v} value={filters.groups[v] ?? v} onChange={(g) => setFilters((p) => ({ ...p, groups: { ...p.groups, [v]: g || v } }))} />))}</div>
            </div>
          </details>)}
        </aside>
        <main>
          <nav className="tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</nav>
          {tab !== "trends" && plan.busy && D && <p className="hint">Recalculating…</p>}
          {!meta ? <div className="msg">{loadErr ?? "Loading example data…"}</div>
            : tab === "trends" ? <TrendsTab meta={meta} filters={fDeb} />
            : plan.error && !D ? <div className="msg err">{plan.error}</div>
            : !D || !A ? <div className="msg">Calculating demand and allocation…</div>
            : tab === "sku" ? <SkuTab D={D} />
            : tab === "allocation" ? <AllocTab meta={meta} D={D} A={A} a={allocS} setA={setAllocS} tyStores={demandS.tyStores} setTyStores={(v) => setS("tyStores", v)} />
            : <MethodTab D={D} />}
          {plan.error && D && tab !== "trends" && <p className="hint flag">{plan.error}</p>}
        </main>
      </div>
    </div>
  );
}

function FabricRow({ v, value, onChange }: { v: string; value: string; onChange: (g: string) => void }) {
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  return (<><code>{v || "(blank)"}</code><input type="text" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => onChange(txt.trim())} onKeyDown={(e) => { if (e.key === "Enter") onChange(txt.trim()); }} /></>);
}
