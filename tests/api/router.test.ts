import { describe, expect, it } from 'vitest';
import type { Attributes } from '@zerowastein/rules';
import type { AppConfig } from '../../api/config.js';
import { ProviderRateLimited, ProviderServerError, ProviderTimeout } from '../../api/providers/errors.js';
import { ProviderRouter } from '../../api/providers/router.js';
import type { Identifier, IdentifyInput } from '../../api/providers/types.js';

/** Creates a mock Attributes object with customizable attributes. */
function mockAttributes(overrides: Partial<Attributes> = {}): Attributes {
  return {
    item: 'plastic_bottle',
    isSharp: false,
    isBattery: false,
    isBulb: false,
    isMedicine: false,
    isChemical: false,
    isElectronic: false,
    isHygiene: false,
    isFood: false,
    isGarden: false,
    evidence: ['plastic container'],
    confidence: 0.9,
    ...overrides,
  };
}

/** Configurable fake provider for deterministic router testing. */
class FakeIdentifier implements Identifier {
  public readonly name: string;
  public callCount = 0;
  private readonly behavior: () => Promise<Attributes>;

  public constructor(name: string, behavior: () => Promise<Attributes>) {
    this.name = name;
    this.behavior = behavior;
  }

  public async identify(_input: IdentifyInput): Promise<Attributes> {
    this.callCount++;
    return await this.behavior();
  }
}

/** Mock base application configuration. */
const mockConfig: AppConfig = {
  providerOrder: ['jarvis', 'gemini', 'gemma_gemini'],
  crossCheckEnabled: true,
  breakerCooldownMs: 60000,
  rateLimitPerMinute: 20,
  maxTextLength: 120,
  requestTimeoutMs: 15000,
  maxUploadBytes: 1048576,
};

describe('api/providers/router', () => {
  it('executes providers in fallback order upon failures', async () => {
    const jarvis = new FakeIdentifier('jarvis', async () => {
      throw new ProviderServerError('jarvis', 'GPU node down');
    });

    const gemini = new FakeIdentifier('gemini', async () => {
      return mockAttributes({ item: 'banana_peel', confidence: 0.95 });
    });

    const router = new ProviderRouter([jarvis, gemini], mockConfig);
    const result = await router.route({});

    expect(jarvis.callCount).toBe(1);
    expect(gemini.callCount).toBe(1);
    expect(result.providerUsed).toBe('gemini');
    expect(result.attributes?.item).toBe('banana_peel');
    expect(result.degraded).toBe(false);
  });

  it('honours retryAfterMs and skips rate-limited provider during backoff window', async () => {
    let currentTime = 1000000;
    const now = () => currentTime;

    const jarvis = new FakeIdentifier('jarvis', async () => {
      throw new ProviderRateLimited('jarvis', 'Rate limit hit', 30000);
    });

    const gemini = new FakeIdentifier('gemini', async () => {
      return mockAttributes({ item: 'tin_can', confidence: 0.9 });
    });

    const router = new ProviderRouter([jarvis, gemini], mockConfig, now);

    // Call 1: jarvis fails with 30s retryAfterMs -> falls back to gemini
    const res1 = await router.route({});
    expect(res1.providerUsed).toBe('gemini');
    expect(jarvis.callCount).toBe(1);

    // Call 2: after 10s (within 30s retry window) -> jarvis skipped immediately without call
    currentTime += 10000;
    const res2 = await router.route({});
    expect(res2.providerUsed).toBe('gemini');
    expect(jarvis.callCount).toBe(1); // not called again!

    // Call 3: after 31s -> retry window elapsed, jarvis is tried again
    currentTime += 21000;
    await router.route({});
    expect(jarvis.callCount).toBe(2);
  });

  it('circuit breaker opens after failure, skips during cooldown, and allows one trial after it', async () => {
    let currentTime = 500000;
    const now = () => currentTime;

    let shouldJarvisRecover = false;
    const jarvis = new FakeIdentifier('jarvis', async () => {
      if (!shouldJarvisRecover) {
        throw new ProviderTimeout('jarvis', 'Socket timeout');
      }
      return mockAttributes({ item: 'newspaper_paper', confidence: 0.95 });
    });

    const gemini = new FakeIdentifier('gemini', async () => {
      return mockAttributes({ item: 'fallback_cardboard', confidence: 0.9 });
    });

    const router = new ProviderRouter([jarvis, gemini], mockConfig, now);

    // Call 1: fails and opens circuit breaker
    await router.route({});
    expect(jarvis.callCount).toBe(1);

    // Call 2: after 30s (< 60s cooldown) -> jarvis is skipped
    currentTime += 30000;
    await router.route({});
    expect(jarvis.callCount).toBe(1);

    // Call 3: after 65s (>= 60s cooldown) -> transition to half-open, allows one trial
    currentTime += 35000;
    shouldJarvisRecover = true;
    const res3 = await router.route({});
    expect(jarvis.callCount).toBe(2);
    expect(res3.providerUsed).toBe('jarvis');

    // Call 4: since trial succeeded, breaker is closed, jarvis is called again
    await router.route({});
    expect(jarvis.callCount).toBe(3);
  });

  it('returns degraded result when all providers fail', async () => {
    const jarvis = new FakeIdentifier('jarvis', async () => {
      throw new ProviderServerError('jarvis', 'Unavailable');
    });
    const gemini = new FakeIdentifier('gemini', async () => {
      throw new ProviderServerError('gemini', 'Unavailable');
    });

    const router = new ProviderRouter([jarvis, gemini], mockConfig);
    const result = await router.route({});

    expect(result.degraded).toBe(true);
    expect(result.attributes).toBeNull();
    expect(result.providerUsed).toBeNull();
  });
});

