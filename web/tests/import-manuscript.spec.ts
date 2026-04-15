/**
 * E2E tests for CalíopeBot — Manuscript Import Flow
 *
 * Firebase JS SDK persists auth in IndexedDB, which Playwright's storageState
 * does not serialize. Solution: each test logs in via the UI (fast — ~2-3s).
 *
 * Pre-requisites:
 *   - Next.js running at http://localhost:3000
 *   - Test user in Firebase Auth:
 *       email:    E2E_EMAIL env var   (default: test_e2e@tailorbot.tech)
 *       password: E2E_PASSWORD env var (default: testpassword123)
 *       role:     SuperAdmin, organizationId set
 *
 * Run:
 *   npx playwright test tests/import-manuscript.spec.ts --headed
 *   npx playwright test tests/import-manuscript.spec.ts
 */

import { test, expect, Page } from "@playwright/test";
import * as path from "path";

const E2E_EMAIL    = process.env.E2E_EMAIL    ?? "test_e2e@tailorbot.tech";
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "testpassword123";
const BASE_URL     = process.env.BASE_URL     ?? "http://localhost:3000";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Log in via the UI and wait for the dashboard. */
async function login(page: Page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', E2E_EMAIL);
  await page.fill('input[type="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 25000 });
  // Let React + Firebase state settle
  await page.waitForTimeout(1500);
}

/** Wait for the page to be stable without relying on networkidle
 *  (Firebase real-time listeners keep the network busy indefinitely). */
async function waitStable(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
}

// ── Tests ─────────────────────────────────────────────────────────────────

test.describe("Manuscript Import Flow", () => {

  // ── Test 1: Login → dashboard ──────────────────────────────────────────
  test("1. Login redirects to dashboard", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);
    // A heading or KPI card should be visible
    await expect(page.locator("h1, h2, h3").first()).toBeVisible({ timeout: 8000 });
  });

  // ── Test 2: Books page upload button ──────────────────────────────────
  test("2. Books page loads and shows upload button", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/dashboard/books`, { waitUntil: "domcontentloaded" });
    await waitStable(page);

    const uploadBtn = page.getByRole("button", { name: /subir|nuevo|upload|import/i }).first();
    await expect(uploadBtn).toBeVisible({ timeout: 10000 });
  });

  // ── Test 3: Upload modal opens ─────────────────────────────────────────
  test("3. Upload modal opens on button click", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/dashboard/books`, { waitUntil: "domcontentloaded" });
    await waitStable(page);

    const uploadBtn = page.getByRole("button", { name: /subir|nuevo|upload|import/i }).first();
    await uploadBtn.click();

    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached({ timeout: 8000 });
  });

  // ── Test 4: Upload .docx and verify in list ────────────────────────────
  test("4. Upload a .docx manuscript and verify it appears in the list", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/dashboard/books`, { waitUntil: "domcontentloaded" });
    await waitStable(page);

    // Count books before upload (broad selector for any list item / card)
    const cardSel = "article, li, [class*='card'], [class*='book'], [class*='item']";
    const countBefore = await page.locator(cardSel).count();

    // Open modal
    const uploadBtn = page.getByRole("button", { name: /subir|nuevo|upload|import/i }).first();
    await uploadBtn.click();

    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached({ timeout: 8000 });

    // Upload the fixture docx
    const fixturePath = path.join(__dirname, "fixtures", "sample.docx");
    await fileInput.setInputFiles(fixturePath);

    // Fill title if the form has one
    const titleInput = page
      .locator('input[placeholder*="título"], input[placeholder*="title"], input[name="title"]')
      .first();
    if (await titleInput.count() > 0) {
      await titleInput.fill(`Test E2E ${Date.now()}`);
    }

    // Submit
    const submitBtn = page.getByRole("button", { name: /subir|cargar|upload|confirmar|crear|guardar/i }).last();
    await submitBtn.click();

    // Allow Firestore write + state update
    await page.waitForTimeout(5000);

    // Verify no crash
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("Error inesperado");
    expect(bodyText).not.toContain("Uncaught");

    // Success condition: more items OR a processing/review badge
    const countAfter = await page.locator(cardSel).count();
    const hasProcessingBadge = bodyText.toLowerCase().includes("procesando") ||
                               bodyText.toLowerCase().includes("processing") ||
                               bodyText.toLowerCase().includes("revisión") ||
                               bodyText.toLowerCase().includes("review");

    expect(countAfter > countBefore || hasProcessingBadge).toBeTruthy();
  });

  // ── Test 5: Corrections ───────────────────────────────────────────────
  test("5. Corrections page loads without errors", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/dashboard/corrections`, { waitUntil: "domcontentloaded" });
    await waitStable(page);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("Error al cargar");
    expect(bodyText).not.toContain("500");
    await expect(page.locator("h1, h2, h3, p").first()).toBeVisible({ timeout: 8000 });
  });

  // ── Test 6: Reports ───────────────────────────────────────────────────
  test("6. Reports page shows KPI section", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/dashboard/reports`, { waitUntil: "domcontentloaded" });
    await waitStable(page);

    await expect(page.locator("h1, h2, h3").first()).toBeVisible({ timeout: 8000 });
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("Error al cargar");
  });

  // ── Test 7: Criteria ──────────────────────────────────────────────────
  test("7. Criteria page accessible for SuperAdmin", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/dashboard/criteria`, { waitUntil: "domcontentloaded" });
    await waitStable(page);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("Access denied");
    expect(bodyText).not.toContain("500");
    await expect(page.locator("h1, h2, h3, button").first()).toBeVisible({ timeout: 8000 });
  });

  // ── Test 8: Settings ──────────────────────────────────────────────────
  test("8. Settings page shows team section", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/dashboard/settings`, { waitUntil: "domcontentloaded" });
    await waitStable(page);

    // Look for heading containing team-related words
    const heading = page.locator("h1, h2, h3, h4").filter({ hasText: /equipo|miembro|team|usuario|user/i }).first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

});
