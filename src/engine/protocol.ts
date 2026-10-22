import type { Dataset } from "../data/types";
import type { AllocSettings, Allocation } from "../model/allocate";
import type { Demand, DemandSettings } from "../model/demand";
import type { Filters } from "../model/filters";
import type { Dim, Measure, Mode, TrendResult } from "../model/trends";

/** What the page needs to know about the loaded data; the data itself stays in the worker. */
export interface Meta {
  fileName: string; headers: string[]; mapping: Record<string, string>; sheets: string[]; sheet?: string; ms: number;
  has: Dataset["has"]; diag: Dataset["diag"]; minDay: number; maxDay: number; stockFacts: number;
  channels: string[]; lfl: string[]; fabrics: string[];
}

export type Source = { kind: "example" } | { kind: "file"; file: File; dayfirst: boolean; mapping?: Record<string, string>; sheet?: string };
export interface TrendQuery { filters: Filters; mode: Mode; fy: boolean; measure: Measure; dim: Dim; lflOnly: boolean; review?: number }
export interface PlanQuery { filters: Filters; demand: DemandSettings; alloc: AllocSettings }

export type Request =
  | { id: number; type: "load"; source: Source }
  | { id: number; type: "trends"; q: TrendQuery }
  | { id: number; type: "plan"; q: PlanQuery };

export type Response =
  | { id: number; type: "progress"; stage: string; pct: number; rows: number }
  | { id: number; type: "loaded"; meta: Meta }
  | { id: number; type: "trends"; result: TrendResult }
  | { id: number; type: "plan"; D: Demand; A: Allocation; ms: number }
  | { id: number; type: "error"; message: string; headers?: string[]; mapping?: Record<string, string>; sheets?: string[]; sheet?: string };
