import { GoogleGenAI } from '@google/genai';
import type { Attributes } from '@zerowastein/rules';
import type { GemmaGeminiProviderConfig } from '../config.js';
import { SYSTEM_PROMPT, buildUserPrompt } from '../prompt.js';
import { attributesJsonSchema, parseAttributesPayload } from '../schemas.js';
import {
  ProviderInvalidOutput,
  ProviderNotConfigured,
  ProviderRateLimited,
  ProviderServerError,
  ProviderTimeout,
} from './errors.js';
import type { Identifier, IdentifyInput } from './types.js';

/** Identifier adapter for Gemma model hosted on Google Gemini API infrastructure. */
export class GemmaGeminiIdentifier implements Identifier {
  /** Unique provider tag. */
  public readonly name = 'gemma_gemini';

  /** Validated runtime configuration. */
  public readonly config: GemmaGeminiProviderConfig;

  /** Network timeout limit in milliseconds. */
  private readonly timeoutMs: number;

  /** Initialized Google GenAI client instance. */
  private readonly aiClient?: GoogleGenAI;

  /**
   * Initializes the Gemma-on-Gemini provider adapter with validated configuration.
   *
   * @param config Validated Gemma-on-Gemini provider settings.
   * @param timeoutMs Optional network timeout limit in milliseconds.
   */
  public constructor(config: GemmaGeminiProviderConfig, timeoutMs = 15000) {
    this.config = config;
    this.timeoutMs = timeoutMs;
    if (config.apiKey) {
      this.aiClient = new GoogleGenAI({ apiKey: config.apiKey });
    }
  }

  /**
   * Extracts attributes using Gemma model on Google Gemini API.
   *
   * @param input Item image or description.
   * @returns Extracted waste classification attributes.
   */
  public async identify(input: IdentifyInput): Promise<Attributes> {
    if (!this.config.apiKey || !this.aiClient) {
      throw new ProviderNotConfigured(this.name, 'Gemini API key is missing for Gemma.');
    }

    // Try initial execution, with automatic single retry on schema/JSON parse failure
    let firstError: string | undefined;
    try {
      return await this.executeGenerateContent(input);
    } catch (err) {
      if (err instanceof ProviderInvalidOutput) {
        firstError = err.message;
      } else {
        throw err;
      }
    }

    // Single retry with validation error feedback appended to user prompt
    try {
      return await this.executeGenerateContent(input, firstError);
    } catch (err) {
      if (err instanceof ProviderInvalidOutput) {
        throw err;
      }
      throw new ProviderInvalidOutput(
        this.name,
        `Gemma on Gemini output failed schema validation on retry: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Calls Gemma model on Gemini API with prompt instructions and JSON schema enforcement.
   *
   * @param input Identification payload containing photo or query text.
   * @param validationError Optional schema error from previous turn for retry prompting.
   * @returns Strictly validated Attributes object.
   */
  private async executeGenerateContent(
    input: IdentifyInput,
    validationError?: string
  ): Promise<Attributes> {
    if (!this.aiClient) {
      throw new ProviderNotConfigured(this.name);
    }

    const parts: Array<Record<string, unknown>> = [];

    if (input.imageBase64 && input.mimeType) {
      parts.push({
        inlineData: {
          mimeType: input.mimeType,
          data: input.imageBase64,
        },
      });
    }

    const promptText = buildUserPrompt(input.textQuery, validationError);
    parts.push({ text: promptText });

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(
          new ProviderTimeout(
            this.name,
            `Gemma request on Gemini API timed out after ${this.timeoutMs}ms.`
          )
        );
      }, this.timeoutMs);
    });

    let responseText: string | undefined;
    try {
      const callPromise = this.aiClient.models.generateContent({
        model: this.config.model,
        contents: parts,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: attributesJsonSchema,
        },
      });

      const response = await Promise.race([callPromise, timeoutPromise]);
      responseText = response.text;
    } catch (err: unknown) {
      if (err instanceof ProviderTimeout) {
        throw err;
      }

      const errString = String(err);
      const isRateLimited =
        errString.includes('429') ||
        errString.includes('RESOURCE_EXHAUSTED') ||
        errString.toLowerCase().includes('rate limit');

      if (isRateLimited) {
        throw new ProviderRateLimited(this.name, `Gemma Gemini rate limit exceeded: ${errString}`);
      }

      const isServerFault =
        errString.includes('500') ||
        errString.includes('503') ||
        errString.includes('INTERNAL') ||
        errString.includes('UNAVAILABLE');

      if (isServerFault) {
        throw new ProviderServerError(this.name, `Gemma Gemini server fault: ${errString}`);
      }

      throw new ProviderServerError(this.name, `Gemma Gemini API execution error: ${errString}`);
    }

    if (!responseText) {
      throw new ProviderInvalidOutput(this.name, 'Gemma on Gemini returned empty text response.');
    }

    const cleanJson = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      throw new ProviderInvalidOutput(
        this.name,
        `Invalid JSON output returned by Gemma on Gemini: ${responseText.slice(0, 100)}`,
        responseText
      );
    }

    try {
      return parseAttributesPayload(parsed);
    } catch (validationErr) {
      throw new ProviderInvalidOutput(
        this.name,
        `Attributes schema violation: ${validationErr instanceof Error ? validationErr.message : String(validationErr)}`,
        responseText
      );
    }
  }
}
