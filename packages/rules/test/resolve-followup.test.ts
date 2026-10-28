import { describe, expect, it } from 'vitest';
import { decide, resolveFollowUp } from '../src/decide.js';
import { rulesTable } from '../src/index.js';
import type { Attributes, Verdict } from '../src/types.js';

describe('packages/rules resolveFollowUp', () => {
  const followUpRows = rulesTable.rules.filter((r) => r.followUp !== undefined);

  it('verifies rules table contains the expected 3 rows with followUp questions', () => {
    expect(followUpRows.map((r) => r.id)).toEqual([
      'used_tissue_and_paper_napkins',
      'used_bandages_plasters_cotton',
      'aerosol_cans',
    ]);
  });

  describe.each(followUpRows)('Table-driven row followUp: $id', (row) => {
    const defaultAttributes: Attributes = {
      item: row.id,
      isSharp: false,
      isBattery: false,
      isBulb: false,
      isMedicine: false,
      isChemical: false,
      isElectronic: false,
      isHygiene: false,
      isFood: false,
      isGarden: false,
      evidence: ['testing followUp'],
      confidence: 0.95,
    };

    it(`decides to ask a followUp question for "${row.id}"`, () => {
      const initialVerdict = decide(defaultAttributes, rulesTable.rules);
      expect(initialVerdict.kind).toBe('ask');
      if (initialVerdict.kind !== 'ask') return;
      expect(initialVerdict.rowId).toBe(row.id);
      expect(initialVerdict.question).toBe(row.followUp!.question);
      expect(initialVerdict.options).toHaveLength(row.followUp!.options.length);
    });

    row.followUp!.options.forEach((expectedOption, optionIndex) => {
      it(`resolves option ${optionIndex} ("${expectedOption.label}") to stream "${expectedOption.stream}"`, () => {
        const initialVerdict = decide(defaultAttributes, rulesTable.rules);
        expect(initialVerdict.kind).toBe('ask');
        if (initialVerdict.kind !== 'ask') return;

        const resolved = resolveFollowUp(initialVerdict, optionIndex, rulesTable.rules);

        if (expectedOption.stream === null) {
          expect(resolved.kind).toBe('unclear');
          if (resolved.kind === 'unclear') {
            expect(resolved.itemLabel).toBe(row.label);
            expect(resolved.guidance).toBeDefined();
          }
        } else {
          expect(resolved.kind).toBe('answer');
          if (resolved.kind === 'answer') {
            expect(resolved.stream).toBe(expectedOption.stream);
            expect(resolved.itemLabel).toBe(row.label);
            expect(resolved.reason).toBe(row.reason);
            expect(resolved.action).toBe(row.action);
            expect(resolved.flags).toEqual(row.flags);
            expect(resolved.confidenceBand).toBe('high');
            expect(resolved.source).toBe('table');
            expect(resolved.rowId).toBe(row.id);
          }
        }
      });
    });
  });

  describe('Generic low-confidence ask resolution', () => {
    const lowConfidenceAttributes: Attributes = {
      item: 'unknown_household_object',
      isSharp: false,
      isBattery: false,
      isBulb: false,
      isMedicine: false,
      isChemical: false,
      isElectronic: false,
      isHygiene: false,
      isFood: false,
      isGarden: false,
      evidence: ['fuzzy image'],
      confidence: 0.35, // Below CONFIDENCE_ASK (0.50)
    };

    it('produces a generic hazard clarification ask verdict when confidence is low', () => {
      const askVerdict = decide(lowConfidenceAttributes, rulesTable.rules);
      expect(askVerdict.kind).toBe('ask');
      if (askVerdict.kind !== 'ask') return;

      expect(askVerdict.reasonId).toBe('low_confidence');
      expect(askVerdict.question).toBe('Does it contain a battery, medicine or sharp edge?');
      expect(askVerdict.options).toEqual([
        { label: 'Yes, hazard present', stream: 'special_care' },
        { label: 'No hazard', stream: null },
      ]);
    });

    it('resolves option 0 ("Yes, hazard present") to special_care answer', () => {
      const askVerdict = decide(lowConfidenceAttributes, rulesTable.rules);
      expect(askVerdict.kind).toBe('ask');
      if (askVerdict.kind !== 'ask') return;

      const resolved = resolveFollowUp(askVerdict, 0, rulesTable.rules);
      expect(resolved.kind).toBe('answer');
      if (resolved.kind === 'answer') {
        expect(resolved.stream).toBe('special_care');
        expect(resolved.confidenceBand).toBe('high');
        expect(resolved.source).toBe('attributes');
      }
    });

    it('resolves option 1 ("No hazard") with stream null to unclear verdict', () => {
      const askVerdict = decide(lowConfidenceAttributes, rulesTable.rules);
      expect(askVerdict.kind).toBe('ask');
      if (askVerdict.kind !== 'ask') return;

      const resolved = resolveFollowUp(askVerdict, 1, rulesTable.rules);
      expect(resolved.kind).toBe('unclear');
      if (resolved.kind === 'unclear') {
        expect(resolved.guidance).toMatch(/rules don't clearly cover this/i);
      }
    });

    it('throws when resolving a verdict whose kind is not "ask"', () => {
      const answerVerdict: Verdict = {
        kind: 'answer',
        stream: 'wet',
        itemLabel: 'Banana peel',
        reason: 'Organic waste decomposes naturally.',
        action: 'Put in wet bin.',
        flags: [],
        confidenceBand: 'high',
        source: 'table',
        rowId: 'banana_peel',
      };

      expect(() => resolveFollowUp(answerVerdict, 0, rulesTable.rules)).toThrow(
        /Cannot resolve follow-up for verdict kind/
      );
    });

    it('throws when optionIndex is out of range', () => {
      const askVerdict = decide(lowConfidenceAttributes, rulesTable.rules);
      expect(() => resolveFollowUp(askVerdict, 99, rulesTable.rules)).toThrow(
        /Invalid follow-up option index 99/
      );
    });
  });
});
