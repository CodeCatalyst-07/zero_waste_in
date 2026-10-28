// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { SortScreen } from '../src/features/sort/SortScreen.js';

describe('Accessibility verification with axe and focus checks', () => {
  afterEach(() => {
    cleanup();
  });

  it('verifies 0 axe violations on the empty Sort screen state', async () => {
    const { container } = render(<SortScreen />);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('verifies 0 axe violations on the loading state', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {}) // never resolves to keep loading state
    );

    const { container } = render(<SortScreen />);

    // Open text input and submit an ambiguous search to enter loading state
    const typeItBtn = screen.getByRole('button', { name: /^type it$/i });
    await user.click(typeItBtn);

    const input = screen.getByRole('textbox', { name: /^item name$/i });
    await user.type(input, 'unrecognized electronic thing{Enter}');

    expect(screen.getAllByText('Looking at your photo...').length).toBeGreaterThan(0);

    const results = await axe(container);
    expect(results.violations).toEqual([]);

    fetchSpy.mockRestore();
  });

  it('verifies 0 axe violations and heading focus across all four stream results', async () => {
    const user = userEvent.setup();
    const streamChips = [
      { chipName: /vegetable and fruit peels/i, streamName: /wet waste/i },
      { chipName: /plastic bottles/i, streamName: /dry waste/i },
      { chipName: /diapers/i, streamName: /sanitary waste/i },
      { chipName: /aa\/aaa and button-cell batteries/i, streamName: /special-care waste/i },
    ];

    for (const { chipName, streamName } of streamChips) {
      const { container, unmount } = render(<SortScreen />);
      const chip = screen.getByRole('button', { name: chipName });
      await user.click(chip);

      expect(screen.getByRole('heading', { level: 3, name: streamName })).toBeDefined();

      // Heading has focus (tabindex="-1")
      const heading = screen.getByRole('heading', { level: 2 });
      expect(document.activeElement).toBe(heading);

      const results = await axe(container);
      expect(results.violations).toEqual([]);

      unmount();
      cleanup();
    }
  });

  it('verifies 0 axe violations and heading focus on Ask card state', async () => {
    const user = userEvent.setup();
    const { container } = render(<SortScreen />);

    const typeItBtn = screen.getByRole('button', { name: /^type it$/i });
    await user.click(typeItBtn);

    const input = screen.getByRole('textbox', { name: /^item name$/i });
    await user.type(input, 'aerosol cans{Enter}');

    const questionHeading = screen.getByRole('heading', {
      level: 2,
      name: /is the can completely empty\?/i,
    });
    expect(questionHeading).toBeDefined();
    expect(document.activeElement).toBe(questionHeading);

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('verifies 0 axe violations on Error alert state', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { container } = render(<SortScreen />);

    const typeItBtn = screen.getByRole('button', { name: /^type it$/i });
    await user.click(typeItBtn);

    const input = screen.getByRole('textbox', { name: /^item name$/i });
    await user.type(input, 'strange unlisted query 404{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    const results = await axe(container);
    expect(results.violations).toEqual([]);

    fetchSpy.mockRestore();
  });

  it('verifies polite live region announces results correctly', async () => {
    const user = userEvent.setup();
    render(<SortScreen />);

    const wetChip = screen.getByRole('button', { name: /vegetable and fruit peels/i });
    await user.click(wetChip);

    // Live region announces: "Result: Wet waste. <reason>"
    const liveRegion = screen.getByText(/result: wet waste\./i);
    expect(liveRegion).toBeDefined();
  });
});
