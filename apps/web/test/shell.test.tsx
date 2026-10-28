// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/main.js';

describe('apps/web/index.html & Shell Landmark Tests', () => {
  const htmlPath = path.resolve(__dirname, '../index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  it('contains lang="en-IN" attribute', () => {
    expect(htmlContent).toMatch(/<html[^>]*lang=["']en-IN["']/);
  });

  it('includes viewport meta tag for mobile devices', () => {
    expect(htmlContent).toMatch(
      /<meta[^>]*name=["']viewport["'][^>]*content=["'][^"']*width=device-width/
    );
  });

  it('imports tokens.css', () => {
    expect(htmlContent).toMatch(/href=["']\/src\/styles\/tokens\.css["']/);
  });

  it('contains single placeholder heading', () => {
    expect(htmlContent).toMatch(/<h1>ZeroWasteIN<\/h1>/);
  });
});

describe('apps/web/src/main.tsx App Shell Component', () => {
  beforeEach(() => {
    window.location.hash = '';
    localStorage.clear();
  });

  it('renders application header, tagline, and bottom navigation bar', () => {
    render(<App />);

    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('link', { name: /zerowastein home/i })).toBeDefined();
    expect(screen.getByText(/zeroWasteIN/i)).toBeDefined();
    expect(screen.getByText(/point at an item/i)).toBeDefined();
    expect(screen.getByRole('navigation', { name: /primary navigation/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^sort$/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^footprint$/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^my impact$/i })).toBeDefined();
  });

  it('navigates across tabs via navigation buttons and window hash events', async () => {
    render(<App />);

    const sortBtn = screen.getByRole('button', { name: /^sort$/i });
    expect(sortBtn.getAttribute('aria-current')).toBe('page');

    // Click Footprint tab
    const footprintBtn = screen.getByRole('button', { name: /^footprint$/i });
    await act(async () => {
      fireEvent.click(footprintBtn);
    });

    expect(window.location.hash).toBe('#footprint');

    // Click Impact tab
    const impactBtn = screen.getByRole('button', { name: /^my impact$/i });
    await act(async () => {
      fireEvent.click(impactBtn);
    });

    expect(window.location.hash).toBe('#impact');

    // External hashchange event
    await act(async () => {
      window.location.hash = '#sort';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('button', { name: /^sort$/i }).getAttribute('aria-current')).toBe('page');
  });

  it('opens and closes the on-device privacy guarantee dialog', async () => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };

    render(<App />);

    const privacyBtn = screen.getByRole('button', { name: /privacy/i });
    await act(async () => {
      fireEvent.click(privacyBtn);
    });

    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(screen.getByRole('heading', { name: /privacy & data handling/i })).toBeDefined();

    const closeBtn = screen.getByRole('button', { name: /close/i });
    await act(async () => {
      fireEvent.click(closeBtn);
    });

    expect(dialog.hasAttribute('open')).toBe(false);
  });
});
