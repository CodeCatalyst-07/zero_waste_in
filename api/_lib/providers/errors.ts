/** Base error class representing upstream AI vision inference failures. */
export abstract class ProviderError extends Error {
  /** Target provider name that experienced the fault. */
  public readonly provider: string;

  /**
   * Initializes base provider error instance.
   *
   * @param provider Provider identifier tag.
   * @param message Descriptive error message.
   */
  protected constructor(provider: string, message: string) {
    super(message);
    this.name = this.constructor.name;
    this.provider = provider;
  }
}

/** Error thrown when an AI provider exceeds its rate limit or quota. */
export class ProviderRateLimited extends ProviderError {
  /** Optional delay in milliseconds advised by the upstream service before retrying. */
  public readonly retryAfterMs?: number;

  /**
   * Initializes rate limit error.
   *
   * @param provider Provider identifier tag.
   * @param message Descriptive rate limit message.
   * @param retryAfterMs Optional wait time in milliseconds.
   */
  public constructor(
    provider: string,
    message = 'Provider rate limit exceeded',
    retryAfterMs?: number
  ) {
    super(provider, message);
    this.retryAfterMs = retryAfterMs;
  }
}

/** Error thrown when a provider request times out. */
export class ProviderTimeout extends ProviderError {
  /**
   * Initializes provider timeout error.
   *
   * @param provider Provider identifier tag.
   * @param message Descriptive timeout message.
   */
  public constructor(provider: string, message = 'Provider request timed out') {
    super(provider, message);
  }
}

/** Error thrown when an upstream provider returns an internal HTTP 5xx or connection fault. */
export class ProviderServerError extends ProviderError {
  /** Upstream HTTP status code if available. */
  public readonly statusCode?: number;

  /**
   * Initializes server fault error.
   *
   * @param provider Provider identifier tag.
   * @param message Descriptive server fault message.
   * @param statusCode Optional upstream HTTP status code.
   */
  public constructor(
    provider: string,
    message = 'Provider internal server error',
    statusCode?: number
  ) {
    super(provider, message);
    this.statusCode = statusCode;
  }
}

/** Error thrown when a provider response fails JSON parsing or strict Zod schema validation after retry. */
export class ProviderInvalidOutput extends ProviderError {
  /** Raw textual response received from the model. */
  public readonly rawOutput?: string;
  /** Schema validation error messages. */
  public readonly validationErrors?: readonly string[];

  /**
   * Initializes invalid model output error.
   *
   * @param provider Provider identifier tag.
   * @param message Descriptive validation error message.
   * @param rawOutput Raw unparseable text.
   * @param validationErrors Specific validation errors.
   */
  public constructor(
    provider: string,
    message = 'Provider output failed schema validation',
    rawOutput?: string,
    validationErrors?: readonly string[]
  ) {
    super(provider, message);
    this.rawOutput = rawOutput;
    this.validationErrors = validationErrors;
  }
}

/** Error thrown when a requested provider lacks valid API credentials or model settings. */
export class ProviderNotConfigured extends ProviderError {
  /**
   * Initializes unconfigured provider error.
   *
   * @param provider Provider identifier tag.
   * @param message Descriptive configuration failure message.
   */
  public constructor(provider: string, message = 'Provider is not configured') {
    super(provider, message);
  }
}
