import { describe, expect, it } from 'vitest';
import {
  COMMON_ITEM_IDS,
  CONFIDENCE_ASK,
  CONFIDENCE_HIGH,
  ITEM_IDS,
  decide,
  describeStream,
  findMatchingRow,
  lookupByText,
  normalizeLabel,
  rulesTable,
} from '../src/index.js';
import type { Attributes, Flag, Stream } from '../src/index.js';

/** Deep freezes object graph to verify engine immutability and zero-mutation. */
function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj as object)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === 'object') {
      deepFreeze(val);
    }
  }
  return obj;
}

/** Constructs mock attributes with safe defaults. */
function createMockAttributes(overrides: Partial<Attributes> = {}): Attributes {
  return {
    item: 'unknown_item',
    isSharp: false,
    isBattery: false,
    isBulb: false,
    isMedicine: false,
    isChemical: false,
    isElectronic: false,
    isHygiene: false,
    isFood: false,
    isGarden: false,
    evidence: [],
    confidence: 0.9,
    ...overrides,
  };
}

describe('packages/rules engine', () => {
  // 1. Table integrity
  describe('1. Table integrity', () => {
    it('contains exactly 55 unique rows with valid snake_case IDs', () => {
      expect(rulesTable.rules.length).toBe(55);

      const ids = rulesTable.rules.map((r) => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(55);

      const snakeCaseRegex = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
      for (const id of ids) {
        expect(id, `Expected id "${id}" to match snake_case`).toMatch(snakeCaseRegex);
      }
    });

    it('has valid statutory streams, bases, and flags', () => {
      const validStreams = new Set<Stream | null>(['wet', 'dry', 'sanitary', 'special_care', null]);
      const validBases = new Set(['definition', 'separate_regime', 'judgement', 'conflict']);
      const validFlags = new Set<Flag>([
        'rules_vary_by_city',
        'separate_regime_ewaste',
        'separate_regime_battery',
        'conflicting_sources',
        'review_before_launch',
        'wrap_before_disposal',
        'rinse_first',
        'no_dosing_advice',
        'fire_risk',
      ]);

      for (const row of rulesTable.rules) {
        expect(validStreams.has(row.stream), `Invalid stream on ${row.id}`).toBe(true);
        expect(validBases.has(row.basis), `Invalid basis on ${row.id}`).toBe(true);

        for (const flag of row.flags) {
          expect(validFlags.has(flag), `Invalid flag "${flag}" on ${row.id}`).toBe(true);
        }

        // non-null stream OR a followUp OR guidance on every row
        const hasStreamOrFollowUpOrGuidance =
          row.stream !== null || row.followUp !== undefined || Boolean(row.guidance);
        expect(
          hasStreamOrFollowUpOrGuidance,
          `Row ${row.id} must have non-null stream OR followUp OR guidance`
        ).toBe(true);
      }
    });

    it('enforces reason <= 20 words and action <= 20 words on every row', () => {
      for (const row of rulesTable.rules) {
        const reasonWords = row.reason.trim().split(/\s+/).filter(Boolean).length;
        expect(
          reasonWords,
          `Reason for ${row.id} exceeds 20 words (${reasonWords} words: "${row.reason}")`
        ).toBeLessThanOrEqual(20);

        const actionWords = row.action.trim().split(/\s+/).filter(Boolean).length;
        expect(
          actionWords,
          `Action for ${row.id} exceeds 20 words (${actionWords} words: "${row.action}")`
        ).toBeLessThanOrEqual(20);
      }
    });

    it('ensures every judgement or conflict row has review_before_launch flag', () => {
      for (const row of rulesTable.rules) {
        if (row.basis === 'judgement' || row.basis === 'conflict') {
          expect(
            row.flags.includes('review_before_launch'),
            `Row ${row.id} with basis "${row.basis}" must have "review_before_launch" flag`
          ).toBe(true);
        }
      }
    });

    it('ensures aliases are conservative (2-6 per row) and globally unique across all rows', () => {
      const seenAliases = new Map<string, string>();

      for (const row of rulesTable.rules) {
        expect(
          row.aliases.length,
          `Row ${row.id} must have between 2 and 6 aliases`
        ).toBeGreaterThanOrEqual(2);
        expect(
          row.aliases.length,
          `Row ${row.id} must have between 2 and 6 aliases`
        ).toBeLessThanOrEqual(6);

        for (const alias of row.aliases) {
          const norm = normalizeLabel(alias);
          expect(
            norm.length,
            `Alias "${alias}" in row ${row.id} is empty after normalization`
          ).toBeGreaterThan(0);

          if (seenAliases.has(norm)) {
            const conflictId = seenAliases.get(norm);
            expect.fail(
              `Duplicate alias "${alias}" (normalized "${norm}") found in rows "${conflictId}" and "${row.id}"`
            );
          }
          seenAliases.set(norm, row.id);
        }
      }
    });

    it('contains all 12 COMMON_ITEM_IDS in the table and in ITEM_IDS', () => {
      expect(COMMON_ITEM_IDS.length).toBe(12);
      expect(ITEM_IDS.length).toBe(55);

      for (const commonId of COMMON_ITEM_IDS) {
        const found = rulesTable.rules.some((r) => r.id === commonId);
        expect(found, `COMMON_ITEM_IDS item "${commonId}" must exist in rulesTable`).toBe(true);
        expect(ITEM_IDS.includes(commonId)).toBe(true);
      }
    });
  });

  // 2. Per-row decision test
  describe('2. Per-row decision test', () => {
    it('evaluates every row correctly per canonical table definition', () => {
      for (const row of rulesTable.rules) {
        const attributes = createMockAttributes({
          item: row.id,
          confidence: 0.9,
        });

        const verdict = decide(attributes, rulesTable.rules);

        if (row.followUp) {
          expect(verdict.kind, `Row ${row.id} with followUp should return ask`).toBe('ask');
          if (verdict.kind === 'ask') {
            expect(verdict.reasonId).toBe('row_follow_up');
            expect(verdict.rowId).toBe(row.id);
            expect(verdict.question).toBe(row.followUp.question);
            expect(verdict.options).toEqual(row.followUp.options);
          }
        } else if (row.stream === null) {
          expect(verdict.kind, `Row ${row.id} with stream null should return unclear`).toBe(
            'unclear'
          );
          if (verdict.kind === 'unclear') {
            expect(verdict.rowId).toBe(row.id);
            expect(verdict.itemLabel).toBe(row.label);
            expect(verdict.guidance).toBe(row.guidance);
          }
        } else {
          expect(verdict.kind, `Row ${row.id} with stream ${row.stream} should return answer`).toBe(
            'answer'
          );
          if (verdict.kind === 'answer') {
            expect(verdict.stream).toBe(row.stream);
            expect(verdict.rowId).toBe(row.id);
            expect(verdict.source).toBe('table');
            expect(verdict.confidenceBand).toBe('high');
            expect(verdict.action).toBe(row.action);
          }
        }
      }
    });
  });

  // 3. Precedence tests
  describe('3. Precedence rules', () => {
    it('special_care: battery that is also electronic maps to special_care', () => {
      const attributes = createMockAttributes({
        item: 'unknown_gadget',
        isBattery: true,
        isElectronic: true,
      });
      const verdict = decide(attributes);
      expect(verdict.kind).toBe('answer');
      if (verdict.kind === 'answer') {
        expect(verdict.stream).toBe('special_care');
      }
    });

    it('special_care: isMedicine hazard overrides isFood', () => {
      const attributes = createMockAttributes({
        item: 'cough_syrup',
        isMedicine: true,
        isFood: true,
      });
      const verdict = decide(attributes);
      expect(verdict.kind).toBe('answer');
      if (verdict.kind === 'answer') {
        expect(verdict.stream).toBe('special_care');
      }
    });

    it('hazard attribute overrides a table row that says dry', () => {
      const attributes = createMockAttributes({
        item: 'plastic_bottle', // Normally dry in table
        isBattery: true, // Hazard detected inside
      });
      const verdict = decide(attributes);
      expect(verdict.kind).toBe('answer');
      if (verdict.kind === 'answer') {
        expect(verdict.stream).toBe('special_care');
        expect(verdict.source).toBe('table');
        expect(verdict.rowId).toBe('plastic_bottle');
      }
    });

    it('attribute precedence: isHygiene beats isFood when no row matches', () => {
      const attributes = createMockAttributes({
        item: 'unmatched_item',
        isHygiene: true,
        isFood: true,
      });
      const verdict = decide(attributes);
      expect(verdict.kind).toBe('answer');
      if (verdict.kind === 'answer') {
        expect(verdict.stream).toBe('sanitary');
        expect(verdict.source).toBe('attributes');
      }
    });
  });

  // 4. Exhaustiveness (all 2^9 = 512 boolean combinations)
  describe('4. Exhaustiveness (512 boolean combinations)', () => {
    it('evaluates all 2^9 combinations cleanly without throwing or undefined', () => {
      const flags = [
        'isSharp',
        'isBattery',
        'isBulb',
        'isMedicine',
        'isChemical',
        'isElectronic',
        'isHygiene',
        'isFood',
        'isGarden',
      ] as const;

      for (let i = 0; i < 512; i++) {
        const overrides: Record<string, boolean | string | number> = {
          item: 'unknown_item',
          confidence: 0.9,
        };

        for (let bit = 0; bit < 9; bit++) {
          const flagName = flags[bit]!;
          overrides[flagName] = (i & (1 << bit)) !== 0;
        }

        const attributes = createMockAttributes(overrides as unknown as Partial<Attributes>);
        const verdict = decide(attributes);

        expect(verdict).toBeDefined();
        expect(verdict.kind).toBe('answer');

        if (verdict.kind === 'answer') {
          const hasHazard =
            attributes.isSharp ||
            attributes.isBattery ||
            attributes.isBulb ||
            attributes.isMedicine ||
            attributes.isChemical ||
            attributes.isElectronic;

          if (hasHazard) {
            expect(
              verdict.stream,
              `Combination ${i} has hazard but got stream ${verdict.stream}`
            ).toBe('special_care');
          } else if (attributes.isHygiene) {
            expect(verdict.stream).toBe('sanitary');
          } else if (attributes.isFood || attributes.isGarden) {
            expect(verdict.stream).toBe('wet');
          } else {
            expect(verdict.stream).toBe('dry');
          }
        }
      }
    });
  });

  // 5. Confidence policy
  describe('5. Confidence policy and disagreement handling', () => {
    it('returns ask with reasonId low_confidence when confidence is 0.49', () => {
      const attributes = createMockAttributes({
        item: 'plastic_bottle',
        confidence: 0.49,
      });
      const verdict = decide(attributes);
      expect(verdict.kind).toBe('ask');
      if (verdict.kind === 'ask') {
        expect(verdict.reasonId).toBe('low_confidence');
      }
    });

    it('returns answer with confidenceBand medium when confidence is 0.50', () => {
      const attributes = createMockAttributes({
        item: 'plastic_bottle',
        confidence: 0.5,
      });
      const verdict = decide(attributes);
      expect(verdict.kind).toBe('answer');
      if (verdict.kind === 'answer') {
        expect(verdict.confidenceBand).toBe('medium');
        expect(verdict.stream).toBe('dry');
      }
    });

    it('returns answer with confidenceBand medium when confidence is 0.79', () => {
      const attributes = createMockAttributes({
        item: 'plastic_bottle',
        confidence: 0.79,
      });
      const verdict = decide(attributes);
      expect(verdict.kind).toBe('answer');
      if (verdict.kind === 'answer') {
        expect(verdict.confidenceBand).toBe('medium');
      }
    });

    it('returns answer with confidenceBand high when confidence is 0.80', () => {
      const attributes = createMockAttributes({
        item: 'plastic_bottle',
        confidence: 0.8,
      });
      const verdict = decide(attributes);
      expect(verdict.kind).toBe('answer');
      if (verdict.kind === 'answer') {
        expect(verdict.confidenceBand).toBe('high');
      }
    });

    it('returns ask with reasonId model_disagreement when options.disagreement is true', () => {
      const attributes = createMockAttributes({
        item: 'plastic_bottle',
        confidence: 0.95,
      });
      const verdict = decide(attributes, rulesTable.rules, { disagreement: true });
      expect(verdict.kind).toBe('ask');
      if (verdict.kind === 'ask') {
        expect(verdict.reasonId).toBe('model_disagreement');
      }
    });

    it('verifies threshold constants export', () => {
      expect(CONFIDENCE_ASK).toBe(0.5);
      expect(CONFIDENCE_HIGH).toBe(0.8);
    });
  });

  // 6. Text lookup
  describe('6. Text lookup ranking and normalization', () => {
    it('matches exact id', () => {
      const candidates = lookupByText('plastic_bottle', rulesTable.rules);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]?.row.id).toBe('plastic_bottle');
      expect(candidates[0]?.score).toBe(100);
    });

    it('matches alias', () => {
      const candidates = lookupByText('cfl', rulesTable.rules);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]?.row.id).toBe('tube_light');
      expect(candidates[0]?.score).toBe(90);
    });

    it('matches case, spacing, and punctuation variants', () => {
      const candidates = lookupByText('  PlAsTiC... BoTtLeS??  ', rulesTable.rules);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]?.row.id).toBe('plastic_bottle');
    });

    it('returns ranked candidates for partial queries and preserves tie-break determinism', () => {
      const candidates = lookupByText('bottle', rulesTable.rules);
      expect(candidates.length).toBeGreaterThan(1);
      // Deterministically sorted
      for (let i = 0; i < candidates.length - 1; i++) {
        expect(candidates[i]!.score).toBeGreaterThanOrEqual(candidates[i + 1]!.score);
      }
    });

    it('returns empty array when query does not match any entry', () => {
      const candidates = lookupByText('xyzrandomunmatchedquery999', rulesTable.rules);
      expect(candidates).toEqual([]);
    });
  });

  // 7. Safety and copy checks across all user-facing strings
  describe('7. Safety, copy, and regulatory compliance checks', () => {
    const forbiddenRuleNumber = /(?:^|\b)rule\s*\d+/i;
    const forbiddenDosing = /\b(dose|dosing|dosage|mg|milligram|flush|flushing)\b/i;
    const forbiddenMarketing =
      /\b(india'?s?\s+first|the\s+first\s+app|the\s+only\s+app|the\s+only\s+solution|world'?s?\s+first)\b/i;

    it('contains no rule number patterns in any user-facing text', () => {
      for (const row of rulesTable.rules) {
        expect(row.label).not.toMatch(forbiddenRuleNumber);
        expect(row.reason).not.toMatch(forbiddenRuleNumber);
        expect(row.action).not.toMatch(forbiddenRuleNumber);
        if (row.guidance) {
          expect(row.guidance).not.toMatch(forbiddenRuleNumber);
        }
        if (row.followUp) {
          expect(row.followUp.question).not.toMatch(forbiddenRuleNumber);
          for (const opt of row.followUp.options) {
            expect(opt.label).not.toMatch(forbiddenRuleNumber);
            if (opt.message) {
              expect(opt.message).not.toMatch(forbiddenRuleNumber);
            }
          }
        }
      }
    });

    it('contains no medical dosing or flush disposal advice', () => {
      for (const row of rulesTable.rules) {
        expect(row.reason).not.toMatch(forbiddenDosing);
        expect(row.action).not.toMatch(forbiddenDosing);
        if (row.guidance) {
          expect(row.guidance).not.toMatch(forbiddenDosing);
        }
      }
    });

    it('contains no first/only marketing claims', () => {
      for (const row of rulesTable.rules) {
        expect(row.reason).not.toMatch(forbiddenMarketing);
        expect(row.action).not.toMatch(forbiddenMarketing);
      }
    });

    it('does not use bin color names as stream answers', () => {
      const colorStreamPattern = /\b(bin is green|bin is blue|bin is red|bin is black)\b/i;
      for (const row of rulesTable.rules) {
        expect(row.reason).not.toMatch(colorStreamPattern);
        expect(row.action).not.toMatch(colorStreamPattern);
      }
    });
  });

  // 8. Determinism and immutability
  describe('8. Determinism and immutability', () => {
    it('returns deep-equal output when called twice with deep-equal input', () => {
      const attributes1 = createMockAttributes({
        item: 'newspaper_paper',
        confidence: 0.85,
      });
      const attributes2 = createMockAttributes({
        item: 'newspaper_paper',
        confidence: 0.85,
      });

      const res1 = decide(attributes1);
      const res2 = decide(attributes2);

      expect(res1).toEqual(res2);
    });

    it('does not mutate input attributes or rule table (deep freeze test)', () => {
      const attributes = deepFreeze(
        createMockAttributes({
          item: 'vegetable_peels',
          isFood: true,
          confidence: 0.95,
          evidence: Object.freeze(['fresh peel']),
        })
      );

      const frozenTable = deepFreeze(rulesTable.rules);

      expect(() => decide(attributes, frozenTable)).not.toThrow();
    });
  });

  // 9. Snapshot test
  describe('9. Canonical rules snapshot', () => {
    it('matches canonical rules dataset snapshot', () => {
      expect(rulesTable).toMatchSnapshot();
    });
  });

  // 10. Exhaustive Stream helper verification
  describe('10. Exhaustive Stream helper verification', () => {
    it('describes each statutory stream with complete coverage', () => {
      const streams: Stream[] = ['wet', 'dry', 'sanitary', 'special_care'];
      for (const s of streams) {
        const desc = describeStream(s);
        expect(desc.length).toBeGreaterThan(10);
      }
    });
  });

  describe('11. Edge cases and clarification coverage', () => {
    it('builds specific clarification questions for low-confidence hazard and organic items', () => {
      const foodAsk = decide(createMockAttributes({ isFood: true, confidence: 0.4, item: '' }));
      expect(foodAsk.kind).toBe('ask');
      if (foodAsk.kind === 'ask') {
        expect(foodAsk.question).toContain('food waste');
      }

      const gardenAsk = decide(createMockAttributes({ isGarden: true, confidence: 0.4, item: '' }));
      expect(gardenAsk.kind).toBe('ask');
      if (gardenAsk.kind === 'ask') {
        expect(gardenAsk.question).toContain('garden');
      }

      const hygieneAsk = decide(createMockAttributes({ isHygiene: true, confidence: 0.4, item: '' }));
      expect(hygieneAsk.kind).toBe('ask');
      if (hygieneAsk.kind === 'ask') {
        expect(hygieneAsk.question).toContain('sanitary');
      }

      const sharpAsk = decide(createMockAttributes({ isSharp: true, confidence: 0.4, item: '' }));
      expect(sharpAsk.kind).toBe('ask');
      if (sharpAsk.kind === 'ask') {
        expect(sharpAsk.question).toContain('sharp');
      }

      const chemicalAsk = decide(createMockAttributes({ isChemical: true, confidence: 0.4, item: '' }));
      expect(chemicalAsk.kind).toBe('ask');
      if (chemicalAsk.kind === 'ask') {
        expect(chemicalAsk.question).toContain('chemicals');
      }

      const bulbAsk = decide(createMockAttributes({ isBulb: true, confidence: 0.4, item: '' }));
      expect(bulbAsk.kind).toBe('ask');
      if (bulbAsk.kind === 'ask') {
        expect(bulbAsk.question).toContain('bulb');
      }

      const electronicAsk = decide(createMockAttributes({ isElectronic: true, confidence: 0.4, item: '' }));
      expect(electronicAsk.kind).toBe('ask');
      if (electronicAsk.kind === 'ask') {
        expect(electronicAsk.question).toContain('electronic');
      }
    });

    it('falls back to attribute precedence when no row matches', () => {
      const foodVerdict = decide(createMockAttributes({ isFood: true, confidence: 0.9, item: 'unknown_organic_matter' }));
      expect(foodVerdict.kind).toBe('answer');
      if (foodVerdict.kind === 'answer') {
        expect(foodVerdict.stream).toBe('wet');
      }

      const gardenVerdict = decide(createMockAttributes({ isGarden: true, confidence: 0.9, item: 'unknown_tree_cutting' }));
      expect(gardenVerdict.kind).toBe('answer');
      if (gardenVerdict.kind === 'answer') {
        expect(gardenVerdict.stream).toBe('wet');
      }

      const hygieneVerdict = decide(createMockAttributes({ isHygiene: true, confidence: 0.9, item: 'unknown_absorbent_pad' }));
      expect(hygieneVerdict.kind).toBe('answer');
      if (hygieneVerdict.kind === 'answer') {
        expect(hygieneVerdict.stream).toBe('sanitary');
      }
    });

    it('tests all branches of findMatchingRow and lookupByText', () => {
      // Empty and punctuation strings
      expect(normalizeLabel('   ')).toBe('');
      expect(normalizeLabel('???!!!')).toBe('');
      expect(lookupByText('   ', rulesTable.rules)).toEqual([]);
      expect(lookupByText('???!!!', rulesTable.rules)).toEqual([]);

      // Normalized id, label, and alias matching
      const normIdRow = findMatchingRow('vegetable-peels', rulesTable.rules);
      expect(normIdRow).toBeDefined();
      expect(normIdRow?.id).toBe('vegetable_peels');

      const normLabelRow = findMatchingRow('Vegetable and fruit peels', rulesTable.rules);
      expect(normLabelRow).toBeDefined();

      const normAliasRow = findMatchingRow('banana peel', rulesTable.rules);
      expect(normAliasRow).toBeDefined();

      expect(findMatchingRow('???!!!', rulesTable.rules)).toBeNull();
      expect(findMatchingRow('completely unknown object xyz 999', rulesTable.rules)).toBeNull();

      // Prefix match on alias
      const aliasPrefixCandidates = lookupByText('banana p', rulesTable.rules);
      expect(aliasPrefixCandidates.length).toBeGreaterThan(0);
      expect(aliasPrefixCandidates[0]!.row.id).toBe('vegetable_peels');

      // Exact label match
      const exactLabelCandidates = lookupByText('Vegetable and fruit peels', rulesTable.rules);
      expect(exactLabelCandidates.length).toBeGreaterThan(0);
      expect(exactLabelCandidates[0]!.score).toBeGreaterThanOrEqual(95);

      // Exhaustive default check for describeStream
      expect(() => describeStream('unknown_stream' as any)).toThrow();
    });
  });
});
