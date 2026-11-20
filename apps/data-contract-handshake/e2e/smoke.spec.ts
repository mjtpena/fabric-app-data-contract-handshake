import { expect, test } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

test('loads, creates a record, sees it listed, no console errors', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/lines');
  await expect(page.getByRole('heading', { name: 'Line status' })).toBeVisible();
  await expect(page.getByTestId('registry-row')).toHaveCount(5);
  await assertNoHorizontalScroll(page);

  await page.getByRole('button', { name: 'Register contract' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Smoke test returns');
  await dialog.getByLabel('Source').fill('lakehouse.sales.returns');
  await dialog.getByLabel('Producer team').fill('Sales Data Platform');
  await dialog.getByRole('button', { name: 'Register contract' }).click();

  await expect(page.getByRole('heading', { name: 'Smoke test returns' })).toBeVisible();
  await expect(page.getByTestId('no-consumers-warning')).toBeVisible();
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Line status' }).click();
  await expect(page.getByRole('link', { name: 'Smoke test returns' })).toBeVisible();
  await expect(page.getByTestId('registry-row')).toHaveCount(6);
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('every page renders without horizontal scroll or console errors', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/inbox', 'demo-two-teams');
  for (const [path, heading] of [
    ['/inbox', 'Signal box'],
    ['/departures', 'Departures'],
    ['/timetable', 'Timetable'],
    ['/teams', 'Stations'],
    ['/about', 'About Data Contract Handshake'],
    ['/lines', 'Line status'],
    ['/', 'The network'],
  ] as const) {
    await page.goto(`/#${path}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await assertNoHorizontalScroll(page);
  }
  consoleWatch.assertClean();
});
