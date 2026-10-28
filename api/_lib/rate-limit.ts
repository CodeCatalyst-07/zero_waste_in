/**
 * ARCHITECTURAL NOTE ON SERVERLESS RATE LIMITING:
 * In a serverless environment (such as Vercel Edge / Node runtime), individual function instances
 * execute in ephemeral containers that do NOT share process memory. This in-memory token bucket is
 * therefore a best-effort defense against rapid client flooding on the same instance.
 * Furthermore, HTTP headers used to identify clients (such as x-forwarded-for or x-real-ip) can be
 * spoofed by untrusted clients unless stripped or validated by an upstream CDN or trusted edge proxy.
 */

/** Internal state of a token bucket for a specific client key. */
interface Bucket {
  tokens: number;
  lastRefillTime: number;
}

/** In-memory registry of active token buckets per client IP. */
const buckets = new Map<string, Bucket>();

/** Maximum number of client buckets retained in memory to prevent memory bloat. */
const MAX_BUCKET_ENTRIES = 5000;

/**
 * Checks and consumes a token from the client's token bucket, enforcing the rolling per-minute rate limit.
 *
 * @param clientKey Unique client identifier (e.g., sanitized IP address).
 * @param limitPerMinute Maximum allowable requests per rolling 60-second window.
 * @param now Optional millisecond timestamp provider for deterministic testing.
 * @returns True if request is allowed, false if client is rate limited.
 */
export function consumeRateLimitToken(
  clientKey: string,
  limitPerMinute: number,
  now = Date.now()
): boolean {
  if (limitPerMinute <= 0) {
    return true;
  }

  // Prevent memory leaks in long-running container instances
  if (buckets.size > MAX_BUCKET_ENTRIES) {
    const evictionThreshold = now - 120000;
    for (const [key, b] of buckets.entries()) {
      if (b.lastRefillTime < evictionThreshold) {
        buckets.delete(key);
      }
    }
  }

  let bucket = buckets.get(clientKey);
  if (!bucket) {
    bucket = {
      tokens: limitPerMinute - 1,
      lastRefillTime: now,
    };
    buckets.set(clientKey, bucket);
    return true;
  }

  // Refill tokens based on elapsed milliseconds
  const elapsedMs = Math.max(0, now - bucket.lastRefillTime);
  const refillTokens = (elapsedMs * limitPerMinute) / 60000;

  bucket.tokens = Math.min(limitPerMinute, bucket.tokens + refillTokens);
  bucket.lastRefillTime = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }

  return false;
}

/**
 * Clears in-memory rate limiting buckets (primarily for testing suites).
 */
export function resetRateLimits(): void {
  buckets.clear();
}
