import type { RankedCandidate, RuleRow } from './types.js';

/**
 * Normalizes text strings for deterministic lookup by lowercasing, trimming, and stripping punctuation.
 *
 * @param input Raw search query or item label.
 * @returns Clean normalized string suitable for comparison.
 */
export function normalizeLabel(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministically finds a rule row matching an item identifier, label, or alias.
 *
 * @param item Raw item string (identifier slug or descriptive name).
 * @param table Canonical rule table dataset.
 * @returns Matching RuleRow if found, or null.
 */
export function findMatchingRow(item: string, table: readonly RuleRow[]): RuleRow | null {
  const trimmed = item.trim();
  if (!trimmed) {
    return null;
  }

  const directIdMatch = table.find((r) => r.id === trimmed);
  if (directIdMatch) {
    return directIdMatch;
  }

  const norm = normalizeLabel(trimmed);
  if (!norm) {
    return null;
  }

  const normIdMatch = table.find((r) => normalizeLabel(r.id) === norm);
  if (normIdMatch) {
    return normIdMatch;
  }

  const labelMatch = table.find((r) => normalizeLabel(r.label) === norm);
  if (labelMatch) {
    return labelMatch;
  }

  const aliasMatch = table.find((r) => r.aliases.some((alias) => normalizeLabel(alias) === norm));
  if (aliasMatch) {
    return aliasMatch;
  }

  return null;
}

/**
 * Performs deterministic search and ranked scoring for typed-text item queries against the rules table.
 *
 * @param query Freeform citizen search text.
 * @param table Canonical rule table dataset.
 * @returns Deterministically ranked candidate matches.
 */
export function lookupByText(query: string, table: readonly RuleRow[]): readonly RankedCandidate[] {
  const normQuery = normalizeLabel(query);
  if (!normQuery) {
    return [];
  }

  const queryWords = normQuery.split(' ').filter(Boolean);
  const candidates: RankedCandidate[] = [];

  for (const row of table) {
    const normId = normalizeLabel(row.id);
    const normLabel = normalizeLabel(row.label);
    const normAliases = row.aliases.map(normalizeLabel);

    let score = 0;

    if (row.id === query.trim() || normId === normQuery) {
      score = 100;
    } else if (normLabel === normQuery) {
      score = 95;
    } else if (normAliases.includes(normQuery)) {
      score = 90;
    } else if (normLabel.startsWith(normQuery)) {
      score = 80;
    } else if (normAliases.some((alias) => alias.startsWith(normQuery))) {
      score = 75;
    } else if (normLabel.includes(normQuery)) {
      score = 65;
    } else if (normAliases.some((alias) => alias.includes(normQuery))) {
      score = 60;
    } else if (
      queryWords.length > 0 &&
      queryWords.every(
        (word) => normLabel.includes(word) || normAliases.some((a) => a.includes(word))
      )
    ) {
      score = 45;
    } else if (
      queryWords.some(
        (word) =>
          word.length >= 3 &&
          (normLabel.split(' ').includes(word) ||
            normAliases.some((a) => a.split(' ').includes(word)))
      )
    ) {
      score = 25;
    }

    if (score > 0) {
      candidates.push({ row, score });
    }
  }

  return candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.row.id.localeCompare(b.row.id);
  });
}
