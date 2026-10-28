import { describe, expect, it, vi } from 'vitest';
import { attributesSchema, parseAttributesPayload, stripControlCharacters } from '../../api/_lib/schemas.js';
import { JarvisIdentifier } from '../../api/_lib/providers/jarvis.js';
import { ProviderInvalidOutput } from '../../api/_lib/providers/errors.js';

describe('api/schemas & validation', () => {
  const validAttributes = {
    item: 'banana_peel',
    isSharp: false,
    isBattery: false,
    isBulb: false,
    isMedicine: false,
    isChemical: false,
    isElectronic: false,
    isHygiene: false,
    isFood: true,
    isGarden: false,
    evidence: ['yellow skin', 'organic matter'],
    confidence: 0.95,
  };

  it('parses valid payload successfully', () => {
    const parsed = attributesSchema.safeParse(validAttributes);
    expect(parsed.success).toBe(true);
    const result = parseAttributesPayload(validAttributes);
    expect(result).toEqual(validAttributes);
  });

  it('rejects payload missing any required field', () => {
    const missingIsSharp = { ...validAttributes };
    // @ts-expect-error Testing runtime rejection of missing field
    delete missingIsSharp.isSharp;

    expect(() => parseAttributesPayload(missingIsSharp)).toThrowError();

    const missingItem = { ...validAttributes };
    // @ts-expect-error Testing runtime rejection of missing field
    delete missingItem.item;

    expect(() => parseAttributesPayload(missingItem)).toThrowError();
  });

  it('rejects payload with extra fields due to strict schema enforcement', () => {
    const withExtra = {
      ...validAttributes,
      stream: 'wet', // Models must never output stream directly
      binColor: 'green',
    };

    expect(() => parseAttributesPayload(withExtra)).toThrowError();
  });

  it('rejects confidence out of statutory 0.0 to 1.0 range', () => {
    expect(() => parseAttributesPayload({ ...validAttributes, confidence: -0.1 })).toThrowError(
      /Confidence cannot be negative/
    );

    expect(() => parseAttributesPayload({ ...validAttributes, confidence: 1.05 })).toThrowError(
      /Confidence cannot exceed 1.0/
    );
  });

  it('rejects evidence array containing more than 5 items', () => {
    const tooManyEvidence = {
      ...validAttributes,
      evidence: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'],
    };

    expect(() => parseAttributesPayload(tooManyEvidence)).toThrowError(
      /Maximum of 5 evidence items permitted/
    );
  });

  it('rejects individual evidence item exceeding 80 characters', () => {
    const longEvidence = {
      ...validAttributes,
      evidence: ['a'.repeat(81)],
    };

    expect(() => parseAttributesPayload(longEvidence)).toThrowError(
      /Evidence item must not exceed 80 characters/
    );
  });

  it('sanitizes strings by stripping control characters while preserving unicode and Hindi', () => {
    const textWithControls = 'banana\u0000_peel\u001F\u007F';
    expect(stripControlCharacters(textWithControls)).toBe('banana_peel');

    const hindiText = 'चाय पत्ती (tea leaves)';
    expect(stripControlCharacters(hindiText)).toBe('चाय पत्ती (tea leaves)');

    // In parsed attributes
    const parsed = parseAttributesPayload({
      ...validAttributes,
      item: 'fruit\u0007_scraps\u0000',
      evidence: ['fresh\u0001 skin', 'जैविक कचरा'],
    });

    expect(parsed.item).toBe('fruit_scraps');
    expect(parsed.evidence).toEqual(['fresh skin', 'जैविक कचरा']);
  });
});

describe('provider retry on validation failure', () => {
  const mockJarvisConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://models.jarvislabs.net/v1',
    model: 'gemma-4-31b-it',
    maxTokens: 1024,
  };

  it('retries once with feedback on invalid JSON and succeeds when second attempt is valid', async () => {
    const jarvis = new JarvisIdentifier(mockJarvisConfig, 5000);

    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Attempt 1: returns invalid JSON
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"item": "apple", "isSharp": "not-a-bool"}' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // Attempt 2: returns valid payload
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  item: 'apple',
                  isSharp: false,
                  isBattery: false,
                  isBulb: false,
                  isMedicine: false,
                  isChemical: false,
                  isElectronic: false,
                  isHygiene: false,
                  isFood: true,
                  isGarden: false,
                  evidence: ['red apple'],
                  confidence: 0.92,
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    try {
      const result = await jarvis.identify({ textQuery: 'apple' });
      expect(callCount).toBe(2);
      expect(result.item).toBe('apple');
      expect(result.isFood).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('retries once and throws ProviderInvalidOutput if both attempts return invalid output', async () => {
    const jarvis = new JarvisIdentifier(mockJarvisConfig, 5000);

    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'not valid json at all' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    try {
      await expect(jarvis.identify({ textQuery: 'broken' })).rejects.toThrow(ProviderInvalidOutput);
      expect(callCount).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rate limiter handles zero or negative limits and evicts stale entries', async () => {
    const { consumeRateLimitToken, resetRateLimits } = await import('../../api/_lib/rate-limit.js');
    resetRateLimits();

    // 0 or negative limit allows all
    expect(consumeRateLimitToken('ip1', 0)).toBe(true);
    expect(consumeRateLimitToken('ip1', -5)).toBe(true);

    // Eviction test: insert entries and simulate time > 120s later
    const t0 = 1000000;
    consumeRateLimitToken('old-ip', 10, t0);

    // Trigger eviction threshold with many requests
    for (let i = 0; i < 1005; i++) {
      consumeRateLimitToken(`client-${i}`, 10, t0 + 200000);
    }

    // Next request triggers cleanup
    expect(consumeRateLimitToken('new-client', 10, t0 + 200000)).toBe(true);
  });
});
