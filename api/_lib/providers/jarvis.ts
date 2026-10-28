import type { Attributes } from '@zerowastein/rules';
import type { JarvisProviderConfig } from '../config.js';
import { SYSTEM_PROMPT, buildUserPrompt } from '../prompt.js';
import { parseAttributesPayload } from '../schemas.js';
import {
  ProviderInvalidOutput,
  ProviderNotConfigured,
  ProviderRateLimited,
  ProviderServerError,
  ProviderTimeout,
} from './errors.js';
import type { Identifier, IdentifyInput } from './types.js';

/** Identifier adapter for Gemma 4 running on Jarvis Labs OpenAI-compatible inference server. */
export class JarvisIdentifier implements Identifier {
  /** Unique provider tag. */
  public readonly name = 'jarvis';

  /** Validated runtime configuration. */
  public readonly config: JarvisProviderConfig;

  /** Network timeout limit in milliseconds. */
  private readonly timeoutMs: number;

  /**
   * Initializes the Jarvis Labs provider adapter with validated configuration.
   *
   * @param config Validated Jarvis provider settings.
   * @param timeoutMs Optional network timeout limit in milliseconds.
   */
  public constructor(config: JarvisProviderConfig, timeoutMs = 15000) {
    this.config = config;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Extracts attributes using Gemma 4 on Jarvis Labs OpenAI-compatible completions endpoint.
   *
   * @param input Item image or description.
   * @returns Extracted waste classification attributes.
   */
  public async identify(input: IdentifyInput): Promise<Attributes> {
    if (!this.config.apiKey) {
      throw new ProviderNotConfigured(this.name, 'Jarvis Labs API key is missing.');
    }

    // Try initial execution, with automatic single retry on schema/JSON parse failure
    let firstError: string | undefined;
    try {
      return await this.executeCompletion(input);
    } catch (err) {
      if (err instanceof ProviderInvalidOutput) {
        firstError = err.message;
      } else {
        throw err;
      }
    }

    // Single retry with validation error feedback appended to user prompt
    try {
      return await this.executeCompletion(input, firstError);
    } catch (err) {
      if (err instanceof ProviderInvalidOutput) {
        throw err;
      }
      throw new ProviderInvalidOutput(
        this.name,
        `Jarvis model output failed schema validation on retry: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Dispatches chat completions request with timeout, schema formatting, and extra body merging.
   *
   * @param input Identification payload with photo or text query.
   * @param validationError Optional schema error from previous turn for retry prompting.
   * @returns Validated Attributes object.
   */
  private async executeCompletion(
    input: IdentifyInput,
    validationError?: string
  ): Promise<Attributes> {
    // TODO: Verify the exact image-input format in the Jarvis Labs playground/docs (image_url data URL vs multipart upload).
    // TODO: Verify response_format { type: "json_object" } support on Gemma 4 in the Jarvis Labs documentation.
    // TODO: Verify the exact reasoning-off parameter for Gemma 4 in the Jarvis Labs documentation (to configure via JARVIS_EXTRA_BODY_JSON).

    const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

    const userText = buildUserPrompt(input.textQuery, validationError);
    contentParts.push({ type: 'text', text: userText });

    if (input.imageBase64 && input.mimeType) {
      contentParts.push({
        type: 'image_url',
        image_url: {
          url: `data:${input.mimeType};base64,${input.imageBase64}`,
        },
      });
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: contentParts },
    ];

    const baseRequestBody: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages,
      ...(this.config.extraBodyJson ?? {}),
    };

    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(baseRequestBody),
        signal: controller.signal,
      });

      // Degrade to prompt-enforced JSON if API rejects response_format (HTTP 400 with format error)
      if (response.status === 400) {
        delete baseRequestBody['response_format'];
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(baseRequestBody),
          signal: controller.signal,
        });
      }
    } catch (fetchErr: unknown) {
      if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
        throw new ProviderTimeout(
          this.name,
          `Jarvis Labs request timed out after ${this.timeoutMs}ms.`
        );
      }
      throw new ProviderServerError(
        this.name,
        `Network error contacting Jarvis Labs: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 429) {
      const retryHeader = response.headers.get('retry-after');
      let retryMs: number | undefined;
      if (retryHeader) {
        const seconds = parseInt(retryHeader, 10);
        if (!isNaN(seconds)) {
          retryMs = seconds * 1000;
        }
      }
      throw new ProviderRateLimited(this.name, 'Jarvis Labs rate limit reached', retryMs);
    }

    if (!response.ok) {
      throw new ProviderServerError(
        this.name,
        `Jarvis Labs returned HTTP ${response.status}`,
        response.status
      );
    }

    let payload: { choices?: Array<{ message?: { content?: string } }> };
    try {
      payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    } catch {
      throw new ProviderInvalidOutput(
        this.name,
        'Failed to parse JSON response envelope from Jarvis Labs'
      );
    }

    const rawContent = payload.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new ProviderInvalidOutput(
        this.name,
        'Jarvis Labs returned empty completion choice content'
      );
    }

    // Strip markdown code fences if present
    const cleanedJson = rawContent
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanedJson);
    } catch {
      throw new ProviderInvalidOutput(
        this.name,
        `Invalid JSON returned by Jarvis Labs: ${rawContent.slice(0, 100)}`,
        rawContent
      );
    }

    try {
      return parseAttributesPayload(parsed);
    } catch (validationErr) {
      throw new ProviderInvalidOutput(
        this.name,
        `Attributes schema violation: ${validationErr instanceof Error ? validationErr.message : String(validationErr)}`,
        rawContent
      );
    }
  }
}
