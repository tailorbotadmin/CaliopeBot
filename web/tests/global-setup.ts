/**
 * Playwright Global Setup — CalíopeBot E2E
 *
 * Runs once before all test workers. Logs in as the test user and saves
 * the browser storage state (cookies + localStorage) so individual tests
 * can reuse the authenticated session without re-logging in.
 *
 * CI behavior: if E2E credentials are not set, creates an empty auth state
 * and exits cleanly — tests will fail fast on auth instead of hanging.
 */

import { chromium, FullConfig } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const E2E_EMAIL    = process.env.E2E_EMAIL    ?? "";
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "";
const BASE_URL     = process.env.BASE_URL     ?? "http://localhost:3000";
export const STORAGE_STATE = path.join(__dirname, ".auth-state.json");

async function globalSetup(_config: FullConfig) {
  // Clean stale state
  if (fs.existsSync(STORAGE_STATE)) {
    fs.unlinkSync(STORAGE_STATE);
  }

  // If credentials are not available, write an empty auth state and skip login.
  // This happens in CI when the E2E secrets are not configured — tests will
  // fail individually on auth rather than hanging here for minutes.
  if (!E2E_EMAIL || !E2E_PASSWORD) {
    console.log("\n⚠️  E2E_EMAIL / E2E_PASSWORD not set — skipping Firebase login.");
    console.log("   Tests will run unauthenticated and fail on auth-gated pages.\n");
    fs.writeFileSync(STORAGE_STATE, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // Retry loop: CI runners can be slow to boot Next.js + Firebase
    let loggedIn = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`\n🔐 Login attempt ${attempt}/3...`);
        await page.goto(BASE_URL, { timeout: 60000 });
        await page.waitForSelector('input[type="email"]', { timeout: 30000 });

        await page.fill('input[type="email"]', E2E_EMAIL);
        await page.fill('input[type="password"]', E2E_PASSWORD);
        await page.click('button[type="submit"]');

        // Wait for dashboard redirect — confirms login succeeded
        await page.waitForURL(/\/dashboard/, { timeout: 60000 });
        loggedIn = true;
        break;
      } catch (err) {
        console.log(`  Attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`);
        if (attempt < 3) {
          await page.waitForTimeout(3000);
          await page.reload();
        }
      }
    }

    if (!loggedIn) {
      // Write empty state so Playwright doesn't crash; tests will fail on auth
      console.log("\n⚠️  Login failed after 3 attempts — writing empty auth state.");
      fs.writeFileSync(STORAGE_STATE, JSON.stringify({ cookies: [], origins: [] }));
      return;
    }

    // Give Firebase JS SDK time to write auth to localStorage / IndexedDB
    await page.waitForTimeout(3000);

    // Save auth state (cookies + localStorage)
    await page.context().storageState({ path: STORAGE_STATE });
    console.log(`\n✅ E2E auth state saved to: ${STORAGE_STATE}`);

  } finally {
    await page.close();
    await browser.close();
  }
}

export default globalSetup;
