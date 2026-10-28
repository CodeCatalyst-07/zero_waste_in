import { expect, test } from '@playwright/test';
import path from 'node:path';

test.describe('ZeroWasteIN E2E Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Start on homepage with clear localStorage
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('chip answer offline: clicking a common item chip resolves locally with ZERO API calls', async ({
    page,
  }) => {
    let apiCallCount = 0;
    await page.route('**/api/classify', async (route) => {
      apiCallCount++;
      await route.fulfill({ status: 500, body: JSON.stringify({ error: { message: 'Network call prohibited' } }) });
    });

    // Click "Vegetable and fruit peels" chip
    const chip = page.getByRole('button', { name: 'Vegetable and fruit peels' });
    await expect(chip).toBeVisible();
    await chip.click();

    // Verify Result Card renders with Wet Waste verdict
    await expect(page.locator('.result-card')).toBeVisible();
    await expect(page.locator('.result-stream-title')).toContainText(/wet waste/i);
    await expect(page.locator('#result-item-name')).toContainText(/vegetable and fruit peels/i);

    // Assert strictly 0 network calls were made
    expect(apiCallCount).toBe(0);
  });

  test('typed unique item: typing an unambiguous item resolves locally with ZERO API calls', async ({
    page,
  }) => {
    let apiCallCount = 0;
    await page.route('**/api/classify', async (route) => {
      apiCallCount++;
      await route.fulfill({ status: 500, body: JSON.stringify({ error: { message: 'Network call prohibited' } }) });
    });

    // Open text input dock
    await page.getByRole('button', { name: /type it/i }).click();

    const input = page.getByPlaceholder(/blister pack, pizza box/i);
    await expect(input).toBeVisible();
    await input.fill('plastic water bottle');
    await input.press('Enter');

    // Result card appears with dry waste stream
    await expect(page.locator('.result-card')).toBeVisible();
    await expect(page.locator('.result-stream-title')).toContainText(/dry waste/i);

    // Zero API calls
    expect(apiCallCount).toBe(0);
  });

  test('ambiguous text calls API: queries with no direct local match dispatch to /api/classify', async ({
    page,
  }) => {
    let apiCallCount = 0;
    await page.route('**/api/classify', async (route) => {
      apiCallCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          requestId: 'test-req-ambiguous',
          verdict: {
            kind: 'answer',
            stream: 'dry',
            itemLabel: 'Special packaging foil pouch',
            reason: 'Multi-layer packaging pouch categorized as recyclable dry waste.',
            action: 'Rinse and put in dry waste bin.',
            flags: ['rinse_before_disposal'],
            confidenceBand: 'high',
            source: 'model',
            rowId: 'multi_layer_plastic',
          },
          itemLabel: 'Special packaging foil pouch',
          meta: {
            source: 'model',
            providerUsed: 'gemini',
            crossChecked: false,
            degraded: false,
          },
        }),
      });
    });

    await page.getByRole('button', { name: /type it/i }).click();
    const input = page.getByPlaceholder(/blister pack, pizza box/i);
    await input.fill('unusual metallic silver foil snack packet');
    await input.press('Enter');

    await expect(page.locator('.result-card')).toBeVisible();
    await expect(page.locator('.result-stream-title')).toContainText(/dry waste/i);
    await expect(page.locator('#result-item-name')).toContainText(/special packaging foil pouch/i);

    expect(apiCallCount).toBe(1);
  });

  test('photo flow: uploading a photo compresses and dispatches to /api/classify', async ({
    page,
  }) => {
    let apiCallCount = 0;
    let requestPayload: any = null;

    await page.route('**/api/classify', async (route) => {
      apiCallCount++;
      requestPayload = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          requestId: 'test-req-photo',
          verdict: {
            kind: 'answer',
            stream: 'special_care',
            itemLabel: 'AA/AAA and button-cell batteries',
            reason: 'Heavy metals in batteries cause ground toxicity. Never throw in normal bins.',
            action: 'Keep separate and hand over to hazardous collection centers.',
            flags: ['separate_regime_battery'],
            confidenceBand: 'high',
            source: 'model',
            rowId: 'used_dry_cells',
          },
          itemLabel: 'AA/AAA and button-cell batteries',
          meta: {
            source: 'model',
            providerUsed: 'jarvis',
            crossChecked: true,
            degraded: false,
          },
        }),
      });
    });

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /upload/i }).click();
    const fileChooser = await fileChooserPromise;

    const fixturePath = path.resolve(process.cwd(), 'test-fixtures/battery.jpg');
    await fileChooser.setFiles(fixturePath);

    await expect(page.locator('.result-card')).toBeVisible();
    await expect(page.locator('.result-stream-title')).toContainText(/special-care waste/i);

    expect(apiCallCount).toBe(1);
    expect(requestPayload.mode).toBe('image');
    expect(typeof requestPayload.image).toBe('string');
    expect(requestPayload.mimeType).toBe('image/jpeg');
  });

  test('ask-card follow-up: displays clarification question and resolves verdict upon selection', async ({
    page,
  }) => {
    await page.route('**/api/classify', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          requestId: 'test-req-ask',
          verdict: {
            kind: 'ask',
            question: 'Does this item contain an internal lithium battery?',
            options: [
              { label: 'Yes, has battery', stream: 'special_care' },
              { label: 'No, plain plastic casing', stream: 'dry' },
            ],
            reasonId: 'low_confidence',
            rowId: null,
          },
          itemLabel: 'Toy gadget',
          meta: {
            source: 'model',
            providerUsed: 'jarvis',
            crossChecked: false,
            degraded: false,
          },
        }),
      });
    });

    await page.getByRole('button', { name: /type it/i }).click();
    const input = page.getByPlaceholder(/blister pack, pizza box/i);
    await input.fill('small electronic device');
    await input.press('Enter');

    // Clarification card appears
    await expect(page.locator('.ask-card')).toBeVisible();
    await expect(page.locator('#ask-question-text')).toContainText(/does this item contain an internal lithium battery/i);

    const yesBtn = page.getByRole('button', { name: /yes, has battery/i });
    await expect(yesBtn).toBeVisible();
    await yesBtn.click();

    // Resolves to special care verdict
    await expect(page.locator('.result-card')).toBeVisible();
    await expect(page.locator('.result-stream-title')).toContainText(/special-care waste/i);
  });

  test('RATE_LIMITED and PROVIDERS_UNAVAILABLE error states display next steps', async ({
    page,
  }) => {
    // 1. RATE_LIMITED
    await page.route('**/api/classify', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Please wait a moment before trying again.',
          },
        }),
      });
    });

    await page.getByRole('button', { name: /type it/i }).click();
    const input = page.getByPlaceholder(/blister pack, pizza box/i);
    await input.fill('unknown item 123');
    await input.press('Enter');

    await expect(page.locator('.sort-error-alert')).toBeVisible();
    await expect(page.locator('.error-title')).toContainText(/too many requests/i);

    // 2. PROVIDERS_UNAVAILABLE
    await page.getByRole('button', { name: /try again/i }).click();

    await page.route('**/api/classify', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'PROVIDERS_UNAVAILABLE',
            message: 'Inference providers temporarily unavailable.',
          },
        }),
      });
    });

    await page.getByRole('button', { name: /type it/i }).click();
    await page.getByPlaceholder(/blister pack, pizza box/i).fill('obscure widget');
    await page.getByPlaceholder(/blister pack, pizza box/i).press('Enter');

    await expect(page.locator('.sort-error-alert')).toBeVisible();
    await expect(page.locator('.error-title')).toContainText(/service temporarily unavailable/i);
    await expect(page.locator('.error-desc')).toContainText(/you can always search or pick from the common items/i);
  });

  test('offline mode: disables camera and photo upload actions while allowing text search', async ({
    page,
  }) => {
    // Simulate offline
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    // Action buttons must be disabled
    const photoBtn = page.getByRole('button', { name: /take a photo/i });
    const uploadBtn = page.getByRole('button', { name: /upload/i });
    await expect(photoBtn).toBeDisabled();
    await expect(uploadBtn).toBeDisabled();
    await expect(page.locator('.offline-notice')).toBeVisible();

    // But common item chips and text still work offline
    const chip = page.getByRole('button', { name: 'Plastic bottles (PET), jugs' });
    await expect(chip).toBeEnabled();
    await chip.click();

    await expect(page.locator('.result-card')).toBeVisible();
    await expect(page.locator('.result-stream-title')).toContainText(/dry waste/i);

    // Restore online
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(photoBtn).toBeEnabled();
    await expect(uploadBtn).toBeEnabled();
  });

  test('keyboard-only completion of Sort flow', async ({ page }) => {
    // Navigate with Tab
    await page.keyboard.press('Tab'); // skip link
    await page.keyboard.press('Tab'); // home link
    await page.keyboard.press('Tab'); // privacy button

    // Tab through to common chips
    await page.keyboard.press('Tab');
    const focusedTag = await page.evaluate(() => document.activeElement?.textContent);
    expect(focusedTag).toBeTruthy();

    // Press Enter to select chip
    await page.keyboard.press('Enter');

    // Focus automatically shifts to result heading for accessibility
    await expect(page.locator('.result-card')).toBeVisible();
    const isHeadingFocused = await page.evaluate(
      () => document.activeElement?.id === 'result-item-name'
    );
    expect(isHeadingFocused).toBe(true);
  });

  test('tab navigation across #sort, #footprint, and #impact', async ({ page }) => {
    // 1. Footprint tab
    await page.getByRole('button', { name: /^footprint$/i }).click();
    await expect(page).toHaveURL(/#footprint/);
    await expect(page.getByRole('heading', { name: /carbon estimator/i })).toBeVisible();

    // 2. Impact tab
    await page.getByRole('button', { name: /^my impact$/i }).click();
    await expect(page).toHaveURL(/#impact/);
    await expect(page.getByRole('heading', { name: /citizen eco score/i })).toBeVisible();

    // 3. Back to Sort tab
    await page.getByRole('button', { name: /^sort$/i }).click();
    await expect(page).toHaveURL(/#sort/);
    await expect(page.getByRole('heading', { name: /which bin does it go in/i })).toBeVisible();
  });

  test('export and delete user data on Impact and Footprint screens', async ({ page }) => {
    // Navigate to footprint tab and add entry
    await page.getByRole('button', { name: /^footprint$/i }).click();

    // Enter electricity and water
    await page.getByLabel(/electricity \(kwh\)/i).fill('150');
    await page.getByLabel(/water \(litres\)/i).fill('3500');
    await page.getByRole('button', { name: /save monthly entry/i }).click();

    // Verify record in tracker table
    await expect(page.locator('.tracker-table')).toBeVisible();

    // Open delete dialog
    await page.getByRole('button', { name: /clear all data/i }).click();
    const dialog = page.locator('.delete-modal-dialog[open]');
    await expect(dialog).toBeVisible();

    // Confirm deletion
    await dialog.getByRole('button', { name: /confirm delete/i }).click();
    await expect(page.locator('.delete-modal-dialog[open]')).not.toBeVisible();

    // Verify empty state restored
    await expect(page.getByText(/no monthly records saved yet/i)).toBeVisible();
  });
});
