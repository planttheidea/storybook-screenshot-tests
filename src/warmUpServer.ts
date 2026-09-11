import type { BrowserType, Page } from '@playwright/test';

/**
 * Launches a short-lived browser, runs `setup` against a new page, then closes —
 * absorbing the Storybook cold start before test workers begin, so the first
 * test does not pay for it and time out.
 *
 * The browser type is passed in so this uses the same installation the runner
 * does, rather than whichever copy of Playwright this package resolves to.
 */
export async function warmUpServer(
  browserType: BrowserType,
  label: string,
  setup: (page: Page) => Promise<void>,
): Promise<void> {
  const browser = await browserType.launch();

  try {
    const page = await browser.newPage();

    await setup(page);
  } finally {
    await browser.close();
  }

  console.log(`${label} warm and ready for tests.`);
}
