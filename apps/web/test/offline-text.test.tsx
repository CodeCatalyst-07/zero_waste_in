// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SortScreen } from '../src/features/sort/SortScreen.js';

describe('Offline-first text mode & fallback candidates', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('unique text match ("plastic bottle") makes ZERO fetch calls and resolves locally in 0ms', async () => {
    const user = userEvent.setup();
    render(<SortScreen />);

    // Click "Type it" button to open text field
    const typeItBtn = screen.getByRole('button', { name: /^type it$/i });
    await user.click(typeItBtn);

    const input = screen.getByRole('textbox', { name: /^item name$/i });
    await user.type(input, 'plastic bottle{Enter}');

    // Result card appears immediately with dry waste
    await waitFor(() => {
      const heading = screen.getByRole('heading', { level: 3, name: /dry waste/i });
      expect(heading).toBeDefined();
    });

    // Zero fetch calls made
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Matched our rules list')).toBeDefined();
  });

  it('ambiguous text query invokes POST /api/classify', async () => {
    const user = userEvent.setup();

    // Mock successful API response
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        requestId: 'test-req-123',
        itemLabel: 'Unusual gadget',
        verdict: {
          kind: 'answer',
          stream: 'special_care',
          itemLabel: 'Unusual gadget',
          reason: 'Contains battery components requiring special-care disposal.',
          action: 'Keep separate and hand to collection center.',
          flags: ['rules_vary_by_city'],
          confidenceBand: 'high',
          source: 'attributes',
          rowId: null,
        },
        meta: {
          source: 'model',
          providerUsed: 'jarvis',
          crossChecked: false,
          degraded: false,
        },
      }),
    } as Response);

    render(<SortScreen />);

    const typeItBtn = screen.getByRole('button', { name: /^type it$/i });
    await user.click(typeItBtn);

    const input = screen.getByRole('textbox', { name: /^item name$/i });
    await user.type(input, 'strange electronic device{Enter}');

    // Expect fetch to have been called with /api/classify
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/classify',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    // Model result rendered
    await waitFor(() => {
      const heading = screen.getByRole('heading', { level: 3, name: /special-care waste/i });
      expect(heading).toBeDefined();
    });
  });

  it('API network failure on text input falls back to local candidates instead of blocking error wall', async () => {
    const user = userEvent.setup();

    // Mock network failure
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    render(<SortScreen />);

    const typeItBtn = screen.getByRole('button', { name: /^type it$/i });
    await user.click(typeItBtn);

    // Search query with partial match to canonical rules (e.g. "tissue napkin strange")
    const input = screen.getByRole('textbox', { name: /^item name$/i });
    await user.type(input, 'tissue napkin strange{Enter}');

    // Alert error card is rendered
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeDefined();
    });

    // Candidates are displayed under "Did you mean:"
    const candidatesSection = screen.getByText(/did you mean:/i);
    expect(candidatesSection).toBeDefined();

    // Clicking a candidate resolves it offline
    const candidateBtn = screen.getByRole('button', { name: /used tissue and paper napkins/i });
    expect(candidateBtn).toBeDefined();

    await user.click(candidateBtn);

    // FollowUp question for tissue appears
    await waitFor(() => {
      const questionHeading = screen.getByRole('heading', {
        name: /was it used for blood or bodily fluids\?/i,
      });
      expect(questionHeading).toBeDefined();
    });
  });
});
