import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Bundle Size Budget & Code-Splitting Verification.
 *
 * Enforces production build efficiency:
 * 1. Verifies lazy code-splitting for Footprint and Impact features.
 * 2. Compares entry JS and CSS against +20% gzip budget thresholds.
 */

// Budget thresholds (+20% allowance over current baseline)
// Baseline entry JS: 84.90 kB gzip -> Budget: 102.00 kB gzip
// Baseline entry CSS (Tailwind v4 compiled bundle): 14.12 kB gzip -> Budget: 18.00 kB gzip
const ENTRY_JS_GZIP_BUDGET_KB = 102.0;
const ENTRY_CSS_GZIP_BUDGET_KB = 18.0;

interface AssetMetrics {
  name: string;
  rawBytes: number;
  gzipBytes: number;
  rawKb: number;
  gzipKb: number;
}

export function analyzeBundle(): {
  assets: AssetMetrics[];
  entryJs?: AssetMetrics;
  entryCss?: AssetMetrics;
  hasLazyFootprint: boolean;
  hasLazyImpact: boolean;
  passed: boolean;
  errors: string[];
} {
  const distDir = path.resolve(process.cwd(), 'apps/web/dist/assets');
  if (!fs.existsSync(distDir)) {
    return {
      assets: [],
      hasLazyFootprint: false,
      hasLazyImpact: false,
      passed: false,
      errors: ['apps/web/dist/assets not found. Run "pnpm build" before running budget check.'],
    };
  }

  const files = fs.readdirSync(distDir);
  const assets: AssetMetrics[] = [];
  const errors: string[] = [];

  let entryJs: AssetMetrics | undefined;
  let entryCss: AssetMetrics | undefined;
  let hasLazyFootprint = false;
  let hasLazyImpact = false;

  for (const file of files) {
    if (!file.endsWith('.js') && !file.endsWith('.css')) continue;

    const filePath = path.join(distDir, file);
    const content = fs.readFileSync(filePath);
    const gzip = zlib.gzipSync(content);

    const metrics: AssetMetrics = {
      name: file,
      rawBytes: content.length,
      gzipBytes: gzip.length,
      rawKb: Number((content.length / 1024).toFixed(2)),
      gzipKb: Number((gzip.length / 1024).toFixed(2)),
    };
    assets.push(metrics);

    if (file.startsWith('index-') && file.endsWith('.js')) {
      entryJs = metrics;
    } else if (file.startsWith('index-') && file.endsWith('.css')) {
      entryCss = metrics;
    } else if (file.startsWith('FootprintScreen-') && file.endsWith('.js')) {
      hasLazyFootprint = true;
    } else if (file.startsWith('ImpactScreen-') && file.endsWith('.js')) {
      hasLazyImpact = true;
    }
  }

  // 1. Verify lazy loading chunks
  if (!hasLazyFootprint) {
    errors.push('FootprintScreen is NOT lazy-loaded! Missing separate Footprint chunk in dist/assets.');
  }
  if (!hasLazyImpact) {
    errors.push('ImpactScreen is NOT lazy-loaded! Missing separate Impact chunk in dist/assets.');
  }

  // 2. Verify Entry JS budget
  if (!entryJs) {
    errors.push('Could not find entry JS chunk (index-*.js) in dist/assets.');
  } else if (entryJs.gzipKb > ENTRY_JS_GZIP_BUDGET_KB) {
    errors.push(
      `Entry JS budget EXCEEDED: ${entryJs.gzipKb} kB gzip > budget ${ENTRY_JS_GZIP_BUDGET_KB} kB gzip.`
    );
  }

  // 3. Verify Entry CSS budget
  if (!entryCss) {
    errors.push('Could not find entry CSS chunk (index-*.css) in dist/assets.');
  } else if (entryCss.gzipKb > ENTRY_CSS_GZIP_BUDGET_KB) {
    errors.push(
      `Entry CSS budget EXCEEDED: ${entryCss.gzipKb} kB gzip > budget ${ENTRY_CSS_GZIP_BUDGET_KB} kB gzip.`
    );
  }

  return {
    assets,
    entryJs,
    entryCss,
    hasLazyFootprint,
    hasLazyImpact,
    passed: errors.length === 0,
    errors,
  };
}

if (process.argv[1]?.endsWith('check-bundle-budget.ts')) {
  console.log('===========================================================');
  console.log('ZeroWasteIN Bundle Size Budget & Code-Splitting Check');
  console.log('===========================================================');

  const report = analyzeBundle();

  console.log('\nGenerated Bundle Assets:');
  console.log('-----------------------------------------------------------');
  console.log('Asset File Name                     Raw Size      Gzip Size');
  console.log('-----------------------------------------------------------');
  for (const asset of report.assets) {
    console.log(
      `${asset.name.padEnd(35)} ${String(asset.rawKb).padStart(7)} kB   ${String(asset.gzipKb).padStart(7)} kB`
    );
  }
  console.log('-----------------------------------------------------------');

  console.log('\nBudget Verification:');
  if (report.entryJs) {
    console.log(
      `- Entry JS:   ${report.entryJs.gzipKb} kB gzip / budget ${ENTRY_JS_GZIP_BUDGET_KB} kB gzip (${report.entryJs.gzipKb <= ENTRY_JS_GZIP_BUDGET_KB ? 'PASS' : 'FAIL'})`
    );
  }
  if (report.entryCss) {
    console.log(
      `- Entry CSS:  ${report.entryCss.gzipKb} kB gzip / budget ${ENTRY_CSS_GZIP_BUDGET_KB} kB gzip (${report.entryCss.gzipKb <= ENTRY_CSS_GZIP_BUDGET_KB ? 'PASS' : 'FAIL'})`
    );
  }
  console.log(
    `- FootprintScreen Lazy Chunk: ${report.hasLazyFootprint ? 'CONFIRMED (PASS)' : 'MISSING (FAIL)'}`
  );
  console.log(
    `- ImpactScreen Lazy Chunk:    ${report.hasLazyImpact ? 'CONFIRMED (PASS)' : 'MISSING (FAIL)'}`
  );
  console.log('===========================================================');

  if (!report.passed) {
    console.error('\n❌ Bundle budget verification FAILED:');
    for (const err of report.errors) {
      console.error(`   - ${err}`);
    }
    process.exit(1);
  } else {
    console.log('\n✅ Bundle size and code-splitting budget verification PASSED.');
    process.exit(0);
  }
}
