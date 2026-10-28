import { z } from 'zod';

/** Supported provider names within the fallback classification chain. */
export type ProviderName = 'jarvis' | 'gemini' | 'gemma_gemini';

/** Validated runtime configuration for Jarvis Labs OpenAI-compatible inference. */
export interface JarvisProviderConfig {
  /** Authentication bearer token for Jarvis Labs. */
  readonly apiKey: string;
  /** OpenAI-compatible API base URL. */
  readonly baseUrl: string;
  /** Gemma model identifier deployed on Jarvis Labs. */
  readonly model: string;
  /** Maximum generation tokens allowed. */
  readonly maxTokens: number;
  /** Optional arbitrary JSON object merged into the request body (e.g. for reasoning parameters). */
  readonly extraBodyJson?: Record<string, unknown>;
}

/** Validated runtime configuration for Google Gemini API. */
export interface GeminiProviderConfig {
  /** Google AI Studio API key. */
  readonly apiKey: string;
  /** Primary multimodal model identifier from AI Studio. */
  readonly modelPrimary: string;
  /** Optional fallback or escalation model identifier. */
  readonly modelEscalation?: string;
}

/** Validated runtime configuration for Gemma models running on Gemini API. */
export interface GemmaGeminiProviderConfig {
  /** Google AI Studio API key. */
  readonly apiKey: string;
  /** Gemma model identifier on Gemini infrastructure. */
  readonly model: string;
}

/** Complete validated application configuration for serverless runtime. */
export interface AppConfig {
  /** Ordered list of active, configured provider names. */
  readonly providerOrder: readonly ProviderName[];
  /** Configuration for Jarvis Labs provider if enabled. */
  readonly jarvis?: JarvisProviderConfig;
  /** Configuration for Google Gemini provider if enabled. */
  readonly gemini?: GeminiProviderConfig;
  /** Configuration for Gemma-on-Gemini provider if enabled. */
  readonly gemmaGemini?: GemmaGeminiProviderConfig;
  /** Whether dual-model cross-checking is enabled for uncertain or hazardous results. */
  readonly crossCheckEnabled: boolean;
  /** Duration in milliseconds to pause calls to an unhealthy provider before testing. */
  readonly breakerCooldownMs: number;
  /** Maximum allowable requests per client IP within a rolling one-minute window. */
  readonly rateLimitPerMinute: number;
  /** Maximum allowable character length for user-typed queries. */
  readonly maxTextLength: number;
  /** Network timeout limit in milliseconds. */
  readonly requestTimeoutMs: number;
  /** Maximum request payload size in bytes. */
  readonly maxUploadBytes: number;
}

/** Zod schema validating raw environment variables and supplying statutory defaults. */
export const rawEnvSchema = z.object({
  PROVIDER_ORDER: z
    .string()
    .optional()
    .default('jarvis,gemini,gemma_gemini')
    .transform(
      (val) =>
        val
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean) as ProviderName[]
    ),
  JARVISLABS_API_KEY: z.string().trim().optional(),
  JARVISLABS_BASE_URL: z
    .string()
    .trim()
    .url('JARVISLABS_BASE_URL must be a valid URL')
    .optional()
    .default('https://models.jarvislabs.net/v1'),
  JARVISLABS_MODEL: z.string().trim().optional().default('gemma-4-31b-it'),
  JARVIS_MAX_TOKENS: z.coerce.number().int().positive().optional().default(1024),
  JARVIS_EXTRA_BODY_JSON: z
    .string()
    .trim()
    .optional()
    .refine(
      (val) => {
        if (!val) {
          return true;
        }
        try {
          const parsed = JSON.parse(val);
          return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
        } catch {
          return false;
        }
      },
      { message: 'JARVIS_EXTRA_BODY_JSON must be a valid JSON object string' }
    ),
  GEMINI_API_KEY: z.string().trim().optional(),
  GEMINI_MODEL_PRIMARY: z.string().trim().optional(),
  GEMINI_MODEL_ESCALATION: z.string().trim().optional(),
  GEMMA_GEMINI_MODEL: z.string().trim().optional(),
  CROSS_CHECK_ENABLED: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false' && v !== '0'),
  BREAKER_COOLDOWN_MS: z.coerce.number().int().positive().optional().default(60000),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().optional().default(20),
  MAX_TEXT_LENGTH: z.coerce.number().int().positive().optional().default(120),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(15000),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().optional().default(1048576),
});

