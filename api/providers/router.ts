import { CONFIDENCE_HIGH, type Attributes } from '@zerowastein/rules';
import type { AppConfig } from '../config.js';
import { ProviderRateLimited } from './errors.js';
import type { Identifier, IdentifyInput } from './types.js';

/** Result returned by the provider router containing extracted attributes and execution metadata. */
export interface RouterResult {
  /** Extracted item attributes, or null if all providers failed (degraded mode). */
  readonly attributes: Attributes | null;
  /** Name of the provider that produced the primary attributes, or null if degraded. */
  readonly providerUsed: string | null;
  /** True if a second provider successfully performed a cross-check. */
  readonly crossChecked: boolean;
  /** True if the two providers disagreed on any hazard attribute. */
  readonly disagreement: boolean;
  /** True if the router degraded due to all providers failing or being unconfigured. */
  readonly degraded: boolean;
}

/** Internal circuit breaker state tracking health and cooldown intervals per provider. */
interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  lastFailedAt: number;
  retryAfterUntil?: number;
}

/** Checks if any statutory hazard attribute is present on an extracted item. */
function hasHazardAttribute(attributes: Attributes): boolean {
  return (
    attributes.isSharp ||
    attributes.isBattery ||
    attributes.isBulb ||
    attributes.isMedicine ||
    attributes.isChemical ||
    attributes.isElectronic
  );
}

/**
 * Intelligent fallback router coordinating multi-provider inference, circuit breakers, and cross-checking.
 */
export class ProviderRouter {
  /** Configured provider adapters in priority order. */
  private readonly providers: readonly Identifier[];
  /** Validated runtime application configuration. */
  private readonly config: AppConfig;
  /** Injected clock function returning millisecond timestamps for deterministic testing. */
  private readonly now: () => number;
  /** Circuit breaker state record indexed by provider name. */
  private readonly breakerStates = new Map<string, CircuitBreakerState>();

  /**
   * Initializes the provider router with priority chain, configuration, and optional clock.
   *
   * @param providers Ordered list of identifier adapters matching providerOrder.
   * @param config Validated application configuration.
   * @param now Optional clock provider for testing time-based transitions.
   */
  public constructor(
    providers: readonly Identifier[],
    config: AppConfig,
    now: () => number = Date.now
  ) {
    this.providers = providers;
    this.config = config;
    this.now = now;

    for (const p of providers) {
      this.breakerStates.set(p.name, {
        state: 'closed',
        lastFailedAt: 0,
      });
    }
  }

  /**
   * Evaluates input across the provider fallback chain, handling circuit breakers and dual-model cross-checks.
   *
   * @param input Identification payload containing photo or query text.
   * @returns RouterResult containing validated attributes or degraded status.
   */
  public async route(input: IdentifyInput): Promise<RouterResult> {
    const availableProviders = this.getHealthyProviders();

    if (availableProviders.length === 0) {
      return {
        attributes: null,
        providerUsed: null,
        crossChecked: false,
        disagreement: false,
        degraded: true,
      };
    }

    let primaryResult: { attributes: Attributes; provider: Identifier } | null = null;
    let nextAvailableIndex = 0;

    // Phase 1: Identify primary attributes through the fallback chain
    for (let i = 0; i < availableProviders.length; i++) {
      const provider = availableProviders[i]!;
      try {
        const attributes = await provider.identify(input);
        this.recordSuccess(provider.name);
        primaryResult = { attributes, provider };
        nextAvailableIndex = i + 1;
        break;
      } catch (err) {
        this.recordFailure(provider.name, err);
      }
    }

    if (!primaryResult) {
      return {
        attributes: null,
        providerUsed: null,
        crossChecked: false,
        disagreement: false,
        degraded: true,
      };
    }

    const { attributes, provider } = primaryResult;

    // Phase 2: Cross-check if enabled and result is low-confidence or contains hazards
    const isUncertainOrHazardous =
      attributes.confidence < CONFIDENCE_HIGH || hasHazardAttribute(attributes);

    if (this.config.crossCheckEnabled && isUncertainOrHazardous) {
      const remainingHealthy = availableProviders.slice(nextAvailableIndex);
      for (const secondProvider of remainingHealthy) {
        try {
          const secondAttributes = await secondProvider.identify(input);
          this.recordSuccess(secondProvider.name);

          const disagreement =
            attributes.isSharp !== secondAttributes.isSharp ||
            attributes.isBattery !== secondAttributes.isBattery ||
            attributes.isBulb !== secondAttributes.isBulb ||
            attributes.isMedicine !== secondAttributes.isMedicine ||
            attributes.isChemical !== secondAttributes.isChemical ||
            attributes.isElectronic !== secondAttributes.isElectronic;

          return {
            attributes,
            providerUsed: provider.name,
            crossChecked: true,
            disagreement,
            degraded: false,
          };
        } catch (secondErr) {
          this.recordFailure(secondProvider.name, secondErr);
          // If second provider fails, skip silently as specified
        }
      }
    }

    return {
      attributes,
      providerUsed: provider.name,
      crossChecked: false,
      disagreement: false,
      degraded: false,
    };
  }

  /**
   * Filters the configured provider chain to only those permitted by circuit breakers and retry timers.
   *
   * @returns Array of healthy Identifier adapters.
   */
  private getHealthyProviders(): Identifier[] {
    const healthy: Identifier[] = [];
    const currentTime = this.now();

    for (const provider of this.providers) {
      const breaker = this.breakerStates.get(provider.name);
      if (!breaker) {
        healthy.push(provider);
        continue;
      }

      if (breaker.state === 'open') {
        if (breaker.retryAfterUntil !== undefined) {
          if (currentTime >= breaker.retryAfterUntil) {
            breaker.state = 'half-open';
            breaker.retryAfterUntil = undefined;
            healthy.push(provider);
          }
        } else {
          const timeInCooldown = currentTime - breaker.lastFailedAt;
          if (timeInCooldown >= this.config.breakerCooldownMs) {
            breaker.state = 'half-open';
            healthy.push(provider);
          }
        }
      } else {
        healthy.push(provider);
      }
    }

    return healthy;
  }

  /**
   * Records a successful provider request and resets its circuit breaker to closed.
   *
   * @param providerName Target provider identifier.
   */
  public recordSuccess(providerName: string): void {
    const breaker = this.breakerStates.get(providerName);
    if (breaker) {
      breaker.state = 'closed';
      breaker.retryAfterUntil = undefined;
    }
  }

  /**
   * Records a provider failure, opening the circuit breaker and scheduling cooldown or retry-after.
   *
   * @param providerName Target provider identifier.
   * @param error Caught error from provider invocation.
   */
  public recordFailure(providerName: string, error: unknown): void {
    const breaker = this.breakerStates.get(providerName);
    if (!breaker) {
      return;
    }

    breaker.state = 'open';
    breaker.lastFailedAt = this.now();

    if (error instanceof ProviderRateLimited && error.retryAfterMs !== undefined) {
      breaker.retryAfterUntil = this.now() + error.retryAfterMs;
    } else {
      breaker.retryAfterUntil = undefined;
    }
  }
}
