// Compact, pre-aggregated dataset. A large file is never kept row by row: while it is read, rows are
// summed into "facts" at store x UPC x bucket x channel x discount band, where a bucket is a calendar week
// split at month boundaries (so weeks, months and quarters all stay exact). Stock is kept as the last
// SOH snapshot per store x UPC x week.

export interface StoreDim { code: string; cluster: string; region: string; lfl: string }
export interface StyleDim { code: string; fabric: string }
export interface UpcDim { code: string; style: number }

export interface Dataset {
  fileName: string;
  stores: StoreDim[];
  styles: StyleDim[];
  upcs: UpcDim[];          // without a UPC column, one "UPC" per style
  channels: string[];
  // sales facts (columnar)
  n: number;
  fStore: Int32Array; fUpc: Int32Array; fDay: Int32Array; fChan: Int8Array; fBand: Int8Array;
  qty: Float64Array;   // net units (NSQ)
  gross: Float64Array; // units on positive rows
  ret: Float64Array;   // units on negative rows (returns), as a positive number
  val: Float64Array; mrpv: Float64Array;
  dq: Float64Array;    // discount % x units, for unit-weighted average discount
  // stock facts: last SOH per store x UPC x week (week = Monday day number)
  m: number;
  kStore: Int32Array; kUpc: Int32Array; kWeek: Int32Array; kSoh: Float64Array;
  minDay: number; maxDay: number;
  has: { upc: boolean; stock: boolean; value: boolean; mrpv: boolean; disc: boolean; style: boolean; fabric: boolean; lfl: boolean; channel: boolean };
  diag: { rows: number; badDate: number; badQty: number; returnRows: number; returnedUnits: number; negSoh: number; facts: number };
}

// discount bands: 0: 0%, 1: <=10, 2: <=20, 3: <=30, 4: <=40, 5: <=50, 6: >50, 7: unknown
export const BAND_UPPER = [0, 10, 20, 30, 40, 50, 100, -1];
export function bandOf(d: number | null): number {
  if (d === null || !isFinite(d)) return 7;
  if (d <= 0) return 0;
  for (let b = 1; b <= 5; b++) if (d <= BAND_UPPER[b] + 1e-9) return b;
  return 6;
}

// ---------- calendar helpers on UTC day numbers (days since 1970-01-01, a Thursday) ----------
export const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayOf = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 864e5);
export const dateOf = (day: number) => new Date(day * 864e5);
export const mondayOf = (day: number) => day - ((day + 3) % 7 + 7) % 7;
export const monthStart = (day: number) => { const x = dateOf(day); return dayOf(x.getUTCFullYear(), x.getUTCMonth() + 1, 1); };
export const bucketOf = (day: number) => Math.max(mondayOf(day), monthStart(day));
export const dayLabel = (day: number) => { const x = dateOf(day); return String(x.getUTCDate()).padStart(2, "0") + " " + MONS[x.getUTCMonth()]; };
export const dayFull = (day: number) => dayLabel(day) + " " + dateOf(day).getUTCFullYear();
export const isoDay = (day: number) => dateOf(day).toISOString().slice(0, 10);

// Worker messages
export type ToWorker =
  | { type: "parse"; file: File; mapping?: Record<string, string>; dayfirst: boolean; sheet?: string }
  | { type: "example" };
export type FromWorker =
  | { type: "progress"; stage: string; pct: number; rows: number }
  | { type: "headers"; headers: string[]; sheets: string[]; sheet?: string; mapping: Record<string, string> }
  | { type: "done"; dataset: Dataset; mapping: Record<string, string>; headers: string[]; ms: number }
  | { type: "error"; message: string };
