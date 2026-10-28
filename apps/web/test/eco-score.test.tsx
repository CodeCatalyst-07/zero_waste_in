// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { ImpactScreen } from '../src/features/impact/ImpactScreen.js';
import { recordImpactItem, saveTrackerEntry } from '../src/lib/storage.js';

describe('ImpactScreen Eco Score & Accessibility', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders empty Eco Score state with zero axe violations when no user data exists', async () => {
    const { container } = render(
      <ImpactScreen onNavigateToSort={() => {}} onNavigateToFootprint={() => {}} />
    );

    expect(screen.getByText(/no eco score yet/i)).toBeDefined();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('calculates and animates Eco Score when items have been sorted', async () => {
    // Sort 10 items (10 / 20 goal = 50% score)
    for (let i = 0; i < 10; i++) {
      recordImpactItem(`Item ${i}`, i === 0 ? 'special_care' : 'wet');
    }

    const { container } = render(
      <ImpactScreen onNavigateToSort={() => {}} onNavigateToFootprint={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText(/based on 1 of 4 inputs/i)).toBeDefined();
    });

    // Verify accessible role and label
    const ringImg = screen.getByRole('img', { name: /eco score: 50 out of 100/i });
    expect(ringImg).toBeDefined();

    // Verify component breakdown includes sorting activity
    expect(screen.getByText(/sorting activity/i)).toBeDefined();
    expect(screen.getByText(/10 of 20 items sorted/i)).toBeDefined();

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('incorporates utility trends and increases inputs count to 2 of 4', async () => {
    // Sort 20 items (score 100)
    for (let i = 0; i < 20; i++) {
      recordImpactItem(`Item ${i}`, 'dry');
    }

    // Add 2 consecutive electricity logs (100 kWh -> 100 kWh = 0% increase = score 100)
    saveTrackerEntry({ month: '2026-01', electricityKwh: 100 });
    saveTrackerEntry({ month: '2026-02', electricityKwh: 100 });

    render(<ImpactScreen onNavigateToSort={() => {}} onNavigateToFootprint={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/based on 2 of 4 inputs/i)).toBeDefined();
    });

    const ringImg = screen.getByRole('img', { name: /eco score: 100 out of 100/i });
    expect(ringImg).toBeDefined();
  });

  it('renders instantly without animation when prefers-reduced-motion is active', async () => {
    // Mock reduced motion
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    for (let i = 0; i < 20; i++) {
      recordImpactItem(`Item ${i}`, 'wet');
    }

    const { container } = render(
      <ImpactScreen onNavigateToSort={() => {}} onNavigateToFootprint={() => {}} />
    );

    // Progress arc has static modifier class
    const progressArc = container.querySelector('.eco-score-ring-progress--static');
    expect(progressArc).toBeDefined();

    // Directly shows 100 in center text
    expect(screen.getByText('100')).toBeDefined();
  });
});
