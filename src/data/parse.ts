// File readers used inside the engine worker. CSV is streamed in chunks (constant memory); Excel is read once
// and walked row by row without creating one object per row. Both feed the Aggregator, so only compact
// weekly facts are kept.
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Aggregator } from "./aggregate";
import { cleanHeaders, guessMapping, missingRequired, pickHeaderRow, type Mapping } from "./columns";
import { EXAMPLE_HEADERS, generateExample } from "./example";
import type { Dataset } from "./types";

export type Progress = (stage: string, pct: number, rows: number) => void;
export interface Parsed { dataset: Dataset; headers: string[]; mapping: Record<string, string>; sheets: string[]; sheet?: string }

/** Raised when required columns cannot be matched; carries the headers so the page can ask the user. */
export class NeedsMapping extends Error {
  constructor(public headers: string[], public mapping: Record<string, string>, public sheets: string[], public sheet?: string) {
    super(`Pick the column for ${missingRequired(mapping as Mapping).join(", ")} in the Columns panel. The file's headers did not match automatically.`);
  }
}

export function parseExample(): Parsed {
  const mapping = guessMapping(EXAMPLE_HEADERS) as Record<string, string>;
  const agg = new Aggregator(EXAMPLE_HEADERS, mapping, true, "Example data");
  generateExample((r) => agg.addRow(r));
  return { dataset: agg.finish(), headers: EXAMPLE_HEADERS, mapping, sheets: [] };
}

export function parseCsv(file: File, dayfirst: boolean, mapping: Record<string, string> | undefined, progress: Progress) {
  return new Promise<Parsed>((resolve, reject) => {
    let headers: string[] | null = null, agg: Aggregator | null = null, rows = 0, map: Record<string, string> = {};
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      chunkSize: 4 * 1024 * 1024,
      chunk: (res, parser) => {
        try {
          let data = res.data;
          if (!headers) {
            const h = pickHeaderRow(data);
            headers = cleanHeaders(data[h]);
            map = mapping ?? (guessMapping(headers) as Record<string, string>);
            if (missingRequired(map as Mapping).length) throw new NeedsMapping(headers, map, []);
            agg = new Aggregator(headers, map, dayfirst, file.name);
            data = data.slice(h + 1);
          }
          for (const r of data) agg!.addRow(r);
          rows += data.length;
          progress("Reading CSV", Math.min(99, Math.round(((res.meta.cursor ?? 0) / file.size) * 100)), rows);
        } catch (err) { parser.abort(); reject(err); }
      },
      complete: () => {
        try {
          if (!agg || !headers) throw new Error("The file is empty.");
          resolve({ dataset: agg.finish(), headers, mapping: map, sheets: [] });
        } catch (err) { reject(err); }
      },
      error: (err) => reject(err),
    });
  });
}

export async function parseExcel(file: File, dayfirst: boolean, mapping: Record<string, string> | undefined, sheet: string | undefined, progress: Progress): Promise<Parsed> {
  progress("Opening workbook", 2, 0);
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", dense: true, cellDates: false, cellFormula: false, cellHTML: false, cellText: false, cellStyles: false, sheetStubs: false });
  const name = sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0];
  const ws = wb.Sheets[name] as unknown as Record<string, unknown>;
  // dense sheets: SheetJS 0.18 keeps rows in the sheet array itself, newer versions in ws["!data"]
  const rowsArr = (ws["!data"] as unknown[][] | undefined) ?? (Array.isArray(ws) ? (ws as unknown as unknown[][]) : null);
  const cell = (c: unknown) => (c && typeof c === "object" && "v" in (c as object) ? (c as { v: unknown }).v : c);
  let getRow: (i: number) => unknown[] | undefined, nRows: number;
  // Array.from fills the gaps that sparse rows have where cells are empty
  if (rowsArr) { nRows = rowsArr.length; getRow = (i) => (rowsArr[i] ? Array.from(rowsArr[i], cell) : undefined); }
  else { const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws as XLSX.WorkSheet, { header: 1, raw: true, defval: null }); nRows = aoa.length; getRow = (i) => aoa[i]; }
  const h = pickHeaderRow(Array.from({ length: Math.min(nRows, 30) }, (_, i) => getRow(i)));
  const headers = cleanHeaders(getRow(h));
  const map = mapping ?? (guessMapping(headers) as Record<string, string>);
  if (missingRequired(map as Mapping).length) throw new NeedsMapping(headers, map, wb.SheetNames, name);
  const agg = new Aggregator(headers, map, dayfirst, file.name + (wb.SheetNames.length > 1 ? " · " + name : ""));
  const step = Math.max(1, Math.floor(nRows / 50));
  for (let i = h + 1; i < nRows; i++) {
    const r = getRow(i);
    if (r && r.length) agg.addRow(r);
    if (rowsArr) rowsArr[i] = undefined as unknown as unknown[]; // release rows as we go
    if (i % step === 0) progress("Condensing rows", 5 + Math.round((i / nRows) * 94), i);
  }
  return { dataset: agg.finish(), headers, mapping: map, sheets: wb.SheetNames, sheet: name };
}
