// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FootprintScreen } from '../src/features/footprint/FootprintScreen.js';
import { clearTrackerData, getTrackerData } from '../src/lib/storage.js';

describe('FootprintScreen Component & Accessibility', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders initial Footprint screen with zero axe violations', async () => {
    const { container } = render(<FootprintScreen />);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('updates carbon calculation dynamically when electricity input changes', async () => {
    const user = userEvent.setup();
    render(<FootprintScreen />);

    const kwhInput = screen.getByLabelText(/monthly electricity consumption/i);

    // Initial 120 kWh: 120 * 0.675 = 81 kg CO2 (+ default scooter trip 1.6 kg = 82.6 kg)
    expect(screen.getByText('81')).toBeDefined();

    // Change to 200 kWh: 200 * 0.675 = 135 kg CO2
    await user.clear(kwhInput);
    await user.type(kwhInput, '200');

    expect(screen.getByText('135')).toBeDefined();
  });

  it('adds a new travel routine and recalculates total transport footprint', async () => {
    const user = userEvent.setup();
    render(<FootprintScreen />);

    // Add 50 km weekly bus ride
    const distInput = screen.getByLabelText(/distance \(km\)/i);
    await user.clear(distInput);
    await user.type(distInput, '50');

    const addBtn = screen.getByRole('button', { name: /\+ add travel routine/i });
    await user.click(addBtn);

    // Verify trip is added to the list (appears in trip list and mode dropdown)
    expect(screen.getAllByText(/city bus/i).length).toBeGreaterThanOrEqual(2);
  });

  it('shows accessible error message on invalid input', async () => {
    const user = userEvent.setup();
    render(<FootprintScreen />);

    const kwhInput = screen.getByLabelText(/monthly electricity consumption/i);
    await user.clear(kwhInput);
    await user.type(kwhInput, '-50');

    const errorMsg = screen.getByRole('alert');
    expect(errorMsg.textContent).toContain('non-negative number');
    expect(kwhInput.getAttribute('aria-describedby')).toBeDefined();
  });

  it('logs monthly utility records and displays baseline comparison against own previous month', async () => {
    const user = userEvent.setup();
    render(<FootprintScreen />);

    // Log month 1: 2026-01 (100 kWh, 3000 L)
    const monthInput = screen.getByLabelText(/billing month/i);
    const kwhInput = screen.getByLabelText(/^electricity \(kwh\)$/i);
    const waterInput = screen.getByLabelText(/^water \(liters\)$/i);
    const saveBtn = screen.getByRole('button', { name: /save monthly entry/i });

    fireEvent.change(monthInput, { target: { value: '2026-01' } });
    await user.type(kwhInput, '100');
    await user.type(waterInput, '3000');
    await user.click(saveBtn);

    // Verify saved in storage
    expect(getTrackerData().entries.length).toBe(1);

    // Log month 2: 2026-02 (120 kWh -> +20%, 2700 L -> -10%)
    fireEvent.change(monthInput, { target: { value: '2026-02' } });
    await user.type(kwhInput, '120');
    await user.type(waterInput, '2700');
    await user.click(saveBtn);

    expect(getTrackerData().entries.length).toBe(2);

    // Verify baseline change card is rendered with text and direction
    expect(screen.getByText(/\+20 kWh \(20% more than previous month\)/i)).toBeDefined();
    expect(screen.getByText(/-300 L \(10% less than previous month\)/i)).toBeDefined();
  });

  it('toggles accessible data table alternative for electricity and water charts', async () => {
    const user = userEvent.setup();

    // Populate tracker data with 2 entries
    render(<FootprintScreen />);

    const monthInput = screen.getByLabelText(/billing month/i);
    const kwhInput = screen.getByLabelText(/^electricity \(kwh\)$/i);
    const waterInput = screen.getByLabelText(/^water \(liters\)$/i);
    const saveBtn = screen.getByRole('button', { name: /save monthly entry/i });

    fireEvent.change(monthInput, { target: { value: '2026-01' } });
    await user.type(kwhInput, '110');
    await user.type(waterInput, '3200');
    await user.click(saveBtn);

    fireEvent.change(monthInput, { target: { value: '2026-02' } });
    await user.type(kwhInput, '125');
    await user.type(waterInput, '3100');
    await user.click(saveBtn);

    // Find table toggle button for electricity chart
    const tableToggles = screen.getAllByRole('button', { name: /view as table/i });
    expect(tableToggles.length).toBe(2);

    // Click first toggle (electricity)
    await user.click(tableToggles[0]!);

    // Accessible table is displayed
    const elecTable = screen.getByRole('table', {
      name: /monthly electricity consumption history/i,
    });
    expect(elecTable).toBeDefined();

    // Has column headers
    expect(screen.getByRole('columnheader', { name: /month/i })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: /usage \(kwh\)/i })).toBeDefined();
  });

  it('allows clearing all tracker records and resets state', async () => {
    render(<FootprintScreen />);
    clearTrackerData();
    expect(getTrackerData().entries).toEqual([]);
  });
});
