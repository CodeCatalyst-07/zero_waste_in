import { GoogleGenAI } from '@google/genai';
import type { Attributes } from '@zerowastein/rules';
import type { GeminiProviderConfig } from '../config.js';
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

/** Identifier adapter for Google Gemini multimodal API via the official @google/genai SDK. */
export class GeminiIdentifier implements Identifier {
  /** Unique provider tag. */
  public readonly name = 'gemini';

  /** Validated runtime configuration. */
  public readonly config: GeminiProviderConfig;

  /** Network timeout limit in milliseconds. */
  private readonly timeoutMs: number;

  /** Initialized Google GenAI client instance. */
  private readonly aiClient?: GoogleGenAI;

  /**
   * Initializes the Google Gemini provider adapter with validated configuration.
   *
   * @param config Validated Gemini provider settings.
   * @param timeoutMs Optional network timeout limit in milliseconds.
   */
  public constructor(config: GeminiProviderConfig, timeoutMs = 15000) {
    this.config = config;
    this.timeoutMs = timeoutMs;
    if (config.apiKey) {
      this.aiClient = new GoogleGenAI({ apiKey: config.apiKey });
    }
  }

  /**
   * Extracts attributes using Google Gemini multimodal vision inference.
   *
   * @param input Item image or description.
   * @returns Extracted waste classification attributes.
   */
  public async identify(input: IdentifyInput): Promise<Attributes> {
    if (!this.config.apiKey || !this.aiClient) {
      throw new ProviderNotConfigured(this.name, 'Google Gemini API key is missing.');
    }

    // Try primary model first, with single retry on schema/JSON parse failure
    let firstError: string | undefined;
    try {
      return await this.executeGenerateContent(this.config.modelPrimary, input);
    } catch (err) {
      if (err instanceof ProviderInvalidOutput) {
        firstError = err.message;
      } else if (
        (err instanceof ProviderServerError || err instanceof ProviderRateLimited) &&
        this.config.modelEscalation
      ) {
        // Fall back to escalation model when primary model encounters server/rate-limit fault
        return await this.executeGenerateContent(this.config.modelEscalation, input);
      } else {
        throw err;
      }
    }

    // Single retry with validation error appended
    try {
      const retryModel = this.config.modelEscalation ?? this.config.modelPrimary;
      return await this.executeGenerateContent(retryModel, input, firstError);
    } catch (err) {
      if (err instanceof ProviderInvalidOutput) {
        throw err;
      }
      throw new ProviderInvalidOutput(
        this.name,
        `Gemini output failed schema validation on retry: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Calls Gemini models.generateContent with structured JSON schema and low thinking level.
   *
   * @param model Model identifier to query.
   * @param input Identification payload containing photo or query text.
   * @param validationError Optional schema error from previous turn for retry prompting.
   * @returns Strictly validated Attributes object.
   */
  private async executeGenerateContent(
    model: string,
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
          new ProviderTimeout(this.name, `Gemini request timed out after ${this.timeoutMs}ms.`)
        );
      }, this.timeoutMs);
    });

    let responseText: string | undefined;
    try {
      const callPromise = this.aiClient.models.generateContent({
        model,
        contents: parts,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: attributesJsonSchema,
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      });

      const response = await Promise.race([callPromise, timeoutPromise]);
      responseText = response.text;
    } catch (err: unknown) {
      if (err instanceof ProviderTimeout) {
        throw err;
      }

      // Check for Gemini API rate limits or server errors
      const errString = String(err);
      const isRateLimited =
        errString.includes('429') ||
        errString.includes('RESOURCE_EXHAUSTED') ||
        errString.toLowerCase().includes('rate limit');

      if (isRateLimited) {
        throw new ProviderRateLimited(this.name, `Gemini rate limit exceeded: ${errString}`);
      }

      const isServerFault =
        errString.includes('500') ||
        errString.includes('503') ||
        errString.includes('INTERNAL') ||
        errString.includes('UNAVAILABLE');

      if (isServerFault) {
        throw new ProviderServerError(this.name, `Gemini server fault: ${errString}`);
      }

      throw new ProviderServerError(this.name, `Gemini API execution error: ${errString}`);
    }

    if (!responseText) {
      throw new ProviderInvalidOutput(this.name, 'Gemini returned empty text response.');
    }

    // Strip potential markdown fences
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
        `Invalid JSON output returned by Gemini: ${responseText.slice(0, 100)}`,
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
