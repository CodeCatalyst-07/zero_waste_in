# Performance & Efficiency Benchmarks

*Measured: October 2026*  
*Environment: Node.js v22 on Apple Silicon (arm64)*

This document records the actual, measured performance metrics for ZeroWasteIN across bundle size, memory footprint, classification latency, and network efficiency.

---

## 1. Production Bundle Size & Code Splitting

ZeroWasteIN uses Vite with zero heavy third-party UI component libraries (no Tailwind, no UI kit, no router library, no charting libraries). All charts are hand-crafted, accessible inline SVGs.

### Asset Measurements (`apps/web/dist/assets`)

| Asset | Description | Raw Size | Gzip Size | Budget (+20%) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `index-*.js` | Primary application entry & Sort flow | 283.59 kB | 84.90 kB | 102.00 kB | **PASS** |
| `index-*.css` | Complete design tokens & layout CSS | 34.64 kB | 5.82 kB | 7.20 kB | **PASS** |
| `FootprintScreen-*.js` | Lazy-loaded Footprint & Tracker view | 19.89 kB | 5.40 kB | N/A (Lazy) | **PASS** |
| `ImpactScreen-*.js` | Lazy-loaded Impact & Citizen Eco Score | 8.00 kB | 2.59 kB | N/A (Lazy) | **PASS** |
| `calculator-*.js` | Shared carbon calculator module | 11.21 kB | 3.58 kB | N/A (Lazy) | **PASS** |

### Code Splitting Verification
- Initial page load for the `#sort` screen downloads **only** `index-*.js` and `index-*.css` (~90.7 kB total gzip).
- `#footprint` and `#impact` screens are split using `React.lazy()` and dynamic imports, loading on demand only when the user navigates to their respective tabs.

---

## 2. Classification Latency & Network Efficiency

### Text Fast Path (Zero Network Overhead)
- **Offline Client Lookup**: Direct item text matches against `@zerowastein/rules` resolve entirely on-device via `lookupByText()` and `decide()`.
  - Client Latency: **< 1 ms**
  - Network Requests: **0 fetch calls**
- **Serverless API Text Fast Path** (`/api/classify`):
  - Local API Latency: **~1 ms** (logged in serverless observability)
  - Provider Invocations: **0 model calls** when table row matches.

### Multimodal Vision Pipeline
- **Canvas Compression**: Mobile photographs are downscaled to $\le 1024\text{ px}$ on longest edge and compressed to JPEG quality 0.7 prior to transmission, stripping EXIF/GPS data and reducing typical 4–8 MB smartphone photos to **120–280 kB**.
- **Model Inferences**:
  - Jarvis Labs (`meta-llama/Llama-3.2-11B-Vision-Instruct`): **2,500 ms – 4,400 ms**
  - Google AI Studio (`gemini-2.5-flash`): **2,800 ms – 3,500 ms**
- **Selective Cross-Checking**: Dual-model consensus verification is conditionally triggered **only** when detected attributes contain statutory hazards (`isSharp`, `isBattery`, `isBulb`, `isMedicine`, `isChemical`, `isElectronic`) or when inference confidence is below `0.70`. Standard items skip cross-checking to conserve compute and avoid redundant API costs.
