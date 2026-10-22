# Seasonal Cluster Allocator (web app)

React + TypeScript + Vite. Upload store sales (NSQ, SOH, AVAL) to see QoQ/YoY trends, estimate true demand including
sales lost to stockouts, and allocate limited seasonal stock across store clusters. No Gemini or API calls; everything runs in the browser.

## Why large files don't slow the browser
- **Background engine.** Files are read and every calculation runs in a Web Worker (`src/engine/engine.worker.ts`).
  The page only sends settings and receives small results, so it never freezes and never holds the big arrays.
- **Condensed while reading.** Rows are summed into weekly records (store × UPC × week × channel × discount band) as they
  stream in (`src/data/aggregate.ts`). One object per row is never created.
- **CSV is streamed** in 4 MB chunks (constant memory). Excel has to be opened whole, so save very large sheets as CSV.
- Nothing is stored in localStorage or the browser cache.

## Data conventions
- NSQ = net sale quantity; negative rows are returns (netted out, reported as a return rate).
- SOH = stock on hand (closing stock); negative SOH is treated as 0. AVAL = NSQ + SOH, used only if SOH is missing.
- A store × size week that closes with SOH ≤ 0 is a stockout; lost sales = expected demand − units sold that week.

## Code map
| Path | What it does |
|---|---|
| `src/data/aggregate.ts` | Streaming aggregator (rows → weekly records, last SOH per week) |
| `src/data/parse.ts` | CSV (Papa Parse, streamed) and Excel (SheetJS, dense mode) readers |
| `src/model/demand.ts` | Seasonality index, lost sales, SKU analysis, forecast |
| `src/model/allocate.ts` | Greedy allocation under supply / space limits, baseline, recommendations |
| `src/model/trends.ts` | QoQ / MoM / YoY |
| `src/engine/*` | Worker engine and the page-side client |
| `src/ui/*` | Tabs and charts |

The model matches the Python version (`allocator_model.py`) to the unit on the same data.

## Run
```
npm install
npm run dev      # http://localhost:3000
npm run build    # static site in dist/
```
