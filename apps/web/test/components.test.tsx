// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SortScreen } from '../src/features/sort/SortScreen.js';

describe('Component tests for Sort flows and cards', () => {
  afterEach(() => {
    cleanup();
  });

  it('chips answer offline immediately when tapped', async () => {
    const user = userEvent.setup();
    render(<SortScreen />);

    // Tap "Vegetable and fruit peels"
    const wetChip = screen.getByRole('button', { name: /vegetable and fruit peels/i });
    await user.click(wetChip);

    // Answer rendered instantly
    expect(screen.getByRole('heading', { level: 3, name: /wet waste/i })).toBeDefined();
    expect(screen.getByText('Matched our rules list')).toBeDefined();
  });

  it('renders result card with stream name, icon, shape badge and text for all four streams', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SortScreen />);

    // 1. Wet Stream (Vegetable peels)
    const wetChip = screen.getByRole('button', { name: /vegetable and fruit peels/i });
    await user.click(wetChip);
    expect(screen.getByRole('heading', { level: 3, name: /wet waste/i })).toBeDefined();
    expect(screen.getAllByLabelText(/circle badge/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/what to do/i)).toBeDefined();

    unmount();

    // 2. Dry Stream (Plastic bottles)
    render(<SortScreen />);
    const dryChip = screen.getByRole('button', { name: /plastic bottles/i });
    await user.click(dryChip);
    expect(screen.getByRole('heading', { level: 3, name: /dry waste/i })).toBeDefined();
    expect(screen.getAllByLabelText(/square badge/i).length).toBeGreaterThan(0);

    cleanup();

    // 3. Sanitary Stream (Diaper)
    render(<SortScreen />);
    const sanitaryChip = screen.getByRole('button', { name: /diapers/i });
    await user.click(sanitaryChip);
    expect(screen.getByRole('heading', { level: 3, name: /sanitary waste/i })).toBeDefined();
    expect(screen.getAllByLabelText(/rounded-hexagon badge/i).length).toBeGreaterThan(0);

    cleanup();

    // 4. Special Care Stream (AA batteries)
    render(<SortScreen />);
    const specialCareChip = screen.getByRole('button', {
      name: /aa\/aaa and button-cell batteries/i,
    });
    await user.click(specialCareChip);
    expect(screen.getByRole('heading', { level: 3, name: /special-care waste/i })).toBeDefined();
    expect(screen.getAllByLabelText(/triangle badge/i).length).toBeGreaterThan(0);
  });

  it('ask card renders question and options, resolving to final result via resolveFollowUp', async () => {
    const user = userEvent.setup();
    render(<SortScreen />);

    // Open text search and search for aerosol cans (a row with followUp)
    const typeItBtn = screen.getByRole('button', { name: /^type it$/i });
    await user.click(typeItBtn);

    const input = screen.getByRole('textbox', { name: /^item name$/i });
    await user.type(input, 'aerosol cans{Enter}');

    // Clarification question displayed
    expect(
      screen.getByRole('heading', { level: 2, name: /is the can completely empty\?/i })
    ).toBeDefined();

    // Choose option: "Yes, empty"
    const optionYes = screen.getByRole('button', { name: /yes, empty/i });
    await user.click(optionYes);

    // Resolves to Dry Waste result card
    expect(screen.getByRole('heading', { level: 3, name: /dry waste/i })).toBeDefined();
  });

  it('unclear card displays municipal guidance and restart action', async () => {
    const user = userEvent.setup();
    render(<SortScreen />);

    // Open text search and search for "used cooking oil" (canonical row with stream: null and no followUp)
    const typeItBtn = screen.getByRole('button', { name: /^type it$/i });
    await user.click(typeItBtn);

    const input = screen.getByRole('textbox', { name: /^item name$/i });
    await user.type(input, 'used cooking oil{Enter}');

    // Unclear card rendered
    expect(screen.getByRole('heading', { level: 2, name: /used cooking oil/i })).toBeDefined();
    expect(screen.getByText(/seal it in a bottle and ask your local body/i)).toBeDefined();
    expect(screen.getAllByText(/check with your local municipal body/i).length).toBeGreaterThan(0);

    const restartBtn = screen.getByRole('button', { name: /sort another/i });
    expect(restartBtn).toBeDefined();
    await user.click(restartBtn);

    // Returns to idle empty state
    expect(
      screen.getByRole('heading', { level: 1, name: /which bin does it go in\?/i })
    ).toBeDefined();
  });

  it('error state displays with role="alert" and actionable recovery steps', async () => {
    const user = userEvent.setup();
    render(<SortScreen />);

    // Simulate clicking type it and submitting invalid network error
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('Network error'));

    const typeItBtn = screen.getByRole('button', { name: /^type it$/i });
    await user.click(typeItBtn);

    const input = screen.getByRole('textbox', { name: /^item name$/i });
    await user.type(input, 'completely random unmatchable string 999{Enter}');

    const alert = await screen.findByRole('alert');
    expect(alert).toBeDefined();
    expect(screen.getByRole('button', { name: /type the item instead/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /try again/i })).toBeDefined();

    fetchSpy.mockRestore();
  });
});
