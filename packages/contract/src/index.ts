import type { Verdict } from '@zerowastein/rules';

/** High-level error classification codes returned by the classify API. */
export type ClassifyErrorCode =
  'BAD_INPUT' | 'TOO_LARGE' | 'UNSUPPORTED_MEDIA' | 'RATE_LIMITED' | 'PROVIDERS_UNAVAILABLE';

/** Standardized sanitized error payload returned on API failures. */
export interface ClassifyError {
  /** Error category code. */
  readonly code: ClassifyErrorCode;
  /** Safe, user-friendly error message. */
  readonly message: string;
  /** Unique tracking identifier for troubleshooting. */
  readonly requestId: string;
}

/** Operational metadata concerning the classification execution. */
export interface ClassifyMeta {
  /** Source of classification decision: deterministic table or multimodal model. */
  readonly source: 'table' | 'model';
  /** Underlying inference provider used, or null if resolved locally/table. */
  readonly providerUsed: string | null;
  /** True if multi-model cross-checking was executed for this query. */
  readonly crossChecked: boolean;
  /** True if system was operating in degraded fallback mode. */
  readonly degraded: boolean;
}

/** Supported payload types for POST /api/classify requests. */
export type ClassifyRequest =
  | {
      /** Text query mode. */
      readonly mode: 'text';
      /** User-typed waste item label or description. */
      readonly text: string;
    }
  | {
      /** Photo image mode. */
      readonly mode: 'image';
      /** Base64-encoded image data string. */
      readonly image: string;
      /** Declared image media MIME type. */
      readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | string;
    };

/** Successful JSON response payload returned by POST /api/classify. */
export interface ClassifyResponse {
  /** Unique request tracking identifier. */
  readonly requestId: string;
  /** Statutory segregation verdict derived by rules engine. */
  readonly verdict: Verdict;
  /** Display label for the identified item. */
  readonly itemLabel: string;
  /** Execution and provider routing metadata. */
  readonly meta: ClassifyMeta;
  /** Optional error object present when outcome indicates failure. */
  readonly error?: ClassifyError;
}