describe('api/providers/router cross-check', () => {
  it('does NOT trigger cross-check for high confidence non-hazard items', async () => {
    const jarvis = new FakeIdentifier('jarvis', async () => {
      return mockAttributes({
        item: 'plastic_bottle',
        confidence: 0.95,
        isBattery: false,
      });
    });

    const gemini = new FakeIdentifier('gemini', async () => {
      return mockAttributes({ item: 'plastic_bottle', confidence: 0.9 });
    });

    const router = new ProviderRouter([jarvis, gemini], mockConfig);
    const result = await router.route({});

    expect(jarvis.callCount).toBe(1);
    expect(gemini.callCount).toBe(0); // second provider was not invoked
    expect(result.crossChecked).toBe(false);
    expect(result.disagreement).toBe(false);
  });

  it('triggers cross-check when confidence is below CONFIDENCE_HIGH (0.8)', async () => {
    const jarvis = new FakeIdentifier('jarvis', async () => {
      return mockAttributes({
        item: 'tetra_pak_cartons',
        confidence: 0.72,
      });
    });

    const gemini = new FakeIdentifier('gemini', async () => {
      return mockAttributes({
        item: 'tetra_pak_cartons',
        confidence: 0.78,
      });
    });

    const router = new ProviderRouter([jarvis, gemini], mockConfig);
    const result = await router.route({});

    expect(jarvis.callCount).toBe(1);
    expect(gemini.callCount).toBe(1);
    expect(result.crossChecked).toBe(true);
    expect(result.disagreement).toBe(false);
  });

  it('triggers cross-check when any hazard attribute is true even at high confidence', async () => {
    const jarvis = new FakeIdentifier('jarvis', async () => {
      return mockAttributes({
        item: 'aa_battery',
        confidence: 0.99,
        isBattery: true,
      });
    });

    const gemini = new FakeIdentifier('gemini', async () => {
      return mockAttributes({
        item: 'aa_battery',
        confidence: 0.95,
        isBattery: true,
      });
    });

    const router = new ProviderRouter([jarvis, gemini], mockConfig);
    const result = await router.route({});

    expect(jarvis.callCount).toBe(1);
    expect(gemini.callCount).toBe(1);
    expect(result.crossChecked).toBe(true);
    expect(result.disagreement).toBe(false);
  });

  it('flags disagreement true when providers disagree on hazard attributes', async () => {
    const jarvis = new FakeIdentifier('jarvis', async () => {
      return mockAttributes({
        item: 'broken_glass',
        confidence: 0.85,
        isSharp: true,
      });
    });

    const gemini = new FakeIdentifier('gemini', async () => {
      return mockAttributes({
        item: 'broken_glass',
        confidence: 0.85,
        isSharp: false, // Disagreement on hazard!
      });
    });

    const router = new ProviderRouter([jarvis, gemini], mockConfig);
    const result = await router.route({});

    expect(result.crossChecked).toBe(true);
    expect(result.disagreement).toBe(true);
  });

  it('skips silently if cross-check is required but no second provider is available', async () => {
    const jarvis = new FakeIdentifier('jarvis', async () => {
      return mockAttributes({
        item: 'paint_can',
        confidence: 0.6,
        isChemical: true,
      });
    });

    const router = new ProviderRouter([jarvis], mockConfig);
    const result = await router.route({});

    expect(jarvis.callCount).toBe(1);
    expect(result.crossChecked).toBe(false);
    expect(result.disagreement).toBe(false);
    expect(result.providerUsed).toBe('jarvis');
  });
});
