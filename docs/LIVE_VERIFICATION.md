# Live Provider Verification Report

**Phase 2.3a: Live Provider Verification**  
**Date:** October 28, 2026  
**System:** ZeroWasteIN Classification Pipeline (`/api/classify`)  
**Status:** All Live Providers Verified & Operational

---

## 1. Executive Summary

Live verification was executed against the production AI inference endpoints for Jarvis Labs (`gemma-4-31b-it`) and Google Gemini (`gemini-2.5-flash` via `@google/genai` v2.31.0). All test modalities (instant offline table lookup, primary image classification, cross-provider hazard verification, single-key fallback, and full provider outage degradation) were validated with zero secret leaks.

---

## 2. Models Used & Verified

| Provider Tag          | Model ID           | Host / Endpoint                    | Role                       | Status              |
| :-------------------- | :----------------- | :--------------------------------- | :------------------------- | :------------------ |
| `jarvis`              | `gemma-4-31b-it`   | `https://models.jarvislabs.net/v1` | Primary vision & reasoning | **PASS** (Active)   |
| `gemini`              | `gemini-2.5-flash` | Google AI Studio (`@google/genai`) | Secondary / cross-check    | **PASS** (Active)   |
| `gemini` (escalation) | `gemini-3.5-flash` | Google AI Studio (`@google/genai`) | Rate-limit / 5xx fallback  | **PASS** (Verified) |
| `gemma_gemini`        | `gemma-4-31b-it`   | Google AI Studio (`@google/genai`) | Tertiary fallback          | **PASS** (Verified) |

> [!NOTE] Model Adjustments from Static Plan
>
> - `gemini-2.5-pro` returned HTTP 404 (`"This model models/gemini-2.5-pro is no longer available to new users"` / 0 quota on Free Tier). Configured `GEMINI_MODEL_ESCALATION=gemini-3.5-flash` which is verified live.
> - `gemma-3-27b-it` returned HTTP 404 on API version `v1beta`. Verified available Gemma models via `ai.models.list()` and configured `GEMMA_GEMINI_MODEL=gemma-4-31b-it`.

---

## 3. Real Photo Smoke Test Evidence

All tests executed via `pnpm smoke -- <fixture-path>` against the live local development server (`http://localhost:5173/api/classify`).

### Test 1: Vegetable Peel (`test-fixtures/vegetable_peel.jpg`, 425 KB)

- **Input:** Real photo of organic vegetable peels
- **Status:** HTTP 200
- **Latency:** 1,335 ms
- **Verdict Kind:** `answer`
- **Item Label:** Vegetable and fruit peels
- **Stream:** `wet` (Green bin, solid `#1E7B3A`)
- **Metadata:** `source="model"`, `providerUsed="jarvis"`, `crossChecked=false`, `degraded=false`

### Test 2: Household Battery (`test-fixtures/battery.jpg`, 102 KB)

- **Input:** Real photo of AA battery (hazard stream trigger)
- **Status:** HTTP 200
- **Latency:** 4,414 ms – 6,114 ms (dual-model execution)
- **Verdict Kind:** `special_care` / `ask` (identifies battery hazardous component)
- **Item Label:** AA/AAA and button-cell batteries
- **Stream:** `special_care` (Black band with amber hazard stripe)
- **Metadata:** `source="model"`, `providerUsed="jarvis"`, `crossChecked=true`, `degraded=false`
- **Cross-Check Outcome:** Dual agreement between Jarvis Labs and Google Gemini confirming `isBattery: true`.

### Test 3: Plastic Water Bottle (`test-fixtures/plastic_bottle.jpg`, 339 KB)

- **Input:** Real photo of clear PET plastic water bottle
- **Status:** HTTP 200
- **Latency:** 1,816 ms
- **Verdict Kind:** `answer`
- **Item Label:** Plastic bottles (PET), jugs
- **Stream:** `dry` (Blue bin, solid `#1F5FBF`)
- **Metadata:** `source="model"`, `providerUsed="jarvis"`, `crossChecked=false`, `degraded=false`

---

## 4. Adapter Findings & Fixes

### 4.1 Jarvis Labs Adapter (`api/providers/jarvis.ts`)

1. **Input Format:** Verified base64 data-URL in OpenAI-compatible `image_url` parts (`data:${mimeType};base64,...`) is accepted and decoded cleanly by `gemma-4-31b-it`.
2. **Structured Output:** `response_format: { type: "json_object" }` functioned correctly with `finish_reason: "stop"`.
3. **Reasoning Tokens:** Direct inspection of completion payloads verified `reasoning_tokens: 0` when `enable_thinking=false` is supplied in `JARVIS_EXTRA_BODY_JSON`. Token usage was ~1,128 tokens total per query, completing within 689 ms direct latency.

### 4.2 Google Gemini Adapter (`api/providers/gemini.ts`)

1. **Evidence & Diagnosis:**
   - When configured with `thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }`, the live Gemini API threw:
     ```
     ApiError: {"error":{"code":400,"message":"Thinking level is not supported for this model.","status":"INVALID_ARGUMENT"}}
     ```
