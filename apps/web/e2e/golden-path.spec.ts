import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import ar from '../src/messages/ar.json' with { type: 'json' };
import en from '../src/messages/en.json' with { type: 'json' };

/**
 * The golden path (Phase 15): a customer publishes a passenger request, the vendor seeded by
 * `pnpm --filter @unigate/api e2e:seed` is invited and bids, the customer accepts and pays through
 * the mock gateway, the booking is CONFIRMED. Runs once per locale project; the Arabic run also
 * pins RTL screenshots of the four key screens. Labels come from the message catalogues, so the
 * test drives the UI the way a person reads it rather than through test ids.
 */
type Messages = typeof en;
const messages: Record<string, Messages> = { en, ar };
const PASSWORD = process.env['E2E_PASSWORD'];
const CUSTOMER = 'e2e.customer@unigate.local';
// A run-unique pickup address: the opportunity card shows the route, not the request number.
const PICKUP = `Terminal 5 stand ${Date.now().toString(36).toUpperCase()}`;
const VENDOR = 'e2e.vendor@unigate.local';

test.describe.configure({ mode: 'serial' });

function localeOf(projectName: string): 'en' | 'ar' {
  return projectName === 'ar' ? 'ar' : 'en';
}

async function signIn(page: Page, locale: string, identifier: string, m: Messages) {
  await page.goto(`/${locale}/login`);
  await page.locator('#identifier').fill(identifier);
  await page.locator('#password').fill(PASSWORD ?? '');
  await page.getByRole('button', { name: m.auth.signIn, exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Radix Select: click the trigger, then the option by its visible label. */
async function pickOption(page: Page, triggerId: string, optionText: string | RegExp) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole('option', { name: optionText }).first().click();
}

function localDateTime(hoursAhead: number): string {
  const d = new Date(Date.now() + hoursAhead * 3_600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Everything that legitimately differs between runs: identifiers, times (Latin or Arabic-Indic digits), the unique address, the unread badge. */
function dynamic(page: Page, ...extra: string[]) {
  return [
    page.getByText(/[\d٠-٩]{1,2}[:.][\d٠-٩]{2}/),
    page.getByText(/(TR|BK|BD|PY)-\d{4}-\d{6}/),
    page.getByText(PICKUP),
    // Structural regions whose content is run-specific: page titles carry the request number, table rows carry bid ids, totals and validity times.
    page.locator('main h1, main tbody, main time'),
    page.locator('a[href$="/notifications"] span, [aria-label*="notification" i] span'),
    ...extra.map((t) => page.getByText(t)),
  ];
}

test.beforeAll(() => {
  test.skip(!PASSWORD, 'E2E_PASSWORD is required (same value the e2e:seed ran with)');
});

test.describe('golden path', () => {
  let requestId = '';
  let requestNumber = '';
  let bookingPath = '';
  let customerCtx: BrowserContext;
  let vendorCtx: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    customerCtx = await browser.newContext();
    vendorCtx = await browser.newContext();
  });
  test.afterAll(async () => {
    await customerCtx.close();
    await vendorCtx.close();
  });

  test('customer publishes a passenger request', async () => {
    const locale = localeOf(test.info().project.name);
    const m = messages[locale] ?? en;
    const page = await customerCtx.newPage();
    await signIn(page, locale, CUSTOMER, m);

    await page.goto(`/${locale}/requests/new`);
    await expect(page.getByText(m.portal.requests.form.title, { exact: true }).first()).toBeVisible();
    // The seeded vendor serves Riyadh with a 20-seat minibus.
    await pickOption(page, 'vehicleCategoryId', locale === 'ar' ? /حافلة صغيرة|ميني/ : /minibus/i);
    await page.locator('#pickupAddress').fill(PICKUP);
    await pickOption(page, 'pickupCityId', locale === 'ar' ? /الرياض/ : /riyadh/i);
    // Run-unique slot, 6 h apart (3–88 days ahead, inside the 90-day lead-time ceiling): every earlier
    // run's booking holds the seeded minibus for a 4 h window and the matcher rightly skips a taken
    // calendar; global-setup also releases the seeded vehicle's stale reservations before each run.
    await page.locator('#pickupAt').fill(localDateTime(72 + 6 * (Math.floor(Date.now() / 1000) % 340)));
    await page.locator('#dropoffAddress').fill('Kingdom Centre, Olaya');
    await pickOption(page, 'dropoffCityId', locale === 'ar' ? /الرياض/ : /riyadh/i);
    await page.locator('#passengerCount').fill('12');
    await page.locator('#luggageCount').fill('12');
    if (locale === 'ar') await expect(page).toHaveScreenshot('new-request.png', { fullPage: true, mask: [page.locator('#pickupAt'), ...dynamic(page)] });

    await page.getByRole('button', { name: m.portal.requests.form.publishNow, exact: true }).click();
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}\?created=published/);
    requestId = new URL(page.url()).pathname.split('/').pop() ?? '';
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    const heading = page.getByText(/^TR-\d{4}-\d{6}$/).first();
    await expect(heading).toBeVisible();
    requestNumber = (await heading.textContent())?.trim() ?? '';
    expect(requestNumber).toMatch(/^TR-/);
    await page.close();
  });

  test('vendor sees the opportunity and bids', async () => {
    const locale = localeOf(test.info().project.name);
    const m = messages[locale] ?? en;
    const page = await vendorCtx.newPage();
    await signIn(page, locale, VENDOR, m);

    await page.goto(`/${locale}/opportunities`);
    const card = page.locator('article, li, div').filter({ hasText: PICKUP }).filter({ has: page.getByRole('button', { name: m.portal.opportunities.placeBid }) }).last();
    await expect(card).toBeVisible({ timeout: 30_000 });
    if (locale === 'ar') await expect(card).toHaveScreenshot('opportunity-card.png', { mask: dynamic(page) }); // the card, not the list: the list grows with every run
    await card.getByRole('button', { name: m.portal.opportunities.placeBid }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const vehicleOption = dialog.locator('#bid-vehicle option', { hasText: '9001 E2E' });
    await dialog.locator('#bid-vehicle').selectOption({ value: (await vehicleOption.getAttribute('value')) ?? '' });
    await dialog.locator('#bid-base').fill('1000');
    await dialog.getByRole('button', { name: m.portal.bids.form.submit, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/BD-\d{4}-\d{6}/).first()).toBeVisible();
    await page.close();
  });

  test('customer accepts the bid and pays through the mock gateway', async () => {
    const locale = localeOf(test.info().project.name);
    const m = messages[locale] ?? en;
    const page = await customerCtx.newPage();
    await page.goto(`/${locale}/requests/${requestId}`);
    await expect(page.getByText(requestNumber).first()).toBeVisible();

    const accept = page.getByRole('button', { name: m.portal.bids.compare.accept, exact: true }).first();
    await expect(accept).toBeVisible({ timeout: 30_000 });
    if (locale === 'ar') await expect(page).toHaveScreenshot('bids.png', { fullPage: true, mask: dynamic(page) });
    await accept.click();
    await expect(page.getByText(/BK-\d{4}-\d{6}/).first()).toBeVisible();
    const bookingLink = page.locator('a[href*="/bookings/"]').filter({ hasText: m.portal.bids.compare.booked }).first();
    await expect(bookingLink).toBeVisible();
    bookingPath = (await bookingLink.getAttribute('href')) ?? '';
    expect(bookingPath).toMatch(/\/bookings\/[0-9a-f-]{36}/);

    await page.goto(bookingPath);
    await expect(page.getByText(m.portal.bookings.status.PENDING_PAYMENT).first()).toBeVisible();
    await page.locator('#pay-method').selectOption('MADA');
    await page.getByRole('button', { name: new RegExp(m.portal.payments.pay.replace('{amount}', '.*').replace('{currency}', '.*')) }).click();

    // Hosted mock page → simulate success → back on the booking, now CONFIRMED.
    await expect(page).toHaveURL(/\/pay\/mock\//, { timeout: 30_000 });
    // The hosted page lives on APP_URL (a different origin in dev); wait for hydration before clicking.
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: m.portal.payments.mock.succeed, exact: true }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByText(m.portal.bookings.status.CONFIRMED).first()).toBeVisible({ timeout: 30_000 });
    if (locale === 'ar') await expect(page).toHaveScreenshot('booking-confirmed.png', { fullPage: true, mask: dynamic(page) });
    await page.close();
  });
});
