import { useEffect, useRef, useState } from "react";
import type { TrendResult } from "../model/trends";
import { compact, fmt, pct, SPEED_VAR } from "./format";

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(700);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceTicks(max: number) {
  if (max <= 0) return [0, 1];
  const e = Math.pow(10, Math.floor(Math.log10(max / 4)));
  const st = [1, 2, 2.5, 5, 10].map((x) => x * e).find((s) => max / s <= 5) ?? e * 10;
  const t: number[] = []; for (let v = 0; v <= max + st * 0.001; v += st) t.push(v);
  if (t[t.length - 1] < max) t.push(t[t.length - 1] + st);
  return t;
}

export function TrendChart({ tr, money, pname }: { tr: TrendResult; money: boolean; pname: string }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<{ k: number; x: number; y: number } | null>(null);
  const H = 280, L = 56, R = 12, T = 12, B = 36, s = tr.series, n = s.length;
  const ticks = niceTicks(Math.max(1, ...s.map((p) => p.value), ...s.map((p) => p.ly ?? 0))), ymax = ticks[ticks.length - 1];
  const bw = (W - L - R) / n, y = (v: number) => T + (H - T - B) * (1 - v / ymax);
  const every = Math.ceil(n / Math.max(1, Math.floor((W - L - R) / 62)));
  let d = "", started = false;
  s.forEach((p, k) => { if (p.ly === null) { started = false; return; } d += (started ? "L" : "M") + (L + k * bw + bw / 2).toFixed(1) + "," + y(p.ly).toFixed(1); started = true; });
  const fv = (v: number) => (money ? "₹" + fmt(v) : fmt(v));
  const g = (c: number, p: number | null) => (p ? (c - p) / p : null);
  return (
    <div className="chartbox" ref={ref}>
      <svg width={W} height={H} role="img" aria-label="Trend chart">
        {ticks.map((t) => (<g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--grid)" /><text x={L - 6} y={y(t) + 4} textAnchor="end">{compact(t, money)}</text></g>))}
        {s.map((p, k) => {
          const x = L + k * bw + Math.max(1, bw * 0.14), w = Math.max(2, bw * 0.72), top = y(p.value), hh = H - B - top, r = Math.min(4, w / 2, Math.max(0, hh));
          return (<g key={p.id}>
            {hh > 0 && <path d={`M${x},${H - B}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${H - B}Z`} fill="var(--s1)" opacity={p.partial ? 0.45 : p.id === tr.review ? 1 : 0.78} />}
            {p.id === tr.review && <rect x={L + k * bw} y={T} width={bw} height={H - T - B} fill="none" stroke="var(--line)" strokeDasharray="3 3" />}
            {(k % every === 0 || p.id === tr.review) && <text x={L + k * bw + bw / 2} y={H - B + 16} textAnchor="middle" style={p.id === tr.review ? { fill: "var(--ink)", fontWeight: 500 } : undefined}>{p.label}</text>}
          </g>);
        })}
        {d && <path d={d} fill="none" stroke="var(--s2)" strokeWidth={2} strokeLinejoin="round" />}
        {s.map((p, k) => p.ly !== null && <circle key={"c" + k} cx={L + k * bw + bw / 2} cy={y(p.ly)} r={3.5} fill="var(--s2)" stroke="var(--panel)" strokeWidth={2} />)}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--muted)" strokeOpacity={0.5} />
        {s.map((_, k) => (<rect key={"h" + k} x={L + k * bw} y={T} width={bw} height={H - T - B} fill="transparent"
          onMouseMove={(e) => { const bb = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setHover({ k, x: e.clientX - bb.left, y: e.clientY - bb.top }); }}
          onMouseLeave={() => setHover(null)} />))}
      </svg>
      {hover && (() => { const p = s[hover.k], prev = hover.k > 0 ? s[hover.k - 1].value : null; const x = hover.x + 200 > W ? hover.x - 210 : hover.x + 14;
        return (<div className="tip" style={{ left: Math.max(0, x), top: hover.y - 10 }}>
          <b>{p.label}{p.partial ? " (partial)" : ""}</b>
          <div><span>This {pname}</span><span className="num">{fv(p.value)}</span></div>
          <div><span>Last year</span><span className="num">{p.ly === null ? "–" : fv(p.ly)}</span></div>
          <div><span>vs last year</span><span className="num">{pct(g(p.value, p.ly))}</span></div>
          <div><span>vs previous</span><span className="num">{pct(g(p.value, prev))}</span></div>
        </div>); })()}
    </div>
  );
}

export function PaceChart({ series, weekLabel }: { series: { speed: string; cum: number[] }[]; weekLabel: (t: number) => string }) {
  const [ref, W] = useWidth();
  const [hov, setHov] = useState<{ t: number; x: number; y: number } | null>(null);
  const T = series[0]?.cum.length ?? 1, H = 260, L = 44, R = 110, Tp = 12, B = 32;
  const x = (t: number) => L + (W - L - R) * (T > 1 ? t / (T - 1) : 0), y = (v: number) => Tp + (H - Tp - B) * (1 - v);
  const every = Math.max(1, Math.ceil(T / Math.max(1, Math.floor((W - L - R) / 70))));
  return (
    <div className="chartbox" ref={ref}>
      <svg width={W} height={H} role="img" aria-label="Sell-through pace chart">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (<g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--grid)" /><text x={L - 6} y={y(t) + 4} textAnchor="end">{t * 100}%</text></g>))}
        {Array.from({ length: Math.ceil(T / every) }, (_, i) => i * every).map((t) => <text key={t} x={x(t)} y={H - B + 16} textAnchor="middle">{weekLabel(t)}</text>)}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--muted)" strokeOpacity={0.5} />
        {series.map((se) => { const t50 = se.cum.findIndex((v) => v >= 0.5);
          return (<g key={se.speed}>
            <path d={se.cum.map((v, t) => (t ? "L" : "M") + x(t).toFixed(1) + "," + y(v).toFixed(1)).join("")} fill="none" stroke={`var(${SPEED_VAR[se.speed]})`} strokeWidth={2} />
            {t50 >= 0 && <circle cx={x(t50)} cy={y(se.cum[t50])} r={4} fill={`var(${SPEED_VAR[se.speed]})`} stroke="var(--panel)" strokeWidth={2} />}
          </g>); })}
        <text x={W - R + 10} y={y(0.5) - 30}>50% sold by</text>
        {series.map((se, i) => (<g key={"l" + se.speed}><circle cx={W - R + 14} cy={y(0.5) - 18 + i * 16} r={3.5} fill={`var(${SPEED_VAR[se.speed]})`} />
          <text x={W - R + 22} y={y(0.5) - 14 + i * 16} style={{ fill: "var(--ink)" }}>{se.speed} W{se.cum.findIndex((v) => v >= 0.5) + 1}</text></g>))}
        {hov && <line x1={x(hov.t)} x2={x(hov.t)} y1={Tp} y2={H - B} stroke="var(--muted)" strokeDasharray="3 3" />}
        <rect x={L} y={Tp} width={W - L - R} height={H - Tp - B} fill="transparent"
          onMouseMove={(e) => { const bb = e.currentTarget.getBoundingClientRect(), ob = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
            setHov({ t: Math.max(0, Math.min(T - 1, Math.round(((e.clientX - bb.left) / bb.width) * (T - 1)))), x: e.clientX - ob.left, y: e.clientY - ob.top }); }}
          onMouseLeave={() => setHov(null)} />
      </svg>
      {hov && (<div className="tip" style={{ left: Math.max(0, hov.x + 200 > W ? hov.x - 210 : hov.x + 14), top: hov.y - 10 }}>
        <b>W{hov.t + 1} · {weekLabel(hov.t)}</b>
        {series.map((se) => (<div key={se.speed}><span className="vc"><i style={{ background: `var(${SPEED_VAR[se.speed]})` }} />{se.speed}</span><span className="num">{pct(se.cum[hov.t], 0)}</span></div>))}
      </div>)}
    </div>
  );
}
