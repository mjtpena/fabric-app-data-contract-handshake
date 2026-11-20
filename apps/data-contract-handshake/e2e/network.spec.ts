import { expect, test, type Page } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

/** The Today items live in the side panel (desktop) or a bottom sheet behind a "Today" button (phones). */
async function openToday(page: Page) {
  if (isPhone(page)) await page.getByRole('button', { name: /^Today/ }).click();
}

test('the network map draws every line, station and train', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/');
  await expect(page.getByRole('heading', { name: 'The network' })).toBeVisible();
  const map = page.getByTestId('metro-map');
  await expect(map).toBeVisible();
  // 5 contracts → 5 terminals; 6 consumer teams → 6 stations; 6 published notices → 6 trains.
  await expect(page.getByTestId('map-terminal')).toHaveCount(5);
  await expect(page.getByTestId('map-station')).toHaveCount(6);
  await expect(page.getByTestId('map-train')).toHaveCount(6);
  await expect(page.locator('[data-testid="map-station"][data-station="Marketing Insights"]')).toHaveAttribute('aria-label', /interchange/);
  await expect(page.getByTestId('next-departure')).toBeVisible();
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('lenses re-paint the map, by click and by number key', async ({ page }) => {
  await openApp(page, '/');
  const map = page.getByTestId('metro-map');
  await expect(map).toHaveAttribute('data-lens', 'signal');
  await page.getByRole('radiogroup', { name: 'Lens' }).getByRole('radio', { name: /Type/ }).click();
  await expect(map).toHaveAttribute('data-lens', 'type');
  await page.keyboard.press('3');
  await expect(map).toHaveAttribute('data-lens', 'departure');
  await expect(page.getByRole('radiogroup', { name: 'Lens' }).getByRole('radio', { name: /Departs/ })).toHaveAttribute('aria-checked', 'true');
});

test('a Today item flies the map to the service behind it', async ({ page }) => {
  await openApp(page, '/');
  await openToday(page);
  await page.getByRole('button', { name: /Final call: Rename order_total/ }).click();
  const card = page.getByTestId('focus-card').filter({ visible: true });
  await expect(card).toContainText('Rename order_total to gross_amount');
  await expect(card).toContainText('Finance Analytics');
  await expect(page.getByRole('heading', { name: 'Rename order_total to gross_amount' })).toBeVisible();
  // The Today item set the lens it belongs to, and the train is selected on the map.
  await expect(page.getByTestId('metro-map')).toHaveAttribute('data-lens', 'departure');
  await expect(page.locator('[data-testid="map-train"][aria-pressed="true"]')).toHaveCount(1);
  await card.getByRole('link', { name: 'Open service' }).click();
  await expect(page.getByTestId('ack-matrix')).toBeVisible();
});

test('view as a consumer team lights only its lines', async ({ page }) => {
  await openApp(page, '/', 'demo-two-teams');
  await page.getByRole('radiogroup', { name: 'View as' }).getByRole('radio', { name: 'Team' }).click();
  // Jordan's first team is the default subject.
  await expect(page.getByLabel('Team')).toHaveValue('Finance Analytics');
  await openToday(page);
  await expect(page.getByRole('button', { name: /Rename order_total to gross_amount/ }).first()).toBeVisible();
});

test('the list view shows the same services and lines', async ({ page }) => {
  await openApp(page, '/');
  await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'List' }).click();
  const list = page.getByTestId('network-list');
  await expect(list).toBeVisible();
  const services = list.getByRole('region', { name: 'Services' }).locator('tbody tr');
  await expect(services).toHaveCount(6);
  await expect(list).toContainText('Rename order_total to gross_amount');
  await expect(list.getByRole('region', { name: 'Lines' }).locator('tbody tr')).toHaveCount(5);
  await assertNoHorizontalScroll(page);
});

test('without WebGL and with reduced motion the SVG map still renders, without moving parts', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?nowebgl#/');
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await expect(page.getByTestId('metro-map')).toBeVisible();
  await expect(page.getByTestId('map-station')).toHaveCount(6);
  await expect(page.locator('[data-testid="metro-map"] animateMotion')).toHaveCount(0);
});
