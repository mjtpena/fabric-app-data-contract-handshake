import { expect, test, type Page } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

/** From Line status: open a line (contract), then one of its services (notices). */
async function openNotice(page: Page, contract: string, notice: string) {
  await page.getByRole('link', { name: contract }).click();
  await expect(page.getByRole('heading', { name: contract })).toBeVisible();
  await page.getByRole('link', { name: notice }).click();
  await expect(page.getByRole('heading', { name: notice })).toBeVisible();
}

test('acceptance 3: an objection requires a note and turns the notice blocked', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/inbox', 'demo-marketing');
  await expect(page.getByRole('heading', { name: 'Signal box' })).toBeVisible();
  const item = page.getByTestId('inbox-item').filter({ hasText: 'Add sales_channel column' });
  await expect(item).toHaveCount(1);
  await expect(item.getByTestId('health-chip')).toHaveAttribute('data-health', 'waiting');

  await item.getByRole('button', { name: 'Object for Marketing Insights' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Record objection' }).click();
  await expect(dialog.getByText('Objection note is required.')).toBeVisible();
  await dialog.getByLabel('Objection note').fill('Our dashboards already use a channel column; please pick another name.');
  await dialog.getByRole('button', { name: 'Record objection' }).click();
  await expect(dialog).toBeHidden();

  // Answered acks leave the inbox.
  await expect(page.getByTestId('inbox-item')).toHaveCount(0);
  await expect(page.getByText('Nothing waiting on your teams')).toBeVisible();

  await page.goto('/#/lines');
  await openNotice(page, 'Orders fact table', 'Add sales_channel column');
  await expect(page.getByTestId('health-chip').first()).toHaveAttribute('data-health', 'blocked');
  const row = page.locator('[data-testid="ack-row"][data-team="Marketing Insights"]');
  await expect(row).toContainText('Objected');
  await expect(row).toContainText('please pick another name');
  await expect(row).toContainText('Chen Wu');
  consoleWatch.assertClean();
});

test("acceptance 4: the inbox shows only the viewer's teams' pending acks", async ({ page }) => {
  await openApp(page, '/inbox', 'demo-finance');
  await expect(page.getByTestId('my-teams')).toContainText('Finance Analytics');
  const items = page.getByTestId('inbox-item');
  await expect(items).toHaveCount(2);
  for (const team of await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-team')))) {
    expect(team).toBe('Finance Analytics');
  }
  await assertNoHorizontalScroll(page);
});

test('a person in two teams sees both teams in one inbox', async ({ page }) => {
  await openApp(page, '/inbox', 'demo-two-teams');
  await expect(page.getByTestId('my-teams')).toContainText('Finance Analytics');
  await expect(page.getByTestId('my-teams')).toContainText('Sales Ops');
  const items = page.getByTestId('inbox-item');
  await expect(items).toHaveCount(4);
  const teams = new Set(await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-team'))));
  expect([...teams].sort()).toEqual(['Finance Analytics', 'Sales Ops']);

  // Acknowledge one; it leaves the inbox.
  await items.first().getByRole('button', { name: /^Acknowledge for/ }).click();
  await expect(items).toHaveCount(3);
});

test('acceptance 2 (UI): publishing creates one pending ack per consumer; a past-dated draft cannot be published', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/lines', 'demo-producer');
  await openNotice(page, 'Inventory snapshot', 'Change snapshot grain from daily to hourly');
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByTestId('ack-row')).toHaveCount(3);
  await expect(page.getByTestId('ack-matrix')).not.toContainText('Acknowledged');
  await expect(page.getByTestId('health-chip').first()).toHaveAttribute('data-health', 'waiting');

  await page.goto('/#/lines');
  await openNotice(page, 'Web sessions', 'Drop referrer_raw column');
  await expect(page.getByTestId('publish-blocker')).toContainText('in the past');
  await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled();
  consoleWatch.assertClean();
});

