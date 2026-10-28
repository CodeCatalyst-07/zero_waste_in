# ZeroWasteIN Evaluation Suite

This directory contains evaluation benchmarks for ZeroWasteIN's text lookup and multimodal vision classification pipelines under India's Solid Waste Management (SWM) Rules 2026.

---

## 1. Text Evaluation (`pnpm eval:text`)

Runs entirely offline in CI with zero network dependencies.

- Pushes every canonical rule row label and alias (300+ queries) through `lookupByText()` and `decide()`.
- Validates the resulting verdict against statutory stream and follow-up requirements.
- Strictly asserts **100% accuracy on definition-basis rows** (fails CI on any mismatch).

Run:
```bash
pnpm eval:text
```

---

## 2. Image Evaluation (`pnpm eval:image`)

Manual evaluation harness for testing multimodal vision providers against real-world photographs of household waste.

### Adding Test Photos
1. Choose or identify the canonical `row_id` from [`packages/rules/src/rules.json`](../packages/rules/src/rules.json) (e.g., `vegetable_peels`, `used_dry_cells`, `plastic_bottles_pet`).
2. Create a folder matching the `row_id` inside `eval/images/`:
   ```bash
   mkdir -p eval/images/<row_id>
   ```
3. Place real JPEG, PNG, or WebP photographs into that folder:
   ```bash
   cp ~/Downloads/my_battery.jpg eval/images/used_dry_cells/battery_01.jpg
   ```

### Running Image Evaluation
Ensure the local development server is running (`pnpm dev` at `http://localhost:5173`), then run:
```bash
pnpm eval:image
```

The script will:
- Process every discovered photo.
- Compute overall accuracy, hazard recall (for `special_care` items), and follow-up question rate.
- Generate a real, non-invented evaluation report in [`eval/RESULTS.md`](./RESULTS.md).
- If `eval/images/` is empty or missing, it will gracefully skip without failing.
