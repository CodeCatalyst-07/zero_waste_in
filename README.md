# ZeroWasteIN

> The rulebook, with a camera.

A mobile-first web application designed to help Indian households and municipal workers accurately segregate household waste into India's four statutory waste streams defined by the **Solid Waste Management Rules 2026**.

---

## 1. Problem Statement

Under India's **Solid Waste Management Rules 2026** (Ministry of Environment, Forest and Climate Change), waste generators are mandated to segregate waste at source into four distinct streams:

1. **Wet Waste (Green)**: Biodegradable organic material including kitchen scraps, cooked food, fruit/vegetable peels, tea leaves, and garden waste.
2. **Dry Waste (Blue)**: Non-biodegradable clean recyclables including paper, cardboard, plastics, metals, glass bottles, and dry packaging.
3. **Sanitary Waste (Red/Marked)**: Domestic personal hygiene waste including used sanitary pads, menstrual napkins, diapers, bandages, and soiled tissues.
4. **Special-Care / Domestic Hazardous Waste (Black with Amber Hazard Indicator)**: Household hazardous materials requiring specialized handling, including CFLs, tube lights, batteries, expired medicines, paint residue, pesticide cans, and e-waste.

High contamination rates at municipal transfer stations stem from confusion over ambiguous items (e.g., blister packs, greasy pizza boxes, broken bulbs). ZeroWasteIN provides instant, authoritative segregation decisions with practical handling instructions directly on mobile devices.

---

## 2. How It Works

The architecture decouples non-deterministic visual recognition from statutory legal rules:

1. **Vision Extracts Attributes**: An AI vision model analyzes a citizen's photo or text query to detect objective physical attributes (`item`, `isSharp`, `isBattery`, `isBulb`, `isMedicine`, `isChemical`, `isElectronic`, `isHygiene`, `isFood`, `isGarden`, `evidence`, `confidence`). The AI model **never** assigns the waste stream directly.
2. **Text Fast Path**: For unambiguous text queries (e.g. "banana peel", "milk pouch"), the classification pipeline resolves in 0ms with **zero external AI model calls** using deterministic rules table matching.
3. **Rules Table Decides**: A deterministic rules engine evaluates extracted attributes against the canonical Solid Waste Management Rules 2026 table (`packages/rules`), deterministically assigning the waste stream and generating statutory handling guidelines.
4. **Carbon Mitigation Impact**: The app computes avoided greenhouse gas emissions (in kgCO2e) based on peer-reviewed, versioned Indian emission factors (`packages/carbon`).

```
[ Citizen Photo / Text ]
          │
          ▼
[ AI Vision Provider Chain ] ──► Extracts: Attributes (isBattery, isChemical, etc.)
          │
          ▼
[ Deterministic Rules Engine ] ──► Evaluates against SWM Rules 2026 table
          │
          ▼
[ Statutory Stream & Handling ] (Wet, Dry, Sanitary, or Special-Care)
          │
          ▼
[ Carbon Avoidance Factor ] ──► kgCO2e avoided via segregation
```

---

## 3. Using ZeroWasteIN

- **Sort Flow**:
  - **Offline Common Chips**: Tap any of the 12 common item chips (e.g., vegetable peels, plastic bottles, AA batteries) to see its segregation verdict instantly with **zero network calls**.
  - **Offline-First Text Search**: Tap **Type it** to search any household item. Clear catalog matches resolve in 0ms locally; ambiguous queries query `/api/classify`. If the network fails, local "Did you mean..." candidate chips prevent error walls.
  - **Camera & Photo Upload**: Tap **Take a photo** (activates device environment camera directly without permission prompts) or **Upload**. Photos are automatically resized to <= 1024px in an off-screen canvas and re-encoded to JPEG at 0.7 quality, stripping all geolocation and EXIF metadata before transmission.
  - **Clarification Questions (Ask)**: For conditional items (e.g. empty vs pressurized aerosol cans, soiled tissues) or uncertain hazards, a clean card poses a quick binary question and resolves via `resolveFollowUp()`.
  - **Result Card**: Displays the authoritative statutory stream, geometric shape badge, statutory reason, actionable handling instructions, and regulatory flags (e.g. _Rules vary by city_, _Separate e-waste channel_). Medicine items never display dosing or flushing advice.

