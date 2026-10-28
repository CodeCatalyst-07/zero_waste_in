import type { ClassifyErrorCode, ClassifyRequest, ClassifyResponse } from '@zerowastein/contract';

/** Typed application client error wrapping network or server classification failures. */
export class ClassificationApiError extends Error {
  /** Canonical error code or client-side status identifier. */
  readonly code: ClassifyErrorCode | 'NETWORK_ERROR' | 'TIMEOUT_ERROR' | 'INVALID_RESPONSE';

  /**
   * Initializes a user-friendly classification error.
   *
   * @param code Machine-readable classification error code.
   * @param friendlyMessage Sanitized plain-English explanation for users.
   */
  constructor(
    code: ClassifyErrorCode | 'NETWORK_ERROR' | 'TIMEOUT_ERROR' | 'INVALID_RESPONSE',
    friendlyMessage: string
  ) {
    super(friendlyMessage);
    this.name = 'ClassificationApiError';
    this.code = code;
  }
}

/** Default API timeout limit in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15000;

/** Friendly user copy corresponding to serverless error codes. */
export const ERROR_MESSAGES: Record<ClassifyErrorCode, string> = {
  RATE_LIMITED: 'Busy right now. Try again in a minute, or type the item.',
  PROVIDERS_UNAVAILABLE: "Photo check isn't available right now. Type the item instead.",
  UNSUPPORTED_MEDIA: "We couldn't read that image. Try a JPEG or PNG photo.",
  TOO_LARGE: 'That photo is too large. Please select an image under 1 MB.',
  BAD_INPUT: 'Please check your input and try again, or select a common item.',
};

/**
 * Validates that an unknown payload conforms to the ClassifyResponse contract without importing schema libraries.
 *
 * @param data Parsed JSON response body.
 * @returns True if payload matches the ClassifyResponse structure.
 */
export function isClassifyResponse(data: unknown): data is ClassifyResponse {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const candidate = data as Partial<ClassifyResponse>;
  if (typeof candidate.requestId !== 'string') {
    return false;
  }
  if (!candidate.verdict || typeof candidate.verdict !== 'object') {
    return false;
  }
  const kind = (candidate.verdict as { kind?: unknown }).kind;
  if (kind !== 'answer' && kind !== 'ask' && kind !== 'unclear') {
    return false;
  }
  return true;
}

/**
 * Sends a typed classification request to /api/classify with timeout and resilient error handling.
 *
 * @param request Text query or image classification payload.
 * @param signal Optional external AbortSignal to cancel in-flight request.
 * @returns Validated classification response.
 */
export async function classifyItem(
  request: ClassifyRequest,
  signal?: AbortSignal
): Promise<ClassifyResponse> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort();
  }, DEFAULT_TIMEOUT_MS);

  // Combine external abort signal if provided
  if (signal) {
    signal.addEventListener('abort', () => timeoutController.abort(), { once: true });
  }

  try {
    const response = await fetch('/api/classify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: timeoutController.signal,
    });

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = null;
    }

    if (!response.ok) {
      const serverCode = (json as { error?: { code?: string } })?.error?.code as
        ClassifyErrorCode | undefined;
      const friendlyMessage =
        (serverCode && ERROR_MESSAGES[serverCode]) || ERROR_MESSAGES.PROVIDERS_UNAVAILABLE;

      throw new ClassificationApiError(serverCode ?? 'PROVIDERS_UNAVAILABLE', friendlyMessage);
    }

    if (!isClassifyResponse(json)) {
      throw new ClassificationApiError(
        'INVALID_RESPONSE',
        "Photo check isn't available right now. Type the item instead."
      );
    }

    return json;
  } catch (err: unknown) {
    if (err instanceof ClassificationApiError) {
      throw err;
    }

    if (signal?.aborted) {
      throw new ClassificationApiError('TIMEOUT_ERROR', 'Request was cancelled.');
    }

    if (timeoutController.signal.aborted) {
      throw new ClassificationApiError(
        'TIMEOUT_ERROR',
        'Request timed out. Please try typing the item instead.'
      );
    }

    if (!navigator.onLine) {
      throw new ClassificationApiError(
        'NETWORK_ERROR',
        "You're offline. Typing and common items still work."
      );
    }

    throw new ClassificationApiError(
      'NETWORK_ERROR',
      'Network connection issue. Type the item instead or try again.'
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
