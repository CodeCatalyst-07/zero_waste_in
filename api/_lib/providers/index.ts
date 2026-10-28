import type { AppConfig } from '../config.js';
import { GeminiIdentifier } from './gemini.js';
import { GemmaGeminiIdentifier } from './gemma-gemini.js';
import { JarvisIdentifier } from './jarvis.js';
import { ProviderRouter } from './router.js';
import type { Identifier } from './types.js';

export * from './errors.js';
export * from './gemini.js';
export * from './gemma-gemini.js';
export * from './jarvis.js';
export * from './router.js';
export * from './types.js';

/**
 * Instantiates the active provider chain in priority sequence from validated configuration.
 *
 * @param config Validated application configuration.
 * @returns Ordered array of configured Identifier adapters.
 */
export function createProviderChain(config: AppConfig): Identifier[] {
  const chain: Identifier[] = [];

  for (const name of config.providerOrder) {
    if (name === 'jarvis' && config.jarvis) {
      chain.push(new JarvisIdentifier(config.jarvis, config.requestTimeoutMs));
    } else if (name === 'gemini' && config.gemini) {
      chain.push(new GeminiIdentifier(config.gemini, config.requestTimeoutMs));
    } else if (name === 'gemma_gemini' && config.gemmaGemini) {
      chain.push(new GemmaGeminiIdentifier(config.gemmaGemini, config.requestTimeoutMs));
    }
  }

  return chain;
}

/**
 * Creates a configured ProviderRouter instance with active provider adapters.
 *
 * @param config Validated application configuration.
 * @param now Optional clock provider for testing time-based transitions.
 * @returns Initialized ProviderRouter instance.
 */
export function createRouter(config: AppConfig, now: () => number = Date.now): ProviderRouter {
  const chain = createProviderChain(config);
  return new ProviderRouter(chain, config, now);
}