- **My Impact Tab & Citizen Eco Score**:
  - **Citizen Eco Score**: A transparent, un-gamified score (0–100) calculated solely from on-device activity. Published formula:
    - **Sorting Activity (40%)**: Items sorted in last 30 days vs 20-item goal (capped at 100%). Measures habit, not correctness.
    - **Electricity Trend (25%)**: Current month usage vs own previous month.
    - **Water Trend (15%)**: Current month consumption vs own previous month.
    - **Transport Footprint Trend (20%)**: Current month travel emissions vs own previous month.
    - **Dynamic Weight Renormalization**: Only components with real user data count; weights renormalize across available inputs. Shows _"Based on N of 4 inputs"_ and no score until real data is logged.
    - **Accessible SVG Ring**: Smoothly animated progress arc and counter, both disabled under `prefers-reduced-motion`.
  - **On-Device Segregation Tally**: Displays total items sorted and domestic hazardous special-care items caught.
  - Plain history list of the 10 most recent items with timestamps and stream badges.
  - **Export & Delete**: Export data anytime as a JSON file, or delete all on-device records via a native confirmation dialog.

- **Footprint & Utilities Tab**:
  - **Carbon Estimator**: Calculates monthly household carbon in kg CO2 based on monthly electricity consumption (kWh) and a commute routine builder (scooter, motorcycle, autorickshaw, petrol/diesel cars, city bus, domestic flight). Factors vehicle occupancy and applies standard weeks-per-month conversions.
  - **Authoritative Provenance**: Electricity uses CEA Baseline Database v22.0 (FY 2025-26: 0.675 kg CO2/kWh; prior year 0.710). Road/air transport uses India GHG Program (2015 stakeholder consultation draft; direct emissions with no radiative forcing uplift convention).
  - **Omitted Factors**: Food lifecycle, urban metro/rail, and household LPG are strictly omitted due to the lack of verified national standardized lifecycle datasets.
  - **Monthly Utility Tracker**: Logs monthly electricity (kWh), water (liters), and household size locally under `zerowastein:v1:tracker` (capped at 24 billing months).
  - **Own-Baseline Comparison**: Compares the user strictly against their own previous month with signed deltas (`+`/`-`), percentages, and direction icons. No arbitrary national targets.
  - **Water Planning Context**: Shows national planning norms (CPHEEO urban 135 L/person/day; JJM rural 55 L/person/day) as municipal infrastructure reference context, not personal targets.
  - **Inline SVG Bar Charts with Table Alternatives**: Lightweight, accessible SVG bar charts paired with a "View as table" toggle button that reveals a fully semantic `<table>` with column headers for assistive technology.

---

## 4. Run Locally

Get ZeroWasteIN running locally in seconds without requiring Vercel CLI or cloud logins:

```bash
# 1. Install all monorepo dependencies across workspaces
pnpm install

# 2. Configure environment variables (fill optional AI keys if available)
cp .env.example .env

# 3. Start local Vite development server with dev-api classifier mounted
pnpm dev

# 4. In a separate terminal, execute live classification smoke verification
pnpm smoke

# (Optional) Verify image classification with a local photo:
# pnpm smoke ./path/to/test-waste.jpg
```

> **Dev API Plugin (`apps/web/vite.dev-api.ts`)**: During `pnpm dev`, Vite mounts `/api/classify` locally at `http://localhost:5173/api/classify`, loading `.env` on the server-side while keeping all secret variables strictly isolated from the client bundle.

---

## 5. Google Services & Provider Chain

ZeroWasteIN uses Google technologies meaningfully for multimodal reasoning and open-weights inference:

