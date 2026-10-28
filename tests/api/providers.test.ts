import { describe, expect, it, vi } from 'vitest';
import {
  ProviderInvalidOutput,
  ProviderNotConfigured,
  ProviderRateLimited,
  ProviderServerError,
  ProviderTimeout,
} from '../../api/providers/errors.js';
import { GeminiIdentifier } from '../../api/providers/gemini.js';
import { GemmaGeminiIdentifier } from '../../api/providers/gemma-gemini.js';
import { JarvisIdentifier } from '../../api/providers/jarvis.js';

describe('api/providers: Adapter unit and error mapping tests', () => {
  describe('GemmaGeminiIdentifier', () => {
    it('throws ProviderNotConfigured when apiKey is missing', async () => {
      const adapter = new GemmaGeminiIdentifier({
        apiKey: '',
        model: 'gemma-2-27b-it',
      });

      await expect(
        adapter.identify({ textQuery: 'apple peel' })
      ).rejects.toThrow(ProviderNotConfigured);
    });

    it('maps network timeouts to ProviderTimeout', async () => {
      const adapter = new GemmaGeminiIdentifier(
        { apiKey: 'dummy-key', model: 'gemma-2-27b-it' },
        50 // 50ms timeout
      );

      // Spy on aiClient generateContent to hang
      (adapter as any).aiClient = {
        models: {
          generateContent: () =>
            new Promise((resolve) => setTimeout(resolve, 500)),
        },
      };

      await expect(
        adapter.identify({ textQuery: 'slow query' })
      ).rejects.toThrow(ProviderTimeout);
    });

    it('maps 429 rate limit errors to ProviderRateLimited', async () => {
      const adapter = new GemmaGeminiIdentifier({
        apiKey: 'dummy-key',
        model: 'gemma-2-27b-it',
      });

      (adapter as any).aiClient = {
        models: {
          generateContent: () =>
            Promise.reject(new Error('429 RESOURCE_EXHAUSTED: quota exceeded')),
        },
      };

      await expect(
        adapter.identify({ textQuery: 'banana' })
      ).rejects.toThrow(ProviderRateLimited);
    });

    it('maps 500 server errors to ProviderServerError', async () => {
      const adapter = new GemmaGeminiIdentifier({
        apiKey: 'dummy-key',
        model: 'gemma-2-27b-it',
      });

      (adapter as any).aiClient = {
        models: {
          generateContent: () =>
            Promise.reject(new Error('500 INTERNAL_SERVER_ERROR')),
        },
      };

      await expect(
        adapter.identify({ textQuery: 'banana' })
      ).rejects.toThrow(ProviderServerError);
    });

    it('parses valid model response text into validated Attributes', async () => {
      const adapter = new GemmaGeminiIdentifier({
        apiKey: 'dummy-key',
        model: 'gemma-2-27b-it',
      });

      (adapter as any).aiClient = {
        models: {
          generateContent: () =>
            Promise.resolve({
              text: JSON.stringify({
                item: 'cardboard_box',
                isSharp: false,
                isBattery: false,
                isBulb: false,
                isMedicine: false,
                isChemical: false,
                isElectronic: false,
                isHygiene: false,
                isFood: false,
                isGarden: false,
                evidence: ['brown corrugated carton'],
                confidence: 0.95,
              }),
            }),
        },
      };

      const result = await adapter.identify({ textQuery: 'shipping box' });
      expect(result.item).toBe('cardboard_box');
      expect(result.confidence).toBe(0.95);
    });

    it('throws ProviderInvalidOutput when model response is malformed JSON or invalid schema', async () => {
      const adapter = new GemmaGeminiIdentifier({
        apiKey: 'dummy-key',
        model: 'gemma-2-27b-it',
      });

      (adapter as any).aiClient = {
        models: {
          generateContent: () =>
            Promise.resolve({
              text: 'NOT_VALID_JSON',
            }),
        },
      };

      await expect(
        adapter.identify({ textQuery: 'item' })
      ).rejects.toThrow(ProviderInvalidOutput);
    });
  });

  describe('GeminiIdentifier', () => {
    it('throws ProviderNotConfigured when apiKey is missing', async () => {
      const adapter = new GeminiIdentifier({
        apiKey: '',
        modelPrimary: 'gemini-2.5-flash',
        modelEscalation: 'gemini-3.5-flash',
      });

      await expect(
        adapter.identify({ textQuery: 'battery' })
      ).rejects.toThrow(ProviderNotConfigured);
    });

    it('maps network timeouts to ProviderTimeout', async () => {
      const adapter = new GeminiIdentifier(
        {
          apiKey: 'dummy-key',
          modelPrimary: 'gemini-2.5-flash',
          modelEscalation: 'gemini-3.5-flash',
        },
        50
      );

      (adapter as any).aiClient = {
        models: {
          generateContent: () =>
            new Promise((resolve) => setTimeout(resolve, 500)),
        },
      };

      await expect(
        adapter.identify({ textQuery: 'battery' })
      ).rejects.toThrow(ProviderTimeout);
    });

    it('maps 429 rate limits and 500 server errors', async () => {
      const adapter = new GeminiIdentifier({
        apiKey: 'dummy-key',
        modelPrimary: 'gemini-2.5-flash',
        modelEscalation: 'gemini-3.5-flash',
      });

      (adapter as any).aiClient = {
        models: {
          generateContent: () =>
            Promise.reject(new Error('429 RESOURCE_EXHAUSTED')),
        },
      };

      await expect(
        adapter.identify({ textQuery: 'battery' })
      ).rejects.toThrow(ProviderRateLimited);

      (adapter as any).aiClient = {
        models: {
          generateContent: () =>
            Promise.reject(new Error('500 INTERNAL_SERVER_ERROR')),
        },
      };

      await expect(
        adapter.identify({ textQuery: 'battery' })
      ).rejects.toThrow(ProviderServerError);
    });

    it('throws ProviderInvalidOutput when Gemini returns empty, malformed, or invalid schema text', async () => {
      const adapter = new GeminiIdentifier({
        apiKey: 'dummy-key',
        modelPrimary: 'gemini-2.5-flash',
        modelEscalation: 'gemini-3.5-flash',
      });

      (adapter as any).aiClient = {
        models: {
          generateContent: () => Promise.resolve({ text: '' }),
        },
      };

      await expect(
        adapter.identify({ textQuery: 'battery' })
      ).rejects.toThrow(ProviderInvalidOutput);

      (adapter as any).aiClient = {
        models: {
          generateContent: () => Promise.resolve({ text: 'NOT_JSON' }),
        },
      };

      await expect(
        adapter.identify({ textQuery: 'battery' })
      ).rejects.toThrow(ProviderInvalidOutput);

      (adapter as any).aiClient = {
        models: {
          generateContent: () =>
            Promise.resolve({
              text: JSON.stringify({ item: 'box', isSharp: 'invalid_type' }),
            }),
        },
      };

      await expect(
        adapter.identify({ textQuery: 'battery' })
      ).rejects.toThrow(ProviderInvalidOutput);
    });

    it('processes image input and falls back to escalation model on primary 500 error', async () => {
      const adapter = new GeminiIdentifier({
        apiKey: 'dummy-key',
        modelPrimary: 'gemini-2.5-flash',
        modelEscalation: 'gemini-3.5-flash',
      });

      let callCount = 0;
      (adapter as any).aiClient = {
        models: {
          generateContent: (params: any) => {
            callCount++;
            if (callCount === 1) {
              expect(params.model).toBe('gemini-2.5-flash');
              return Promise.reject(new Error('500 Server Error'));
            }
            expect(params.model).toBe('gemini-3.5-flash');
            return Promise.resolve({
              text: JSON.stringify({
                item: 'newspaper',
                isSharp: false,
                isBattery: false,
                isBulb: false,
                isMedicine: false,
                isChemical: false,
                isElectronic: false,
                isHygiene: false,
                isFood: false,
                isGarden: false,
                evidence: ['printed paper'],
                confidence: 0.95,
              }),
            });
          },
        },
      };

      const result = await adapter.identify({
        imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        mimeType: 'image/png',
      });

      expect(callCount).toBe(2);
      expect(result.item).toBe('newspaper');
    });
  });

  describe('JarvisIdentifier', () => {
    it('throws ProviderNotConfigured when apiKey is missing', async () => {
      const adapter = new JarvisIdentifier({
        apiKey: '',
        baseUrl: 'https://models.jarvislabs.net/v1',
        model: 'llama-3.2',
        maxTokens: 1024,
      });

      await expect(
        adapter.identify({ textQuery: 'bottle' })
      ).rejects.toThrow(ProviderNotConfigured);
    });

    it('maps 429 responses to ProviderRateLimited', async () => {
      const adapter = new JarvisIdentifier({
        apiKey: 'dummy-key',
        baseUrl: 'https://models.jarvislabs.net/v1',
        model: 'llama-3.2',
        maxTokens: 1024,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '30' }),
        text: () => Promise.resolve('Rate limit exceeded'),
      } as any);

      await expect(adapter.identify({ textQuery: 'can' })).rejects.toThrow(
        ProviderRateLimited
      );
      fetchSpy.mockRestore();
    });

    it('maps 502 responses to ProviderServerError', async () => {
      const adapter = new JarvisIdentifier({
        apiKey: 'dummy-key',
        baseUrl: 'https://models.jarvislabs.net/v1',
        model: 'llama-3.2',
        maxTokens: 1024,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: new Headers(),
        text: () => Promise.resolve('Bad Gateway'),
      } as any);

      await expect(adapter.identify({ textQuery: 'can' })).rejects.toThrow(
        ProviderServerError
      );
      fetchSpy.mockRestore();
    });

    it('handles AbortError timeout, invalid JSON envelope, and empty content for Jarvis', async () => {
      const adapter = new JarvisIdentifier({
        apiKey: 'dummy-key',
        baseUrl: 'https://models.jarvislabs.net/v1',
        model: 'llama-3.2',
        maxTokens: 1024,
      });

      // 1. AbortError -> ProviderTimeout
      const abortError = new Error('Request timed out');
      abortError.name = 'AbortError';
      const fetchSpy1 = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortError);
      await expect(adapter.identify({ textQuery: 'can' })).rejects.toThrow(ProviderTimeout);
      fetchSpy1.mockRestore();

      // 2. Network error -> ProviderServerError
      const fetchSpy2 = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Connection reset'));
      await expect(adapter.identify({ textQuery: 'can' })).rejects.toThrow(ProviderServerError);
      fetchSpy2.mockRestore();

      // 3. Invalid JSON envelope -> ProviderInvalidOutput
      const fetchSpy3 = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('SyntaxError')),
      } as any);
      await expect(adapter.identify({ textQuery: 'can' })).rejects.toThrow(ProviderInvalidOutput);
      fetchSpy3.mockRestore();

      // 4. Empty content -> ProviderInvalidOutput
      const fetchSpy4 = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: '' } }] }),
      } as any);
      await expect(adapter.identify({ textQuery: 'can' })).rejects.toThrow(ProviderInvalidOutput);
      fetchSpy4.mockRestore();
    });

    it('retries without response_format when Jarvis endpoint returns 400', async () => {
      const adapter = new JarvisIdentifier({
        apiKey: 'dummy-key',
        baseUrl: 'https://models.jarvislabs.net/v1',
        model: 'llama-3.2',
        maxTokens: 1024,
      });

      let callCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options: any) => {
        callCount++;
        const body = JSON.parse(options.body);
        if (callCount === 1) {
          expect(body.response_format).toBeDefined();
          return Promise.resolve({
            ok: false,
            status: 400,
            headers: new Headers(),
            text: () => Promise.resolve('Unsupported response_format'),
          } as any);
        }
        expect(body.response_format).toBeUndefined();
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      item: 'cardboard',
                      isSharp: false,
                      isBattery: false,
                      isBulb: false,
                      isMedicine: false,
                      isChemical: false,
                      isElectronic: false,
                      isHygiene: false,
                      isFood: false,
                      isGarden: false,
                      evidence: ['corrugated box'],
                      confidence: 0.9,
                    }),
                  },
                },
              ],
            }),
        } as any);
      });

      const result = await adapter.identify({ textQuery: 'box' });
      expect(callCount).toBe(2);
      expect(result.item).toBe('cardboard');
      fetchSpy.mockRestore();
    });

    it('parses valid chat completion response', async () => {
      const adapter = new JarvisIdentifier({
        apiKey: 'dummy-key',
        baseUrl: 'https://models.jarvislabs.net/v1',
        model: 'llama-3.2',
        maxTokens: 1024,
      });

      const mockPayload = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                item: 'aluminum_can',
                isSharp: false,
                isBattery: false,
                isBulb: false,
                isMedicine: false,
                isChemical: false,
                isElectronic: false,
                isHygiene: false,
                isFood: false,
                isGarden: false,
                evidence: ['metal beverage can'],
                confidence: 0.9,
              }),
            },
          },
        ],
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPayload),
      } as any);

      const result = await adapter.identify({ textQuery: 'soda can' });
      expect(result.item).toBe('aluminum_can');
      fetchSpy.mockRestore();
    });
  });
});
