import fs from 'node:fs';
import path from 'node:path';
import rulesJson from '../packages/rules/src/rules.json' with { type: 'json' };
import type { RulesDataset } from '../packages/rules/src/types.js';

interface ImageEvalItem {
  filePath: string;
  expectedRowId: string;
  expectedStream: string | null;
  expectedKind: 'answer' | 'ask' | 'unclear';
  isHazard: boolean;
}

interface ImageEvalRun {
  item: ImageEvalItem;
  statusCode: number;
  verdictKind: string;
  actualStream: string | null;
  matchedItemLabel: string;
  latencyMs: number;
  passed: boolean;
}

async function runImageEvaluation(): Promise<void> {
  const imagesDir = path.resolve(process.cwd(), 'eval/images');
  if (!fs.existsSync(imagesDir)) {
    console.log('ℹ️  Directory eval/images does not exist.');
    console.log('Skipping image evaluation (no photos to evaluate).');
    return;
  }

  const dataset = rulesJson as unknown as RulesDataset;
  const rulesMap = new Map(dataset.rules.map((r) => [r.id, r]));

  // Discover all images in eval/images/<row_id>/*.jpg
  const testItems: ImageEvalItem[] = [];
  const rowFolders = fs.readdirSync(imagesDir, { withFileTypes: true });

  for (const folder of rowFolders) {
    if (!folder.isDirectory()) continue;
    const rowId = folder.name;
    const ruleRow = rulesMap.get(rowId);
    if (!ruleRow) {
      console.warn(`⚠️  Row ID "${rowId}" in eval/images does not exist in rules.json.`);
      continue;
    }

    const folderPath = path.join(imagesDir, rowId);
    const files = fs.readdirSync(folderPath);
    for (const f of files) {
      if (/\.(jpg|jpeg|png|webp)$/i.test(f)) {
        testItems.push({
          filePath: path.join(folderPath, f),
          expectedRowId: rowId,
          expectedStream: ruleRow.stream,
          expectedKind: ruleRow.followUp ? 'ask' : ruleRow.stream === null ? 'unclear' : 'answer',
          isHazard: ruleRow.stream === 'special_care',
        });
      }
    }
  }

  if (testItems.length === 0) {
    console.log('ℹ️  No test images found in eval/images/<row_id>/*.jpg');
    console.log('Skipping image evaluation. To add evaluation photos, consult eval/README.md.');
    return;
  }

  console.log(`===========================================================`);
  console.log(`ZeroWasteIN Multimodal Vision Evaluation`);
  console.log(`Discovered ${testItems.length} test photos across categories.`);
  console.log(`Endpoint: http://localhost:5173/api/classify`);
  console.log(`===========================================================`);

  const results: ImageEvalRun[] = [];

  for (let i = 0; i < testItems.length; i++) {
    const item = testItems[i]!;
    const imageBuffer = fs.readFileSync(item.filePath);
    const base64 = imageBuffer.toString('base64');
    const ext = path.extname(item.filePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    const t0 = Date.now();
    try {
      const response = await fetch('http://localhost:5173/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'image', image: base64, mimeType }),
      });

      const latencyMs = Date.now() - t0;
      const data = (await response.json()) as any;

      if (!response.ok) {
        results.push({
          item,
          statusCode: response.status,
          verdictKind: 'error',
          actualStream: null,
          matchedItemLabel: data.error?.message ?? 'API Error',
          latencyMs,
          passed: false,
        });
        continue;
      }

      const verdict = data.verdict;
      const actualStream = verdict?.kind === 'answer' ? verdict.stream : null;
      let passed = false;
      if (item.expectedKind === 'ask' && verdict.kind === 'ask') {
        passed = true;
      } else if (item.expectedKind === 'unclear' && verdict.kind === 'unclear') {
        passed = true;
      } else if (item.expectedKind === 'answer' && verdict.kind === 'answer') {
        passed = actualStream === item.expectedStream;
      }

      results.push({
        item,
        statusCode: 200,
        verdictKind: verdict.kind,
        actualStream,
        matchedItemLabel: data.itemLabel ?? '',
        latencyMs,
        passed,
      });

      console.log(
        `[${i + 1}/${testItems.length}] ${path.basename(item.filePath)} (${item.expectedRowId}): ${passed ? '✓' : '✗'} [${verdict.kind} -> ${actualStream ?? '-'}] (${latencyMs}ms)`
      );
    } catch (err: any) {
      console.error(`Error classifying ${item.filePath}:`, err.message);
      results.push({
        item,
        statusCode: 500,
        verdictKind: 'network_failure',
        actualStream: null,
        matchedItemLabel: err.message,
        latencyMs: Date.now() - t0,
        passed: false,
      });
    }
  }

  // Calculate metrics
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const accuracy = (passed / total) * 100;

  const hazards = results.filter((r) => r.item.isHazard);
  const hazardHits = hazards.filter((r) => r.actualStream === 'special_care').length;
  const hazardRecall = hazards.length > 0 ? (hazardHits / hazards.length) * 100 : 100;

  const askFollowUps = results.filter((r) => r.verdictKind === 'ask').length;
  const followUpRate = (askFollowUps / total) * 100;

  const avgLatency = Math.round(results.reduce((acc, r) => acc + r.latencyMs, 0) / total);

  // Per-stream accuracy
  const streamMap: Record<string, { total: number; passed: number }> = {};
  for (const r of results) {
    const key = r.item.expectedStream ?? 'unclear';
    if (!streamMap[key]) streamMap[key] = { total: 0, passed: 0 };
    streamMap[key]!.total++;
    if (r.passed) streamMap[key]!.passed++;
  }

  console.log('\n===========================================================');
  console.log(`Image Evaluation Summary`);
  console.log(`-----------------------------------------------------------`);
  console.log(`Overall Accuracy:   ${passed}/${total} (${accuracy.toFixed(1)}%)`);
  console.log(`Hazard Recall:      ${hazardHits}/${hazards.length} (${hazardRecall.toFixed(1)}%)`);
  console.log(`Follow-up Rate:     ${askFollowUps}/${total} (${followUpRate.toFixed(1)}%)`);
  console.log(`Mean Latency:       ${avgLatency} ms`);
  console.log('===========================================================');

  // Write eval/RESULTS.md
  let markdown = `# Image Evaluation Results\n\n`;
  markdown += `*Generated: ${new Date().toISOString()}*\n\n`;
  markdown += `## Summary Metrics\n\n`;
  markdown += `- **Total Photos Tested:** ${total}\n`;
  markdown += `- **Overall Accuracy:** ${accuracy.toFixed(1)}% (${passed}/${total})\n`;
  markdown += `- **Hazard Recall (Special Care):** ${hazardRecall.toFixed(1)}% (${hazardHits}/${hazards.length})\n`;
  markdown += `- **Follow-up Question Rate:** ${followUpRate.toFixed(1)}% (${askFollowUps}/${total})\n`;
  markdown += `- **Mean Latency:** ${avgLatency} ms\n\n`;
  markdown += `## Per-Stream Breakdown\n\n`;
  markdown += `| Stream | Total | Correct | Accuracy |\n`;
  markdown += `| :--- | :--- | :--- | :--- |\n`;
  for (const [st, stats] of Object.entries(streamMap)) {
    const acc = ((stats.passed / stats.total) * 100).toFixed(1);
    markdown += `| \`${st}\` | ${stats.total} | ${stats.passed} | ${acc}% |\n`;
  }
  markdown += `\n## Detailed Observations\n\n`;
  markdown += `| File | Expected Row | Expected Stream | Model Stream | Verdict Kind | Latency |\n`;
  markdown += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
  for (const r of results) {
    markdown += `| \`${path.basename(r.item.filePath)}\` | \`${r.item.expectedRowId}\` | \`${r.item.expectedStream ?? 'unclear'}\` | \`${r.actualStream ?? '-'}\` | \`${r.verdictKind}\` | ${r.latencyMs}ms |\n`;
  }

  const resultsPath = path.resolve(process.cwd(), 'eval/RESULTS.md');
  fs.writeFileSync(resultsPath, markdown, 'utf-8');
  console.log(`\n📄 Written detailed report to ${resultsPath}`);
}

runImageEvaluation().catch((err) => {
  console.error('Fatal image evaluation error:', err);
  process.exit(1);
});