- **Google Gemini API (`@google/genai`)**:
  - Acts as a high-precision vision extractor using official Google GenAI SDK structured outputs (`responseMimeType: "application/json"`, strict `responseSchema`).
  - Provides dual-model **cross-checking** when classifications are uncertain (confidence < 0.80) or when safety-critical hazard attributes (sharps, batteries, chemicals) are detected.
  - Supports model escalation (e.g., falling back to `gemini-2.5-pro` if configured).
- **Gemma Open Models (`gemma-4-31b-it`)**:
  - Deployed on Jarvis Labs (Indian cloud GPU infrastructure) as the primary provider in `PROVIDER_ORDER`.
  - Accessed via an OpenAI-compatible interface with low network latency for Indian mobile users.
  - Also configurable directly on Google Gemini infrastructure (`gemma_gemini`).
- **Graceful Degradation**:
  - The provider chain operates with zero hardcoded model names or credentials.
  - If any provider lacks an API key in `.env`, it is skipped automatically without crashing.
  - If all external AI providers are offline or unconfigured, the application gracefully degrades to text-lookup-only mode, continuing to serve citizens for catalog items.

---

## 4. Privacy and Data Handling

- **Ephemeral Processing**: Photos and text queries are processed in volatile container memory only. Images are never written to disk, databases, or cloud object storage.
- **Provider Confidentiality**: Images and queries are transmitted over encrypted TLS connections to Jarvis Labs or Google Gemini solely for real-time visual attribute inference. Only image bytes and structured schema prompts are sent; no user identifiers, IP addresses, geolocations, or cookies are ever forwarded to AI providers.
- **Zero Image Logging**: Application server logs output only structured operational metadata (`requestId`, `mode`, `latencyMs`, `outcomeCode`). No base64 image strings, image buffers, or user query bodies are ever written to console or persistent logs.
- **Citizen Guidelines**: Users must photograph only inanimate waste items. Please **do not photograph** human faces, payment cards, identity documents, or personal items.

---

## 5. Architecture

The codebase is organized as a strict TypeScript `pnpm` monorepo:

```
waste-sorter-india/
├── apps/
│   └── web/                   # Vite + React 19 + TypeScript, Plain CSS design tokens
├── packages/
│   ├── rules/                 # Pure TS (0 runtime dependencies): SWM Rules 2026 table & decide()
│   └── carbon/                # Pure TS (0 dependencies): versioned factors.json & calculator stubs
├── api/
│   ├── classify.ts            # Vercel serverless function pipeline with text fast path
│   ├── config.ts              # Zod-validated server-side configuration and provider chain loader
│   ├── rate-limit.ts          # In-memory token bucket rate limiter with eviction
│   ├── prompt.ts              # Canonical system prompt and few-shot examples
│   ├── schemas.ts             # Strict Zod schema and JSON schema for attributes
│   └── providers/             # Identifier interface and provider adapters (Jarvis, Gemini, Gemma)
├── docs/                      # Architectural specifications and ADRs
│   ├── ARCHITECTURE.md
│   └── DECISIONS.md
├── .github/workflows/ci.yml   # Continuous integration: lint, typecheck, test, audit
├── SECURITY.md                # Key isolation, CSP headers, and privacy policy
├── vercel.json                # Edge deployment headers, strict CSP, permissions policy
└── vitest.config.ts           # Workspace-wide unit testing configuration
```

---

## 6. Setup (.env)

Copy `.env.example` to `.env` in the project root:

```bash
cp .env.example .env
```

Environment variables are validated on startup via `zod`:

