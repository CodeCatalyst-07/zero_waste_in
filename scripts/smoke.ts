import fs from 'node:fs';
import path from 'node:path';

/** Default classification endpoint exposed by local Vite development server. */
const ENDPOINT = 'http://localhost:5173/api/classify';

/** Structure of classification response for smoke test logging. */
interface SmokeResponse {
  readonly requestId?: string;
  readonly itemLabel?: string;
  readonly verdict?: {
    readonly kind: string;
    readonly stream?: string;
    readonly itemLabel?: string;
  };
  readonly meta?: {
    readonly source?: string;
    readonly providerUsed?: string | null;
    readonly crossChecked?: boolean;
    readonly degraded?: boolean;
  };
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
}

/**
 * Executes smoke testing verification against the local classification API.
 */
async function runSmoke(): Promise<void> {
  console.log(`\n========================================`);
  console.log(`ZeroWasteIN Classification API Smoke Test`);
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`========================================\n`);

  // 1. Text Classification Smoke Test
  console.log('--> Sending text classification test ("plastic water bottle")...');
  const textStart = Date.now();
  try {
    const textRes = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'text', text: 'plastic water bottle' }),
    });

    const textLatency = Date.now() - textStart;
    const textData = (await textRes.json()) as SmokeResponse;

    console.log(`Status: ${textRes.status}`);
    console.log(`Latency: ${textLatency}ms`);

    if (!textRes.ok) {
      console.error(`FAILED: Text request returned error status ${textRes.status}`);
      console.error(`Error details:`, textData.error ?? textData);
      process.exit(1);
    }

    console.log(`Verdict Kind: ${textData.verdict?.kind}`);
    console.log(`Item Label: ${textData.itemLabel ?? textData.verdict?.itemLabel}`);
    if (textData.verdict?.kind === 'answer') {
      console.log(`Stream: ${textData.verdict.stream}`);
    }
    console.log(
      `Meta: source=${textData.meta?.source}, providerUsed=${textData.meta?.providerUsed}, crossChecked=${textData.meta?.crossChecked}, degraded=${textData.meta?.degraded}`
    );
    console.log('✓ Text classification succeeded.\n');
  } catch (err: unknown) {
    console.error(`FAILED: Could not connect to dev server at ${ENDPOINT}. Is 'pnpm dev' running?`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // 2. Optional Image Classification Smoke Test
  const args = process.argv.slice(2);
  const imageArg = args.find((a) => !a.startsWith('--'));

  if (imageArg) {
    const resolvedPath = path.resolve(process.cwd(), imageArg);
    console.log(`--> Sending image classification test for file: ${imageArg}...`);

    if (!fs.existsSync(resolvedPath)) {
      console.error(`FAILED: Image file not found at path: ${resolvedPath}`);
      process.exit(1);
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    let mimeType = 'image/jpeg';
    if (ext === '.png') {
      mimeType = 'image/png';
    } else if (ext === '.webp') {
      mimeType = 'image/webp';
    }

    const imageBuffer = fs.readFileSync(resolvedPath);
    const imageBase64 = imageBuffer.toString('base64');

    const imageStart = Date.now();
    try {
      const imageRes = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'image',
          image: imageBase64,
          mimeType,
        }),
      });

      const imageLatency = Date.now() - imageStart;
      const imageData = (await imageRes.json()) as SmokeResponse;

      console.log(`Status: ${imageRes.status}`);
      console.log(`Latency: ${imageLatency}ms`);

      if (!imageRes.ok) {
        console.error(`FAILED: Image request returned error status ${imageRes.status}`);
        console.error(`Error details:`, imageData.error ?? imageData);
        process.exit(1);
      }

      console.log(`Verdict Kind: ${imageData.verdict?.kind}`);
      console.log(`Item Label: ${imageData.itemLabel ?? imageData.verdict?.itemLabel}`);
      if (imageData.verdict?.kind === 'answer') {
        console.log(`Stream: ${imageData.verdict.stream}`);
      }
      console.log(
        `Meta: source=${imageData.meta?.source}, providerUsed=${imageData.meta?.providerUsed}, crossChecked=${imageData.meta?.crossChecked}, degraded=${imageData.meta?.degraded}`
      );
      console.log('✓ Image classification succeeded.\n');
    } catch (err: unknown) {
      console.error(`FAILED: Image classification failed.`);
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  console.log('========================================');
  console.log('Smoke Test Finished Successfully.');
  console.log('========================================\n');
}

runSmoke();
