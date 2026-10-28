import { describe, expect, it } from 'vitest';

/**
 * Computes standard WCAG 2.1 relative luminance from a 6-digit hex color string.
 *
 * @param hex Hex color code starting with '#' (e.g. '#1E7B3A').
 * @returns Relative luminance value between 0.0 (black) and 1.0 (white).
 */
export function calculateRelativeLuminance(hex: string): number {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.slice(0, 2), 16) / 255;
  const g = parseInt(cleanHex.slice(2, 4), 16) / 255;
  const b = parseInt(cleanHex.slice(4, 6), 16) / 255;

  const toLinear = (c: number): number =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  const rLinear = toLinear(r);
  const gLinear = toLinear(g);
  const bLinear = toLinear(b);

  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

/**
 * Computes WCAG 2.1 contrast ratio between two hex colors.
 *
 * @param hex1 First color code.
 * @param hex2 Second color code.
 * @returns Contrast ratio formatted to two decimal places (e.g. 5.32).
 */
export function calculateContrastRatio(hex1: string, hex2: string): number {
  const lum1 = calculateRelativeLuminance(hex1);
  const lum2 = calculateRelativeLuminance(hex2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Number(ratio.toFixed(2));
}

describe('WCAG 2.1 Contrast Ratio Verification across tokens.css', () => {
  const TOKENS = {
    white: '#FFFFFF',
    // Stream solids
    streamWet: '#1E7B3A',
    streamDry: '#1F5FBF',
    streamSanitary: '#B3261E',
    streamSpecialCare: '#26262B',
    hazardAccent: '#B45309',

    // Light Theme
    bgLight: '#FAF7F2',
    surfaceLight: '#FFFFFF',
    inkLight: '#1B1B1F',
    inkMutedLight: '#55555C',
    borderUiLight: '#8F8C85',
    focusLight: '#1F5FBF',

    wetTintLight: '#E8F5E9',
    wetInkLight: '#0D381A',
    dryTintLight: '#E8F0FE',
    dryInkLight: '#0E2A54',
    sanitaryTintLight: '#FDE8E8',
    sanitaryInkLight: '#49100B',
    specialTintLight: '#F3F4F6',
    specialInkLight: '#121215',

    // Dark Theme
    bgDark: '#121214',
    surfaceDark: '#1E1E22',
    inkDark: '#F5F2EB',
    inkMutedDark: '#A3A099',
    borderUiDark: '#7A7872',
    focusDark: '#A8CBFF',

    wetTintDark: '#0F3819',
    wetInkDark: '#A3E9B4',
    dryTintDark: '#0F2D59',
    dryInkDark: '#A8CBFF',
    sanitaryTintDark: '#4A120F',
    sanitaryInkDark: '#FFB3AE',
    specialTintDark: '#1C1C20',
    specialInkDark: '#D1D1D6',
  };

  describe('Text Contrast Ratios (Minimum 4.5:1 for WCAG Level AA)', () => {
    it('stream solid colors with white text exceed 4.5:1', () => {
      expect(calculateContrastRatio(TOKENS.streamWet, TOKENS.white)).toBeGreaterThanOrEqual(4.5);
      expect(calculateContrastRatio(TOKENS.streamDry, TOKENS.white)).toBeGreaterThanOrEqual(4.5);
      expect(calculateContrastRatio(TOKENS.streamSanitary, TOKENS.white)).toBeGreaterThanOrEqual(
        4.5
      );
      expect(calculateContrastRatio(TOKENS.streamSpecialCare, TOKENS.white)).toBeGreaterThanOrEqual(
        4.5
      );
      expect(calculateContrastRatio(TOKENS.hazardAccent, TOKENS.white)).toBeGreaterThanOrEqual(4.5);
    });

    it('light theme stream inks on stream tints exceed 4.5:1', () => {
      expect(
        calculateContrastRatio(TOKENS.wetInkLight, TOKENS.wetTintLight)
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        calculateContrastRatio(TOKENS.dryInkLight, TOKENS.dryTintLight)
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        calculateContrastRatio(TOKENS.sanitaryInkLight, TOKENS.sanitaryTintLight)
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        calculateContrastRatio(TOKENS.specialInkLight, TOKENS.specialTintLight)
      ).toBeGreaterThanOrEqual(4.5);
    });

    it('dark theme stream inks on stream tints exceed 4.5:1', () => {
      expect(calculateContrastRatio(TOKENS.wetInkDark, TOKENS.wetTintDark)).toBeGreaterThanOrEqual(
        4.5
      );
      expect(calculateContrastRatio(TOKENS.dryInkDark, TOKENS.dryTintDark)).toBeGreaterThanOrEqual(
        4.5
      );
      expect(
        calculateContrastRatio(TOKENS.sanitaryInkDark, TOKENS.sanitaryTintDark)
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        calculateContrastRatio(TOKENS.specialInkDark, TOKENS.specialTintDark)
      ).toBeGreaterThanOrEqual(4.5);
    });

    it('neutral body and muted ink text exceed 4.5:1 in light and dark themes', () => {
      // Light theme
      expect(calculateContrastRatio(TOKENS.inkLight, TOKENS.bgLight)).toBeGreaterThanOrEqual(4.5);
      expect(calculateContrastRatio(TOKENS.inkLight, TOKENS.surfaceLight)).toBeGreaterThanOrEqual(
        4.5
      );
      expect(calculateContrastRatio(TOKENS.inkMutedLight, TOKENS.bgLight)).toBeGreaterThanOrEqual(
        4.5
      );
      expect(
        calculateContrastRatio(TOKENS.inkMutedLight, TOKENS.surfaceLight)
      ).toBeGreaterThanOrEqual(4.5);

      // Dark theme
      expect(calculateContrastRatio(TOKENS.inkDark, TOKENS.bgDark)).toBeGreaterThanOrEqual(4.5);
      expect(calculateContrastRatio(TOKENS.inkDark, TOKENS.surfaceDark)).toBeGreaterThanOrEqual(
        4.5
      );
      expect(calculateContrastRatio(TOKENS.inkMutedDark, TOKENS.bgDark)).toBeGreaterThanOrEqual(
        4.5
      );
      expect(
        calculateContrastRatio(TOKENS.inkMutedDark, TOKENS.surfaceDark)
      ).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('UI Boundaries and Focus Rings (Minimum 3.0:1 for WCAG Level AA)', () => {
    it('light theme UI border token exceeds 3:1 against background and surface', () => {
      expect(calculateContrastRatio(TOKENS.borderUiLight, TOKENS.bgLight)).toBeGreaterThanOrEqual(
        3.0
      );
      expect(
        calculateContrastRatio(TOKENS.borderUiLight, TOKENS.surfaceLight)
      ).toBeGreaterThanOrEqual(3.0);
    });

    it('dark theme UI border token exceeds 3:1 against background and surface', () => {
      expect(calculateContrastRatio(TOKENS.borderUiDark, TOKENS.bgDark)).toBeGreaterThanOrEqual(
        3.0
      );
      expect(
        calculateContrastRatio(TOKENS.borderUiDark, TOKENS.surfaceDark)
      ).toBeGreaterThanOrEqual(3.0);
    });

    it('focus ring token exceeds 3:1 in both light and dark themes', () => {
      expect(calculateContrastRatio(TOKENS.focusLight, TOKENS.bgLight)).toBeGreaterThanOrEqual(3.0);
      expect(calculateContrastRatio(TOKENS.focusLight, TOKENS.surfaceLight)).toBeGreaterThanOrEqual(
        3.0
      );
      expect(calculateContrastRatio(TOKENS.focusDark, TOKENS.bgDark)).toBeGreaterThanOrEqual(3.0);
      expect(calculateContrastRatio(TOKENS.focusDark, TOKENS.surfaceDark)).toBeGreaterThanOrEqual(
        3.0
      );
    });
  });
});
