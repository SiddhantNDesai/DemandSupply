// Streaming aggregator: feed it raw rows (arrays of cell values) one at a time; it keeps only the compact
// weekly facts, so memory does not grow with the number of rows in the file.
import type { Mapping, Role } from "./columns";
import { bandOf, bucketOf, dayOf, mondayOf, type Dataset, type StoreDim, type StyleDim, type UpcDim } from "./types";

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const str = String(v), fast = +str;            // fast path for plain numbers
  if (str.trim() !== "" && isFinite(fast)) return fast;
  const n = parseFloat(str.replace(/[,%₹\s]/g, ""));
  return isFinite(n) ? n : null;
}

export function makeDayParser(dayfirst: boolean) {
  const cache = new Map<string, number | null>();
  const parseStr = (s: string): number | null => {
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return dayOf(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
      let y = +m[3]; if (y < 100) y += 2000;
      let d = +m[1], mo = +m[2];
      if (!dayfirst) [d, mo] = [mo, d];
      if (mo > 12 && d <= 12) [d, mo] = [mo, d];
      return dayOf(y, mo, d);
    }
    if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]+(\d{2,4})/))) {
      let y = +m[3]; if (y < 100) y += 2000;
      const mo = MONTHS[m[2].toLowerCase()];
      if (mo) return dayOf(y, mo, +m[1]);
    }
    if (/^\d+(\.\d+)?$/.test(s)) return fromNumber(parseFloat(s));
    const t = Date.parse(s);
    if (!isNaN(t)) { const d = new Date(t); return dayOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
    return null;
  };
  const fromNumber = (n: number) => (n > 20000 && n < 80000 ? Math.floor(n) - 25569 : null); // Excel serial
  return (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return fromNumber(v);
    if (v instanceof Date) return dayOf(v.getFullYear(), v.getMonth() + 1, v.getDate());
    const s = String(v).trim();
    let r = cache.get(s);
    if (r === undefined) { r = parseStr(s); if (cache.size < 20000) cache.set(s, r); }
    return r;
  };
}

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

export class Aggregator {
  private idx: Partial<Record<Role, number>> = {};
  private toDay: (v: unknown) => number | null;
  private storeIdx = new Map<string, number>(); private stores: StoreDim[] = [];
  private styleIdx = new Map<string, number>(); private styles: StyleDim[] = [];
  private upcIdx = new Map<string, number>(); private upcs: UpcDim[] = [];
  private chanIdx = new Map<string, number>(); private channels: string[] = [];
  private factIdx = new Map<number | string, number>();
  private F = { store: [] as number[], upc: [] as number[], day: [] as number[], chan: [] as number[], band: [] as number[],
    qty: [] as number[], gross: [] as number[], ret: [] as number[], val: [] as number[], mrpv: [] as number[], dq: [] as number[] };
  private stockIdx = new Map<number | string, number>();
  private K = { store: [] as number[], upc: [] as number[], week: [] as number[], last: [] as number[], soh: [] as number[] };
  private minDay = Infinity; private maxDay = -Infinity;
  private diag = { rows: 0, badDate: 0, badQty: 0, returnRows: 0, returnedUnits: 0, negSoh: 0, facts: 0 };
  private hasUpcCol: boolean;

  constructor(headers: string[], private mapping: Mapping, dayfirst: boolean, private fileName: string) {
    const pos = new Map(headers.map((h, i) => [h, i]));
    for (const [k, h] of Object.entries(mapping)) if (h && pos.has(h)) this.idx[k as Role] = pos.get(h)!;
    this.toDay = makeDayParser(dayfirst);
    this.hasUpcCol = this.idx.upc !== undefined;
    for (const r of ["date", "cluster", "store", "qty"] as Role[])
      if (this.idx[r] === undefined) throw new Error(`Choose a column for ${r === "qty" ? "NSQ" : r}.`);
  }

  private id(map: Map<string, number>, key: string, make: () => void) {
    let i = map.get(key);
    if (i === undefined) { i = map.size; map.set(key, i); make(); }
    return i;
  }

