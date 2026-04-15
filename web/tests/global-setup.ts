/**
 * Playwright Global Setup — CalíopeBot E2E
 *
 * Runs once before all test workers. Logs in as the test user and saves
 * the browser storage state (cookies + localStorage) so individual tests
 * can reuse the authenticated session without re-logging in.
 */

import { chromium, FullConfig } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const E2E_EMAIL    = process.env.E2E_EMAIL    ?? "test_e2e@tailorbot.tech";
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "testpassword123";
const BASE_URL     = process.env.BASE_URL     ?? "http://localhost:3000";
export const STORAGE_STATE = path.join(__dirname, ".auth-state.json");

async function globalSetup(_config: FullConfig) {
  // Clean stale state
  if (fs.existsSync(STORAGE_STATE)) {
    fs.unlinkSync(STORAGE_STATE);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(BASE_URL, { timeout: 30000 });
    await page.waitForSelector('input[type="email"]', { timeout: 20000 });

    await page.fill('input[type="email"]', E2E_EMAIL);
    await page.fill('input[type="password"]', E2E_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for dashboard — confirms login succeeded
    await page.waitForURL(/\/dashboard/, { timeout: 25000 });

    // Give Firebase JS SDK time to write auth to localStorage
    await page.waitForTimeout(2000);

    // Save auth state (cookies + localStorage)
    await page.context().storageState({ path: STORAGE_STATE });
    console.log(`\n✅ E2E auth state saved to: ${STORAGE_STATE}`);

  } finally {
    await page.close();
    await browser.close();
  }
}

export default globalSetup;
