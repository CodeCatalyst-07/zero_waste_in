import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../api/config.js';
import { createProviderChain } from '../../api/providers/index.js';
import { JarvisIdentifier } from '../../api/providers/jarvis.js';
import { GeminiIdentifier } from '../../api/providers/gemini.js';
import { GemmaGeminiIdentifier } from '../../api/providers/gemma-gemini.js';

describe('api/config', () => {
  it('applies statutory defaults and skips unconfigured providers without crashing', () => {
    const config = loadConfig({});
    expect(config.requestTimeoutMs).toBe(15000);
    expect(config.maxUploadBytes).toBe(1048576);
    expect(config.crossCheckEnabled).toBe(true);
    expect(config.breakerCooldownMs).toBe(60000);
    expect(config.rateLimitPerMinute).toBe(20);
    expect(config.maxTextLength).toBe(120);
    expect(config.providerOrder).toEqual([]);
    expect(config.jarvis).toBeUndefined();
    expect(config.gemini).toBeUndefined();
    expect(config.gemmaGemini).toBeUndefined();

    const chain = createProviderChain(config);
    expect(chain).toEqual([]);
  });

  it('allows overriding operational defaults via environment variables', () => {
    const config = loadConfig({
      CROSS_CHECK_ENABLED: 'false',
      BREAKER_COOLDOWN_MS: '30000',
      RATE_LIMIT_PER_MINUTE: '50',
      MAX_TEXT_LENGTH: '200',
      REQUEST_TIMEOUT_MS: '20000',
      MAX_UPLOAD_BYTES: '2097152',
    });

    expect(config.crossCheckEnabled).toBe(false);
    expect(config.breakerCooldownMs).toBe(30000);
    expect(config.rateLimitPerMinute).toBe(50);
    expect(config.maxTextLength).toBe(200);
    expect(config.requestTimeoutMs).toBe(20000);
    expect(config.maxUploadBytes).toBe(2097152);
  });

  it('enables Jarvis provider when API key is provided and applies defaults', () => {
    const config = loadConfig({
      JARVISLABS_API_KEY: 'test-jarvis-key',
    });

    expect(config.providerOrder).toEqual(['jarvis']);
    expect(config.jarvis).toBeDefined();
    expect(config.jarvis?.apiKey).toBe('test-jarvis-key');
    expect(config.jarvis?.baseUrl).toBe('https://models.jarvislabs.net/v1');
    expect(config.jarvis?.model).toBe('gemma-4-31b-it');
    expect(config.jarvis?.maxTokens).toBe(1024);
    expect(config.jarvis?.extraBodyJson).toBeUndefined();

    const chain = createProviderChain(config);
    expect(chain.length).toBe(1);
    expect(chain[0]?.name).toBe('jarvis');
  });

  it('parses valid JARVIS_EXTRA_BODY_JSON into an object', () => {
    const config = loadConfig({
      JARVISLABS_API_KEY: 'test-jarvis-key',
      JARVIS_EXTRA_BODY_JSON: '{"chat_template_kwargs": {"thinking": false}}',
    });

    expect(config.jarvis?.extraBodyJson).toEqual({
      chat_template_kwargs: { thinking: false },
    });
  });

  it('rejects invalid or non-object JARVIS_EXTRA_BODY_JSON', () => {
    expect(() =>
      loadConfig({
        JARVISLABS_API_KEY: 'test-jarvis-key',
        JARVIS_EXTRA_BODY_JSON: 'not-json',
      })
    ).toThrowError(/JARVIS_EXTRA_BODY_JSON must be a valid JSON object string/);

    expect(() =>
      loadConfig({
        JARVISLABS_API_KEY: 'test-jarvis-key',
        JARVIS_EXTRA_BODY_JSON: '[1, 2, 3]',
      })
    ).toThrowError(/JARVIS_EXTRA_BODY_JSON must be a valid JSON object string/);

    expect(() =>
      loadConfig({
        JARVISLABS_API_KEY: 'test-jarvis-key',
        JARVIS_EXTRA_BODY_JSON: '42',
      })
    ).toThrowError(/JARVIS_EXTRA_BODY_JSON must be a valid JSON object string/);
  });

  it('fails fast when Gemini is enabled but GEMINI_MODEL_PRIMARY is missing', () => {
    expect(() =>
      loadConfig({
        GEMINI_API_KEY: 'test-gemini-key',
      })
    ).toThrowError(/GEMINI_MODEL_PRIMARY is missing/);
  });

  it('fails fast when Gemma on Gemini is enabled but GEMMA_GEMINI_MODEL is missing', () => {
    expect(() =>
      loadConfig({
        PROVIDER_ORDER: 'gemma_gemini',
        GEMINI_API_KEY: 'test-gemini-key',
      })
    ).toThrowError(/GEMMA_GEMINI_MODEL is missing/);
  });

  it('enables Gemini when both API key and GEMINI_MODEL_PRIMARY are provided', () => {
    const config = loadConfig({
      GEMINI_API_KEY: 'test-gemini-key',
      GEMINI_MODEL_PRIMARY: 'gemini-2.5-flash',
      GEMINI_MODEL_ESCALATION: 'gemini-2.5-pro',
      PROVIDER_ORDER: 'gemini',
    });

    expect(config.providerOrder).toEqual(['gemini']);
    expect(config.gemini?.apiKey).toBe('test-gemini-key');
    expect(config.gemini?.modelPrimary).toBe('gemini-2.5-flash');
    expect(config.gemini?.modelEscalation).toBe('gemini-2.5-pro');

    const chain = createProviderChain(config);
    expect(chain.length).toBe(1);
    expect(chain[0]?.name).toBe('gemini');
  });

  it('instantiates provider adapters with valid configuration', () => {
    const jarvis = new JarvisIdentifier({
      apiKey: 'k',
      baseUrl: 'https://models.jarvislabs.net/v1',
      model: 'gemma-4-31b-it',
      maxTokens: 1024,
    });
    const gemini = new GeminiIdentifier({
      apiKey: 'k',
      modelPrimary: 'gemini-2.5-flash',
    });
    const gemmaGemini = new GemmaGeminiIdentifier({
      apiKey: 'k',
      model: 'gemma-3-27b-it',
    });

    expect(jarvis.name).toBe('jarvis');
    expect(gemini.name).toBe('gemini');
    expect(gemmaGemini.name).toBe('gemma_gemini');
  });
});