test('a producer drafts a notice, then publishes it', async ({ page }) => {
  await openApp(page, '/lines', 'demo-producer');
  await page.getByRole('link', { name: 'Customer dimension' }).click();
  await page.getByRole('button', { name: 'Announce a change' }).click();
  await page.getByLabel('Title').fill('Widen postcode');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Choose a change type.')).toBeVisible();
  await expect(page.getByText('Description is required.')).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Change type' }).getByText('Additive', { exact: true }).click();
  await expect(page.getByRole('radio', { name: /^Additive/ })).toBeChecked();
  await page.getByLabel('Description').fill('postcode grows from 8 to 12 characters to fit international formats.');
  const inTwoWeeks = new Date(Date.now() + 14 * 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await page
    .getByLabel('Effective date')
    .fill(`${inTwoWeeks.getFullYear()}-${pad(inTwoWeeks.getMonth() + 1)}-${pad(inTwoWeeks.getDate())}`);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { name: 'Widen postcode' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByTestId('ack-row')).toHaveCount(3);
});

test('removing a consumer marks their open acks migrated with "consumer removed"', async ({ page }) => {
  await openApp(page, '/lines', 'demo-producer');
  await page.getByRole('link', { name: 'Orders fact table' }).click();
  await page.getByRole('button', { name: 'Remove Finance Analytics' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove consumer' }).click();
  await expect(page.getByTestId('consumer-row')).toHaveCount(3);
  await page.getByRole('link', { name: 'Rename order_total to gross_amount' }).click();
  const row = page.locator('[data-testid="ack-row"][data-team="Finance Analytics"]');
  await expect(row).toContainText('Migrated');
  await expect(row).toContainText('consumer removed');
  await expect(row).toContainText('Consumer removed');
});

test('a team member can act only for their own team', async ({ page }) => {
  await openApp(page, '/lines', 'demo-finance');
  await openNotice(page, 'Orders fact table', 'Rename order_total to gross_amount');
  const sales = page.locator('[data-testid="ack-row"][data-team="Sales Ops"]');
  await expect(sales).toContainText('Team members only');
  const finance = page.locator('[data-testid="ack-row"][data-team="Finance Analytics"]');
  await expect(finance.getByRole('button', { name: 'Acknowledge for Finance Analytics' })).toBeVisible();
  await assertNoHorizontalScroll(page);
});

test('line status, the departures board and the no-consumer warning show every health state', async ({ page }) => {
  await openApp(page, '/lines');
  const chips = page.getByTestId('registry-row').getByTestId('health-chip');
  await expect(chips).toHaveCount(4);
  expect(await chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-health')))).toEqual(['blocked', 'at_risk', 'ok', 'ok']);

  await page.goto('/#/departures');
  await expect(page.getByRole('heading', { name: 'Departures', exact: true })).toBeVisible();
  const rows = page.getByTestId('departure-row');
  // One row per published notice, soonest departure first.
  await expect(rows).toHaveCount(6);
  const healths = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-health')));
  for (const h of ['blocked', 'overdue', 'at_risk', 'waiting', 'ok']) expect(healths).toContain(h);
  await expect(rows.filter({ hasText: 'Retire legacy_segment column' })).toHaveAttribute('data-health', 'overdue');
  // Filter by station: Customer Care Reporting answers two services.
  await page.getByLabel('Station').selectOption({ label: 'Customer Care Reporting' });
  await expect(rows).toHaveCount(2);
  // Wall screen opens full screen and Escape closes it.
  await page.getByRole('button', { name: 'Wall screen' }).click();
  await expect(page.getByRole('dialog', { name: 'Departures wall screen' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Departures wall screen' })).toBeHidden();

  await page.goto('/#/lines');
  await openNotice(page, 'Currency rates', 'Add rate_source column');
  await expect(page.getByTestId('health-chip').first()).toHaveAttribute('data-health', 'ok');
  await expect(page.getByTestId('no-consumers-warning')).toBeVisible();
});

test('naming yourself contact of a team on your own contract does not grant that team elsewhere', async ({ page }) => {
  await openApp(page, '/lines', 'demo-marketing');
  await page.getByRole('button', { name: 'Register contract' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Side project');
  await dialog.getByLabel('Source').fill('lakehouse.side.project');
  await dialog.getByLabel('Producer team').fill('Marketing');
  await dialog.getByRole('button', { name: 'Register contract' }).click();
  await expect(page.getByRole('heading', { name: 'Side project' })).toBeVisible();

  await page.getByRole('button', { name: 'Add consumer' }).click();
  const add = page.getByRole('dialog');
  await add.getByLabel('Team name').fill('Finance Analytics');
  await add.getByLabel('Contact person').selectOption({ label: 'Chen Wu (chen@example.com)' });
  await add.getByRole('button', { name: 'Add consumer' }).click();
  await expect(page.getByTestId('consumer-row')).toHaveCount(1);

  await page.goto('/#/inbox');
  await expect(page.getByTestId('my-teams')).toHaveText(/Marketing Insights/);
  await expect(page.getByTestId('my-teams')).not.toContainText('Finance Analytics');
  await expect(page.locator('[data-testid="inbox-item"][data-team="Finance Analytics"]')).toHaveCount(0);

  await page.goto('/#/lines');
  await openNotice(page, 'Orders fact table', 'Rename order_total to gross_amount');
  await expect(page.locator('[data-testid="ack-row"][data-team="Finance Analytics"]')).toContainText('Team members only');
});
