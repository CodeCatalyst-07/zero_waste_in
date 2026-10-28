import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Automated Accessibility Audits (axe-core)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`ColorScheme: ${scheme}`, () => {
      test.use({ colorScheme: scheme });

      test(`Sort idle view passes axe with zero violations (${scheme})`, async ({ page }) => {
        await page.goto('/#sort');
        await page.waitForLoadState('networkidle');

        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations).toEqual([]);
      });

      test(`Sort result view passes axe with zero violations (${scheme})`, async ({ page }) => {
        await page.goto('/#sort');
        await page.getByRole('button', { name: 'Plastic bottles (PET), jugs' }).click();
        await expect(page.locator('.result-card')).toBeVisible();

        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations).toEqual([]);
      });

      test(`Footprint screen passes axe with zero violations (${scheme})`, async ({ page }) => {
        await page.goto('/#footprint');
        await expect(page.getByRole('heading', { name: /carbon estimator/i })).toBeVisible();

        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations).toEqual([]);
      });

      test(`Impact screen passes axe with zero violations (${scheme})`, async ({ page }) => {
        await page.goto('/#impact');
        await expect(page.getByRole('heading', { name: /citizen eco score/i })).toBeVisible();

        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations).toEqual([]);
      });
    });
  }
});