  addRow(row: ArrayLike<unknown>) {
    const g = (r: Role) => { const i = this.idx[r]; return i === undefined ? undefined : row[i]; };
    this.diag.rows++;
    const day = this.toDay(g("date"));
    if (day === null) { this.diag.badDate++; return; }
    const qty = toNum(g("qty"));
    if (qty === null) { this.diag.badQty++; return; }
    if (day < this.minDay) this.minDay = day;
    if (day > this.maxDay) this.maxDay = day;

    const storeCode = txt(g("store")) || "(no store)";
    const st = this.id(this.storeIdx, storeCode, () => this.stores.push({
      code: storeCode, cluster: txt(g("cluster")) || "(no cluster)", region: txt(g("region")), lfl: txt(g("lfl")) }));
    const fabric = txt(g("fabric"));
    const styleCode = txt(g("style")) || fabric || "All";
    const sty = this.id(this.styleIdx, styleCode, () => this.styles.push({ code: styleCode, fabric }));
    const upcCode = this.hasUpcCol ? (txt(g("upc")) || styleCode + "-?") : styleCode;
    const upc = this.id(this.upcIdx, upcCode, () => this.upcs.push({ code: upcCode, style: sty }));
    const chName = txt(g("channel"));
    const ch = this.id(this.chanIdx, chName, () => this.channels.push(chName));
    let disc = this.idx.disc !== undefined ? toNum(g("disc")) : null;
    const band = bandOf(disc);
    const val = toNum(g("value")) ?? 0, mrpv = toNum(g("mrpv")) ?? 0;

    // sales fact
    const b = bucketOf(day);
    const bo = b - 17000; // 2016..2038 fits in 13 bits
    const key: number | string = st < 16384 && upc < 1048576 && bo >= 0 && bo < 8192 && ch < 8
      ? (((st * 1048576 + upc) * 8192 + bo) * 8 + ch) * 8 + band
      : `${st}|${upc}|${b}|${ch}|${band}`;
    let fi = this.factIdx.get(key);
    const F = this.F;
    if (fi === undefined) {
      fi = F.qty.length; this.factIdx.set(key, fi);
      F.store.push(st); F.upc.push(upc); F.day.push(b); F.chan.push(ch); F.band.push(band);
      F.qty.push(0); F.gross.push(0); F.ret.push(0); F.val.push(0); F.mrpv.push(0); F.dq.push(0);
    }
    F.qty[fi] += qty; F.val[fi] += val; F.mrpv[fi] += mrpv;
    if (qty > 0) F.gross[fi] += qty;
    if (qty < 0) { F.ret[fi] -= qty; this.diag.returnRows++; this.diag.returnedUnits -= qty; }
    if (disc !== null && qty > 0) F.dq[fi] += disc * qty;

    // stock snapshot (SOH, or AVAL - NSQ)
    let soh: number | null = null;
    if (this.idx.soh !== undefined) soh = toNum(g("soh"));
    else if (this.idx.aval !== undefined) { const a = toNum(g("aval")); soh = a === null ? null : a - qty; }
    if (soh !== null) {
      if (soh < 0) this.diag.negSoh++;
      const wk = mondayOf(day);
      const wo = wk - 17000;
      const sk: number | string = st < 16384 && upc < 1048576 && wo >= 0 && wo < 8192 ? (st * 1048576 + upc) * 8192 + wo : `${st}|${upc}|${wk}`;
      let si = this.stockIdx.get(sk);
      const K = this.K;
      if (si === undefined) {
        si = K.soh.length; this.stockIdx.set(sk, si);
        K.store.push(st); K.upc.push(upc); K.week.push(wk); K.last.push(day); K.soh.push(soh);
      } else if (day > K.last[si]) { K.last[si] = day; K.soh[si] = soh; }
      else if (day === K.last[si]) K.soh[si] = this.hasUpcCol ? soh : K.soh[si] + soh; // same day: one row per size when no UPC
    }
  }

  finish(): Dataset {
    const F = this.F, K = this.K;
    this.diag.facts = F.qty.length;
    if (!F.qty.length) throw new Error("No usable rows. Check that the Date and NSQ columns are mapped and hold dates and numbers.");
    const has = {
      upc: this.hasUpcCol, stock: K.soh.length > 0, value: this.idx.value !== undefined, mrpv: this.idx.mrpv !== undefined,
      disc: this.idx.disc !== undefined, style: this.idx.style !== undefined, fabric: this.idx.fabric !== undefined,
      lfl: this.idx.lfl !== undefined, channel: this.idx.channel !== undefined,
    };
    // a discount column stored as a fraction (0.3 = 30%)
    if (has.disc) {
      let mx = 0; for (let i = 0; i < F.qty.length; i++) if (F.gross[i] > 0) mx = Math.max(mx, F.dq[i] / F.gross[i]);
      if (mx > 0 && mx <= 1) for (let i = 0; i < F.qty.length; i++) {
        F.dq[i] *= 100; F.band[i] = F.band[i] === 7 ? 7 : bandOf((F.gross[i] > 0 ? F.dq[i] / F.gross[i] : 0));
      }
    }
    return {
      fileName: this.fileName, stores: this.stores, styles: this.styles, upcs: this.upcs, channels: this.channels,
      n: F.qty.length, fStore: Int32Array.from(F.store), fUpc: Int32Array.from(F.upc), fDay: Int32Array.from(F.day),
      fChan: Int8Array.from(F.chan), fBand: Int8Array.from(F.band), qty: Float64Array.from(F.qty), gross: Float64Array.from(F.gross),
      ret: Float64Array.from(F.ret), val: Float64Array.from(F.val), mrpv: Float64Array.from(F.mrpv), dq: Float64Array.from(F.dq),
      m: K.soh.length, kStore: Int32Array.from(K.store), kUpc: Int32Array.from(K.upc), kWeek: Int32Array.from(K.week),
      kSoh: Float64Array.from(K.soh), minDay: this.minDay, maxDay: this.maxDay, has, diag: this.diag,
    };
  }
}

export const transferables = (d: Dataset): Transferable[] =>
  [d.fStore, d.fUpc, d.fDay, d.fChan, d.fBand, d.qty, d.gross, d.ret, d.val, d.mrpv, d.dq, d.kStore, d.kUpc, d.kWeek, d.kSoh].map((a) => a.buffer);
