import type { Attributes, Stream } from '@zerowastein/rules';

export type { Attributes, Stream };

/** Input payload supplied to vision or language model identification providers. */
export interface IdentifyInput {
  /** Optional base64-encoded image data or binary representation of photo. */
  readonly imageBase64?: string;
  /** Optional MIME type for uploaded photo (e.g. image/jpeg, image/png, image/webp). */
  readonly mimeType?: string;
  /** Optional user-typed search text describing the discarded item. */
  readonly textQuery?: string;
}

/** Standard contract required for all AI vision classification adapters. */
export interface Identifier {
  /** Identifier name matching ProviderName. */
  readonly name: string;
  /**
   * Identifies physical item attributes from image or text input.
   *
   * @param input Identification payload containing photo or query text.
   * @returns Extracted physical attributes for rules classification.
   */
  identify(input: IdentifyInput): Promise<Attributes>;
}
