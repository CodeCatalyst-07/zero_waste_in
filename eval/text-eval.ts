import rulesJson from '../packages/rules/src/rules.json' with { type: 'json' };
import { decide } from '../packages/rules/src/decide.js';
import { lookupByText } from '../packages/rules/src/lookup.js';
import type { Attributes, RuleRow, RulesDataset } from '../packages/rules/src/types.js';

interface EvalResult {
  query: string;
  sourceRowId: string;
  basis: string;
  expectedStream: string | null;
  expectedKind: 'answer' | 'ask' | 'unclear';
  actualKind: string;
  actualStream: string | null;
  matchedRowId: string | null;
  passed: boolean;
}

export function runTextEvaluation(): {
  results: EvalResult[];
  definitionAccuracy: number;
  overallAccuracy: number;
  streamBreakdown: Record<string, { total: number; passed: number }>;
} {
  const dataset = rulesJson as unknown as RulesDataset;
  const rules = dataset.rules;
  const results: EvalResult[] = [];

  for (const row of rules) {
    const expectedKind: 'answer' | 'ask' | 'unclear' = row.followUp
      ? 'ask'
      : row.stream === null
        ? 'unclear'
        : 'answer';
    const expectedStream = row.stream;

    const queriesToTest = [
      { text: row.label, type: 'label' },
      ...row.aliases.map((alias) => ({ text: alias, type: 'alias' })),
    ];

    for (const q of queriesToTest) {
      const candidates = lookupByText(q.text, rules);
      if (candidates.length === 0) {
        results.push({
          query: q.text,
          sourceRowId: row.id,
          basis: row.basis,
          expectedStream,
          expectedKind,
          actualKind: 'none',
          actualStream: null,
          matchedRowId: null,
          passed: false,
        });
        continue;
      }

      const winningCandidate = candidates[0]!;
      const winningRow = winningCandidate.row;

      const attrs: Attributes = {
        item: winningRow.id,
        isSharp: winningRow.flags.includes('wrap_before_disposal') && winningRow.stream === 'special_care',
        isBattery: winningRow.flags.includes('separate_regime_battery'),
        isBulb: winningRow.id.includes('bulb') || winningRow.id.includes('light'),
        isMedicine: winningRow.flags.includes('no_dosing_advice'),
        isChemical:
          winningRow.id.includes('chemical') ||
          winningRow.id.includes('paint') ||
          winningRow.id.includes('pesticide'),
        isElectronic: winningRow.flags.includes('separate_regime_ewaste'),
        isHygiene: winningRow.stream === 'sanitary',
        isFood:
          winningRow.stream === 'wet' &&
          (winningRow.id.includes('food') || winningRow.id.includes('peel') || winningRow.id.includes('scrap')),
        isGarden: winningRow.stream === 'wet' && (winningRow.id.includes('garden') || winningRow.id.includes('leaf')),
        evidence: [`Eval query: ${q.text}`],
        confidence: 1.0,
      };

      const verdict = decide(attrs, rules);
      const actualKind = verdict.kind;
      const actualStream = verdict.kind === 'answer' ? verdict.stream : null;

      let passed = false;
      if (expectedKind === 'ask' && actualKind === 'ask') {
        passed = winningRow.id === row.id;
      } else if (expectedKind === 'unclear' && actualKind === 'unclear') {
        passed = winningRow.id === row.id;
      } else if (expectedKind === 'answer' && actualKind === 'answer') {
        passed = actualStream === expectedStream && winningRow.id === row.id;
      }

      results.push({
        query: q.text,
        sourceRowId: row.id,
        basis: row.basis,
        expectedStream,
        expectedKind,
        actualKind,
        actualStream,
        matchedRowId: winningRow.id,
        passed,
      });
    }
  }

  // Calculate statistics
  const definitionResults = results.filter((r) => r.basis === 'definition');
  const definitionPassed = definitionResults.filter((r) => r.passed).length;
  const definitionAccuracy = (definitionPassed / definitionResults.length) * 100;

  const totalPassed = results.filter((r) => r.passed).length;
  const overallAccuracy = (totalPassed / results.length) * 100;

  const streamBreakdown: Record<string, { total: number; passed: number }> = {};
  for (const r of results) {
    const key = r.expectedKind === 'ask' ? 'ask_followup' : (r.expectedStream ?? 'unclear');
    if (!streamBreakdown[key]) {
      streamBreakdown[key] = { total: 0, passed: 0 };
    }
    streamBreakdown[key]!.total++;
    if (r.passed) {
      streamBreakdown[key]!.passed++;
    }
  }

  return {
    results,
    definitionAccuracy,
    overallAccuracy,
    streamBreakdown,
  };
}

if (process.argv[1]?.endsWith('text-eval.ts')) {
  console.log('===========================================================');
  console.log('ZeroWasteIN Text Evaluation Harness (lookupByText + decide)');
  console.log('===========================================================');

  const { results, definitionAccuracy, overallAccuracy, streamBreakdown } = runTextEvaluation();

  console.log('\nPer-Stream Accuracy Table:');
  console.log('-----------------------------------------------------------');
  console.log('Stream / Category      Total    Passed    Accuracy');
  console.log('-----------------------------------------------------------');
  for (const [stream, stats] of Object.entries(streamBreakdown)) {
    const pct = ((stats.passed / stats.total) * 100).toFixed(1);
    console.log(
      `${stream.padEnd(22)} ${String(stats.total).padStart(5)}    ${String(stats.passed).padStart(6)}    ${pct.padStart(6)}%`
    );
  }
  console.log('-----------------------------------------------------------');
  console.log(
    `Overall Accuracy:       ${results.length} queries: ${overallAccuracy.toFixed(1)}%`
  );
  console.log(
    `Definition Accuracy:    ${results.filter((r) => r.basis === 'definition').length} queries: ${definitionAccuracy.toFixed(1)}%`
  );
  console.log('===========================================================');

  if (definitionAccuracy < 100) {
    console.error('\n❌ FAILURE: Definition-basis rows must have 100% accuracy!');
    const failures = results.filter((r) => r.basis === 'definition' && !r.passed);
    for (const f of failures.slice(0, 10)) {
      console.error(
        `   - Query "${f.query}" for row ${f.sourceRowId}: expected ${f.expectedKind} (${f.expectedStream}), got ${f.actualKind} (${f.actualStream}) on row ${f.matchedRowId}`
      );
    }
    process.exit(1);
  } else {
    console.log('\n✅ SUCCESS: 100% accuracy on definition-basis rows.');
    process.exit(0);
  }
}
