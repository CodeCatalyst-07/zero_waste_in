// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { CivicChatBot } from '../src/components/CivicChatBot.js';

describe('CivicChatBot Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock scrollIntoView for jsdom
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders launcher button in closed state and passes axe accessibility audit', async () => {
    const { container } = render(<CivicChatBot />);
    const launcher = screen.getByRole('button', { name: /Open ZeroWasteIN Civic Chatbot Assistant/i });
    expect(launcher).toBeDefined();

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('opens chat window on launcher click and shows welcome message and suggested chips', async () => {
    render(<CivicChatBot />);
    const launcher = screen.getByRole('button', { name: /Open ZeroWasteIN Civic Chatbot Assistant/i });
    fireEvent.click(launcher);

    expect(screen.getByRole('dialog', { name: /ZeroWasteIN Assistant/i })).toBeDefined();
    expect(screen.getByText(/Namaste! I am your ZeroWasteIN Civic Eco-Assistant/i)).toBeDefined();
    expect(screen.getByText(/Where do batteries go\?/i)).toBeDefined();
  });

  it('closes chat window when clicking close button', async () => {
    render(<CivicChatBot />);
    const launcher = screen.getByRole('button', { name: /Open ZeroWasteIN Civic Chatbot Assistant/i });
    fireEvent.click(launcher);

    const closeBtn = screen.getByRole('button', { name: /Close chatbot window/i });
    fireEvent.click(closeBtn);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /Open ZeroWasteIN Civic Chatbot Assistant/i })).toBeDefined();
  });

  it('sends message via suggested chip and renders assistant reply', async () => {
    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        reply: 'Batteries belong in Stream 04 Special Care. Store safely and hand over to e-waste deposit.',
      }),
    } as any);

    render(<CivicChatBot />);
    fireEvent.click(screen.getByRole('button', { name: /Open ZeroWasteIN Civic Chatbot Assistant/i }));

    const chip = screen.getByRole('button', { name: /Where do batteries go\?/i });
    fireEvent.click(chip);

    await waitFor(() => {
      expect(screen.getByText(/Batteries belong in Stream 04 Special Care/i)).toBeDefined();
    });
  });

  it('verifies 0 axe violations on the open chat window', async () => {
    const { container } = render(<CivicChatBot />);
    fireEvent.click(screen.getByRole('button', { name: /Open ZeroWasteIN Civic Chatbot Assistant/i }));

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
