import type { ReactNode } from "react";

export const fmt = (n: number | null | undefined) => (n === null || n === undefined || !isFinite(n) ? "–" : Math.round(n).toLocaleString("en-IN"));
export const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined || !isFinite(n) ? "–" : (n * 100).toFixed(d) + "%");
export function compact(n: number, money = false) {
  const a = Math.abs(n), p = money ? "₹" : "";
  if (a >= 1e7) return p + (n / 1e7).toFixed(a >= 1e8 ? 0 : 1) + " Cr";
  if (a >= 1e5) return p + (n / 1e5).toFixed(a >= 1e6 ? 0 : 1) + " L";
  if (a >= 1e3) return p + (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "K";
  return p + Math.round(n);
}
export function Delta({ g, pp }: { g: number | null | undefined; pp?: boolean }) {
  if (g === null || g === undefined || !isFinite(g)) return <span className="d na">–</span>;
  const up = g >= 0;
  return <span className={"d " + (up ? "up" : "dn")}>{(up ? "▲ +" : "▼ ") + (g * 100).toFixed(1) + (pp ? " pp" : "%")}</span>;
}
export const Tile = ({ k, v, n }: { k: string; v: ReactNode; n?: ReactNode }) => (
  <div className="tile"><div className="k">{k}</div><div className="v">{v}</div>{n !== undefined && <div className="n">{n}</div>}</div>
);
export const Cmp = ({ was, now }: { was: string; now: string }) => (<span className="cmp"><span className="was">{was}</span> → <b>{now}</b></span>);
export const SPEED_VAR: Record<string, string> = { Fast: "--s1", Medium: "--s2", Slow: "--s3" };
export const SpeedChip = ({ s }: { s: string }) => (<span className="vc"><i style={{ background: `var(${SPEED_VAR[s]})` }} />{s}</span>);
export const shade = (x: number, max: number, v = "--accent") => `color-mix(in srgb, var(${v}) ${Math.round(Math.min(1, Math.max(0, x)) * max * 100)}%, transparent)`;

/** Download rows as a CSV file. */
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function Spark({ values, color = "--s1" }: { values: ArrayLike<number>; color?: string }) {
  const n = values.length, mx = Math.max(1, ...Array.from(values));
  const pts = Array.from(values, (v, i) => `${((i * 84) / Math.max(1, n - 1)).toFixed(1)},${(22 - (v / mx) * 20).toFixed(1)}`).join(" ");
  return <svg width="88" height="24" viewBox="-2 0 88 24" aria-hidden="true"><polyline points={pts} fill="none" stroke={`var(${color})`} strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}