/**
 * Parses and validates environment variables, failing fast on invalid enabled providers.
 *
 * @param env Environment variables map, defaults to process.env.
 * @returns Fully validated and immutable application configuration.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsedEnv = rawEnvSchema.parse(env);
  const activeOrder: ProviderName[] = [];
  let jarvisConfig: JarvisProviderConfig | undefined;
  let geminiConfig: GeminiProviderConfig | undefined;
  let gemmaGeminiConfig: GemmaGeminiProviderConfig | undefined;

  for (const provider of parsedEnv.PROVIDER_ORDER) {
    if (provider === 'jarvis') {
      const key = parsedEnv.JARVISLABS_API_KEY;
      if (!key) {
        continue;
      }
      if (!parsedEnv.JARVISLABS_MODEL) {
        throw new Error(
          'Jarvis provider is enabled (JARVISLABS_API_KEY is set) but JARVISLABS_MODEL is empty.'
        );
      }
      let extraBody: Record<string, unknown> | undefined;
      if (parsedEnv.JARVIS_EXTRA_BODY_JSON) {
        extraBody = JSON.parse(parsedEnv.JARVIS_EXTRA_BODY_JSON) as Record<string, unknown>;
      }
      jarvisConfig = {
        apiKey: key,
        baseUrl: parsedEnv.JARVISLABS_BASE_URL,
        model: parsedEnv.JARVISLABS_MODEL,
        maxTokens: parsedEnv.JARVIS_MAX_TOKENS,
        extraBodyJson: extraBody,
      };
      activeOrder.push('jarvis');
    } else if (provider === 'gemini') {
      const key = parsedEnv.GEMINI_API_KEY;
      if (!key) {
        continue;
      }
      if (!parsedEnv.GEMINI_MODEL_PRIMARY) {
        throw new Error(
          'Gemini provider is enabled (GEMINI_API_KEY is set) but GEMINI_MODEL_PRIMARY is missing. Please check Google AI Studio.'
        );
      }
      geminiConfig = {
        apiKey: key,
        modelPrimary: parsedEnv.GEMINI_MODEL_PRIMARY,
        modelEscalation: parsedEnv.GEMINI_MODEL_ESCALATION || undefined,
      };
      activeOrder.push('gemini');
    } else if (provider === 'gemma_gemini') {
      const key = parsedEnv.GEMINI_API_KEY;
      if (!key) {
        continue;
      }
      if (!parsedEnv.GEMMA_GEMINI_MODEL) {
        throw new Error(
          'Gemma-on-Gemini provider is enabled (GEMINI_API_KEY is set) but GEMMA_GEMINI_MODEL is missing.'
        );
      }
      gemmaGeminiConfig = {
        apiKey: key,
        model: parsedEnv.GEMMA_GEMINI_MODEL,
      };
      activeOrder.push('gemma_gemini');
    }
  }

  return {
    providerOrder: activeOrder,
    jarvis: jarvisConfig,
    gemini: geminiConfig,
    gemmaGemini: gemmaGeminiConfig,
    crossCheckEnabled: parsedEnv.CROSS_CHECK_ENABLED,
    breakerCooldownMs: parsedEnv.BREAKER_COOLDOWN_MS,
    rateLimitPerMinute: parsedEnv.RATE_LIMIT_PER_MINUTE,
    maxTextLength: parsedEnv.MAX_TEXT_LENGTH,
    requestTimeoutMs: parsedEnv.REQUEST_TIMEOUT_MS,
    maxUploadBytes: parsedEnv.MAX_UPLOAD_BYTES,
  };
}