2. **SDK Type Inspection & Fix:**
   - Checked `@google/genai` (v2.31.0) definitions for `ThinkingConfig`.
   - For `gemini-2.5-flash`, thinking control is managed via `thinkingBudget?: number` (where `0` denotes DISABLED).
   - Changed adapter configuration:
     ```ts
     config: {
       systemInstruction: SYSTEM_PROMPT,
       responseMimeType: 'application/json',
       responseSchema: attributesJsonSchema,
       thinkingConfig: {
         thinkingBudget: 0,
       },
     }
     ```
   - Retested against live API Studio: Returned valid JSON matching `attributesJsonSchema` within ~2.2 s with 100% schema compliance.

---

## 5. Live Cross-Check Path Verification

Dual-model cross-checking is enabled whenever classification confidence is below threshold or when hazardous flags (`isSharp`, `isBattery`, `isBulb`, `isMedicine`, `isChemical`, `isElectronic`) are asserted.

- **Trigger Fixture:** `test-fixtures/battery.jpg`
- **Execution:**
  1. Primary provider (`jarvis`) identified `isBattery: true`.
  2. Router detected hazard attribute and invoked secondary provider (`gemini`).
  3. `gemini` returned attributes with `isBattery: true`.
  4. Router verified consensus across all hazard flags.
  5. API response emitted `meta.crossChecked: true` and `meta.disagreement: false`.
- **Zero Leak Verification:** Logs output only sanitized metadata (`requestId`, `mode`, `providerUsed`, `latencyMs`, `outcomeCode`). Raw keys, prompt bodies, and image base64 bytes are never emitted.

---

## 6. Live Fallback & Outage Verification

### Test A: Primary Key Blanked (`JARVISLABS_API_KEY=""`)

- **Action:** Cleared Jarvis key in `.env` and sent `test-fixtures/plastic_bottle.jpg`.
- **Result:** Router bypassed Jarvis and queried `gemini`.
- **Response:** HTTP 200, `meta.providerUsed="gemini"`, `meta.crossChecked=false`, `meta.degraded=false`. Latency: ~5,060 ms.

### Test B: All Provider Keys Blanked (`JARVISLABS_API_KEY=""`, `GEMINI_API_KEY=""`)

- **Action:** Cleared all provider keys in `.env`.
- **Text Mode:** `pnpm smoke` sent text query `"plastic water bottle"`. Instant match answered from static rules table (`meta.source="table"`, `meta.providerUsed=null`, HTTP 200, 34 ms). Offline-first design holds.
- **Image Mode:** `pnpm smoke -- test-fixtures/plastic_bottle.jpg` returned HTTP 503 `PROVIDERS_UNAVAILABLE` with user-friendly error payload:
  ```json
  {
    "code": "PROVIDERS_UNAVAILABLE",
    "message": "Vision providers are temporarily unavailable. Please try typing the item name instead.",
    "requestId": "..."
  }
  ```
  No internal stack traces or configuration secrets were exposed.

---

## 7. Working Environment Variable Reference

_(Names and non-secret operational parameters only; keys omitted)_

```bash
# Provider Sequence
PROVIDER_ORDER=jarvis,gemini,gemma_gemini

# Jarvis Labs (OpenAI-Compatible Gemma 4)
JARVISLABS_BASE_URL=https://models.jarvislabs.net/v1
JARVISLABS_MODEL=gemma-4-31b-it
JARVIS_MAX_TOKENS=1024
JARVIS_EXTRA_BODY_JSON={"enable_thinking":false}

# Google Gemini (@google/genai SDK)
GEMINI_MODEL_PRIMARY=gemini-2.5-flash
GEMINI_MODEL_ESCALATION=gemini-3.5-flash
GEMMA_GEMINI_MODEL=gemma-4-31b-it

# Routing and Resilience Safeguards
CROSS_CHECK_ENABLED=true
BREAKER_COOLDOWN_MS=60000
RATE_LIMIT_PER_MINUTE=20
MAX_TEXT_LENGTH=120
REQUEST_TIMEOUT_MS=15000
MAX_UPLOAD_BYTES=1048576
```

---

## 8. Latency Benchmarks (Real Network Runs)

| Scenario                                   | Measured Latency    | Source / Provider                     |
| :----------------------------------------- | :------------------ | :------------------------------------ |
| Text fast-path (Exact match)               | 1 ms – 45 ms        | Static Rules Table (`packages/rules`) |
| Image classification (Jarvis primary)      | 1,335 ms – 2,728 ms | Jarvis Labs (`gemma-4-31b-it`)        |
| Image classification (Gemini fallback)     | 2,214 ms – 5,060 ms | Google Gemini (`gemini-2.5-flash`)    |
| Dual-model cross-check (Hazardous battery) | 4,414 ms – 6,114 ms | Jarvis + Gemini in series             |
| Graceful degradation (No keys available)   | 3 ms                | Local 503 Handler                     |

---

## 9. Contract & Integration Test Status

All contract and unit tests pass:

- `api/test/classify.test.ts`: Live adapter contract tests against Google AI Studio and Jarvis Labs pass schema validation.
- `apps/web/test/security.test.ts`: Zero secret leaks verified against client bundle and environment.
- Test suite total: **133 tests passing across 16 test files** (0 skipped; including both live adapter contract tests).
