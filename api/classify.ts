import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ClassifyErrorCode } from '@zerowastein/contract';
import { decide, lookupByText, rulesTable, type Attributes } from '@zerowastein/rules';
import { loadConfig, type AppConfig } from './config.js';
import { createRouter, type ProviderRouter } from './providers/index.js';
import { consumeRateLimitToken } from './rate-limit.js';

/** Vercel Node runtime serverless request contract. */
export interface VercelRequest extends IncomingMessage {
  /** Parsed request body object or stream. */
  body?: unknown;
  /** Parsed URL query parameters map. */
  query?: Record<string, string | string[]>;
  /** Parsed request cookies map. */
  cookies?: Record<string, string>;
}

/** Vercel Node runtime serverless response contract. */
export interface VercelResponse extends ServerResponse {
  /** Sets the HTTP status code for the response. */
  status(statusCode: number): VercelResponse;
  /** Serializes and sends JSON response body with appropriate headers. */
  json(jsonBody: unknown): VercelResponse;
  /** Sends raw text or buffer response. */
  send(body: unknown): VercelResponse;
}

/** Supported image MIME types permitted by the intake pipeline. */
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Control characters regular expression for rejecting malicious control inputs. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_REGEX = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Validates that binary file bytes match the declared image media type headers.
 *
 * @param buffer Decoded image buffer.
 * @param mimeType Declared MIME type string.
 * @returns True if magic signature bytes match declared image format.
 */
function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 12) {
    return false;
  }

  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  if (mimeType === 'image/webp') {
    const isRiff =
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;
    const isWebp =
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
    return isRiff && isWebp;
  }

  return false;
}

/**
 * Sends a sanitized standardized JSON error payload to the client.
 *
 * @param res Serverless response object.
 * @param statusCode HTTP status code.
 * @param code High-level error classification code.
 * @param message User-friendly safe error explanation.
 * @param requestId Unique tracking identifier.
 */
function sendErrorResponse(
  res: VercelResponse,
  statusCode: number,
  code: ClassifyErrorCode,
  message: string,
  requestId: string
): void {
  res.status(statusCode).json({
    error: {
      code,
      message,
      requestId,
    },
  });
}

/** Cached application configuration instance. */
let cachedConfig: AppConfig | null = null;
/** Cached provider router instance. */
let cachedRouter: ProviderRouter | null = null;

/**
 * Retrieves or initializes the shared configuration and router singletons.
 *
 * @returns Config and router instances.
 */
function getSystemContext(): { config: AppConfig; router: ProviderRouter } {
  if (!cachedConfig || !cachedRouter) {
    cachedConfig = loadConfig();
    cachedRouter = createRouter(cachedConfig);
  }
  return { config: cachedConfig, router: cachedRouter };
}

/**
 * Sets or overrides the cached system configuration and router (primarily for testing suites).
 *
 * @param custom Context object containing config and router, or null to reset.
 */
export function setSystemContext(
  custom: { config: AppConfig; router: ProviderRouter } | null
): void {
  if (!custom) {
    cachedConfig = null;
    cachedRouter = null;
  } else {
    cachedConfig = custom.config;
    cachedRouter = custom.router;
  }
}

/**
 * Resets the cached router context (primarily for testing suites).
 */
export function resetSystemContext(): void {
  cachedConfig = null;
  cachedRouter = null;
}