- `PROVIDER_ORDER`: Comma-delimited priority list (default: `jarvis,gemini,gemma_gemini`).
- `JARVISLABS_API_KEY`: API key for Jarvis Labs (optional; skipped if empty).
- `JARVISLABS_BASE_URL`: OpenAI-compatible endpoint URL (default: `https://models.jarvislabs.net/v1`).
- `JARVISLABS_MODEL`: Target model (default: `gemma-4-31b-it`).
- `JARVIS_MAX_TOKENS`: Maximum output tokens (default: `1024`).
- `JARVIS_EXTRA_BODY_JSON`: Optional JSON string merged into Jarvis request body (e.g. reasoning parameters).
- `GEMINI_API_KEY`: Google AI Studio API key (optional; skipped if empty).
- `GEMINI_MODEL_PRIMARY`: Primary Gemini model identifier from Google AI Studio.
- `GEMINI_MODEL_ESCALATION`: Optional escalation model identifier.
- `GEMMA_GEMINI_MODEL`: Gemma model identifier on Gemini API.
- `CROSS_CHECK_ENABLED`: Whether dual-model cross-check is enabled for uncertainty/hazards (default: `true`).
- `BREAKER_COOLDOWN_MS`: Circuit breaker pause duration in milliseconds (default: `60000`).
- `RATE_LIMIT_PER_MINUTE`: Token bucket requests per minute per IP (default: `20`).
- `MAX_TEXT_LENGTH`: Maximum characters in text queries (default: `120`).
- `REQUEST_TIMEOUT_MS`: Network timeout in milliseconds (default: `15000`).
- `MAX_UPLOAD_BYTES`: Maximum upload payload in bytes (default: `1048576` / 1MB).

> **Important**: Secrets are server-side only. Do not prefix API keys with `VITE_` or expose them to client code.

---

## 8. Scripts

Run commands from the repository root:

| Command          | Description                                                                |
| :--------------- | :------------------------------------------------------------------------- |
| `pnpm install`   | Install all monorepo dependencies across workspace packages                |
| `pnpm dev`       | Start local Vite dev server with mounted dev API (`localhost:5173`)        |
| `pnpm smoke`     | Test local classification endpoint with live text and optional image query |
| `pnpm build`     | Build all workspace packages and apps for production                       |
| `pnpm lint`      | Run ESLint across all TypeScript and JavaScript files                      |
| `pnpm typecheck` | Run strict TypeScript compiler verification without emitting files         |
| `pnpm test`      | Execute Vitest unit test suite across all packages (170 tests)             |
| `pnpm audit`     | Audit project dependencies for known security vulnerabilities              |
| `pnpm format`    | Check source files against Prettier formatting rules                       |

---

## 9. Features Mapped to Judging Criteria

| Judging Criterion                  | Implementation Feature                                                        | Status              |
| :--------------------------------- | :---------------------------------------------------------------------------- | :------------------ |
| **Code Quality**                   | Strict TypeScript, zero-dependency rules package, clean modular architecture  | Complete            |
| **Security**                       | Server-side key isolation, strict CSP, permissions-policy, zero image logging | Complete            |
| **Efficiency**                     | 0ms text fast path, circuit breaker resilience, token bucket rate limiting    | Complete            |
| **Testing**                        | Vitest test suite (170 tests, 18 files), static security scanners, CI         | Complete            |
| **Accessibility**                  | 0 axe violations, high contrast (>= 4.5:1 text, >= 3:1 UI), live regions      | Complete            |
| **Google Services**                | Gemini structured JSON schema, Gemma 4 on Jarvis Labs, Gemma on Gemini API    | Complete            |
| **Problem Statement Alignment**    | Canonical Solid Waste Management Rules 2026 table (4 streams)                 | Complete            |
| **Vision Model Classification**    | Fallback provider chain (`/api/classify`) with dual-model cross-checking      | Complete            |
| **Complete SORT Flow & Camera UI** | Mobile-first live camera capture, offline-first search, ask/result cards      | Phase 2.3 Complete  |
| **On-Device Impact Tally**         | Real-data only tally, JSON export, native `<dialog>` deletion confirmation    | Phase 2.3 Complete  |
| **Carbon Avoidance Estimator**     | Electricity & commute routines in kg CO2 (CEA FY25-26, India GHG Program)     | Phase 2.3b Complete |
| **Energy & Water Tracker**         | Monthly utility logs, own-baseline comparison, CPHEEO/JJM planning norms      | Phase 2.3b Complete |
| **Citizen Eco Score & Ring**       | Transparent 4-component renormalized score, accessible SVG progress ring      | Phase 2.3b Complete |
| **Multilingual Support**           | Regional Indian languages (Hindi, Tamil, Kannada, Bengali)                    | Planned             |