/**
 * Serverless endpoint handler for waste item classification per SWM Rules 2026.
 *
 * @param req Incoming HTTP request containing image or text query.
 * @param res Outgoing HTTP response returning stream classification or error.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  let outcomeCode = 200;
  let modeTag: string | null = null;
  let providerUsed: string | null = null;

  try {
    const { config, router } = getSystemContext();

    // 1. Method verification
    if (req.method !== 'POST') {
      outcomeCode = 400;
      sendErrorResponse(res, 400, 'BAD_INPUT', 'Only POST requests are supported.', requestId);
      return;
    }

    // 2. Content-type verification
    const contentType = req.headers ? (req.headers['content-type'] ?? '') : '';
    if (
      typeof contentType !== 'string' ||
      !contentType.toLowerCase().includes('application/json')
    ) {
      outcomeCode = 400;
      sendErrorResponse(res, 400, 'BAD_INPUT', 'Content-Type must be application/json.', requestId);
      return;
    }

    // 3. Best-effort in-memory rate limiting
    // Note: Serverless instances do not share memory across containers. Client IP may be spoofed.
    const rawIpHeader = req.headers
      ? (req.headers['x-forwarded-for'] ?? req.headers['x-real-ip'])
      : undefined;
    const clientIp =
      typeof rawIpHeader === 'string' ? rawIpHeader.split(',')[0]?.trim() || 'anon' : 'anon';

    const isAllowed = consumeRateLimitToken(clientIp, config.rateLimitPerMinute);
    if (!isAllowed) {
      outcomeCode = 429;
      sendErrorResponse(
        res,
        429,
        'RATE_LIMITED',
        'Too many requests. Please wait a moment before trying again.',
        requestId
      );
      return;
    }

    // 4. Request body parsing and validation
    let body = req.body as Record<string, unknown> | undefined;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // invalid JSON string handled below
      }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      outcomeCode = 400;
      sendErrorResponse(res, 400, 'BAD_INPUT', 'Invalid JSON request body.', requestId);
      return;
    }

    const mode = body['mode'];
    if (mode !== 'text' && mode !== 'image') {
      outcomeCode = 400;
      sendErrorResponse(
        res,
        400,
        'BAD_INPUT',
        'Field "mode" must be "text" or "image".',
        requestId
      );
      return;
    }

    modeTag = mode;

    // -------------------------------------------------------------------------
    // TEXT MODE PIPELINE
    // -------------------------------------------------------------------------
    if (mode === 'text') {
      const rawText = body['text'];
      if (typeof rawText !== 'string') {
        outcomeCode = 400;
        sendErrorResponse(res, 400, 'BAD_INPUT', 'Field "text" must be a string.', requestId);
        return;
      }

      const trimmedText = rawText.trim();
      if (trimmedText.length === 0) {
        outcomeCode = 400;
        sendErrorResponse(res, 400, 'BAD_INPUT', 'Text query cannot be empty.', requestId);
        return;
      }

      if (trimmedText.length > config.maxTextLength) {
        outcomeCode = 400;
        sendErrorResponse(
          res,
          400,
          'BAD_INPUT',
          `Text query exceeds maximum allowed length of ${config.maxTextLength} characters.`,
          requestId
        );
        return;
      }

      if (CONTROL_CHAR_REGEX.test(trimmedText)) {
        outcomeCode = 400;
        sendErrorResponse(
          res,
          400,
          'BAD_INPUT',
          'Text query contains invalid control characters.',
          requestId
        );
        return;
      }

      // Text Fast Path: Check deterministic rules table lookup
      const candidates = lookupByText(trimmedText, rulesTable.rules);
      const isSingleClearMatch =
        candidates.length === 1 ||
        (candidates.length > 1 && candidates[0]!.score > candidates[1]!.score);

      if (isSingleClearMatch) {
        const winningRow = candidates[0]!.row;
        const fastAttributes: Attributes = {
          item: winningRow.id,
          isSharp:
            winningRow.flags.includes('wrap_before_disposal') &&
            winningRow.stream === 'special_care',
          isBattery: winningRow.flags.includes('separate_regime_battery'),
          isBulb: winningRow.id.includes('bulb') || winningRow.id.includes('light'),
          isMedicine: winningRow.flags.includes('no_dosing_advice'),
          isChemical:
            winningRow.id.includes('chemical') ||
            winningRow.id.includes('paint') ||
            winningRow.id.includes('pesticide'),
          isElectronic: winningRow.flags.includes('separate_regime_ewaste'),
          isHygiene: winningRow.stream === 'sanitary',
          isFood:
            winningRow.stream === 'wet' &&
            (winningRow.id.includes('food') ||
              winningRow.id.includes('peel') ||
              winningRow.id.includes('scrap')),
          isGarden:
            winningRow.stream === 'wet' &&
            (winningRow.id.includes('garden') || winningRow.id.includes('leaf')),
          evidence: [`Direct text match: ${winningRow.label}`],
          confidence: 1.0,
        };

        const verdict = decide(fastAttributes, rulesTable.rules);
        res.status(200).json({
          requestId,
          verdict,
          itemLabel: winningRow.label,
          meta: {
            source: 'table',
            providerUsed: null,
            crossChecked: false,
            degraded: false,
          },
        });
        return;
      }

      // Ambiguous or no-match query: Fall back to model attribute extraction if configured
      if (config.providerOrder.length > 0) {
        const routerResult = await router.route({ textQuery: trimmedText });
        if (routerResult.attributes) {
          providerUsed = routerResult.providerUsed;
          const verdict = decide(routerResult.attributes, rulesTable.rules, {
            disagreement: routerResult.disagreement,
          });

          res.status(200).json({
            requestId,
            verdict,
            itemLabel: verdict.kind === 'answer' ? verdict.itemLabel : trimmedText,
            meta: {
              source: 'model',
              providerUsed: routerResult.providerUsed,
              crossChecked: routerResult.crossChecked,
              degraded: routerResult.degraded,
            },
          });
          return;
        }
      }

      // No provider configured or all providers degraded: Return helpful common-item guidance
      res.status(200).json({
        requestId,
        verdict: {
          kind: 'unclear',
          itemLabel: trimmedText,
          guidance:
            'We could not match this item with certainty. Please pick a common item from the list below or check with your municipal body.',
          flags: ['rules_vary_by_city'],
          rowId: 'unknown',
        },
        itemLabel: trimmedText,
        meta: {
          source: 'table',
          providerUsed: null,
          crossChecked: false,
          degraded: true,
        },
      });
      return;
    }

    // -------------------------------------------------------------------------
    // IMAGE MODE PIPELINE
    // -------------------------------------------------------------------------
    const rawImage = body['image'];
    const rawMimeType = body['mimeType'];

    if (typeof rawImage !== 'string' || !rawImage.trim()) {
      outcomeCode = 400;
      sendErrorResponse(
        res,
        400,
        'BAD_INPUT',
        'Field "image" must be a non-empty base64 string.',
        requestId
      );
      return;
    }

    if (typeof rawMimeType !== 'string' || !ALLOWED_MIME_TYPES.has(rawMimeType.toLowerCase())) {
      outcomeCode = 415;
      sendErrorResponse(
        res,
        415,
        'UNSUPPORTED_MEDIA',
        'MIME type must be image/jpeg, image/png, or image/webp.',
        requestId
      );
      return;
    }

    const mimeType = rawMimeType.toLowerCase();

    // Decode and validate base64 image payload
    let imageBuffer: Buffer;
    try {
      imageBuffer = Buffer.from(rawImage, 'base64');
    } catch {
      outcomeCode = 400;
      sendErrorResponse(res, 400, 'BAD_INPUT', 'Invalid base64 encoding.', requestId);
      return;
    }

    if (imageBuffer.length === 0) {
      outcomeCode = 400;
      sendErrorResponse(res, 400, 'BAD_INPUT', 'Image payload cannot be empty.', requestId);
      return;
    }

    if (imageBuffer.length > config.maxUploadBytes) {
      outcomeCode = 413;
      sendErrorResponse(
        res,
        413,
        'TOO_LARGE',
        `Image payload exceeds maximum allowable size of ${config.maxUploadBytes} bytes.`,
        requestId
      );
      return;
    }

    // Verify magic signature bytes match declared MIME type
    if (!validateMagicBytes(imageBuffer, mimeType)) {
      outcomeCode = 415;
      sendErrorResponse(
        res,
        415,
        'UNSUPPORTED_MEDIA',
        'Image file signatures do not match declared MIME type.',
        requestId
      );
      return;
    }

    // Execute vision attribute extraction across the provider chain
    const routerResult = await router.route({
      imageBase64: rawImage,
      mimeType,
    });

    if (routerResult.degraded || !routerResult.attributes) {
      outcomeCode = 503;
      sendErrorResponse(
        res,
        503,
        'PROVIDERS_UNAVAILABLE',
        'Vision providers are temporarily unavailable. Please try typing the item name instead.',
        requestId
      );
      return;
    }

    providerUsed = routerResult.providerUsed;

    const verdict = decide(routerResult.attributes, rulesTable.rules, {
      disagreement: routerResult.disagreement,
    });

    res.status(200).json({
      requestId,
      verdict,
      itemLabel:
        verdict.kind === 'answer'
          ? verdict.itemLabel
          : routerResult.attributes.item || 'Identified item',
      meta: {
        source: 'model',
        providerUsed: routerResult.providerUsed,
        crossChecked: routerResult.crossChecked,
        degraded: false,
      },
    });
  } catch (err: unknown) {
    outcomeCode = 500;
    console.error('Unhandled classification error:', err);
    sendErrorResponse(
      res,
      500,
      'PROVIDERS_UNAVAILABLE',
      'An unexpected error occurred. Please try searching with item text.',
      requestId
    );
  } finally {
    // Structured observability log containing zero image bytes and zero request content
    const latencyMs = Date.now() - startTime;
    console.log(
      JSON.stringify({
        requestId,
        mode: modeTag ?? 'unknown',
        providerUsed,
        latencyMs,
        outcomeCode,
      })
    );
  }
}
