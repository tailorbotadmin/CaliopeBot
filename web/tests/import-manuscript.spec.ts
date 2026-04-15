/**
 * E2E tests for CalíopeBot — Manuscript Import Flow
 *
 * Pre-requisites:
 *   - `npm run dev` running at http://localhost:3000
 *   - A test user exists in Firebase:
 *       email:    process.env.E2E_EMAIL    (default: test_e2e@tailorbot.tech)
 *       password: process.env.E2E_PASSWORD (default: testpassword123)
 *       role:     SuperAdmin
 *
 * Run:
 *   npx playwright test tests/import-manuscript.spec.ts --headed
 *   npx playwright test tests/import-manuscript.spec.ts  # headless
 */

import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// ── Credentials from env (CI uses secrets, local uses defaults) ────────────
const E2E_EMAIL    = process.env.E2E_EMAIL    ?? "test_e2e@tailorbot.tech";
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "testpassword123";
const BASE_URL     = process.env.BASE_URL     ?? "http://localhost:3000";

// ── Helper: create a minimal valid .docx buffer ────────────────────────────
// We write a base64-encoded minimal docx (Office Open XML format).
// This avoids needing a file on disk.
function createMinimalDocxBuffer(): Buffer {
  // Minimal docx is a zip of XML files; we use a pre-built base64 fixture.
  // Alternatively, require("docx") on the Node side — but Playwright runs in
  // browser context for page.* calls, so we use fs here in the Node side.
  const fixturePath = path.join(__dirname, "fixtures", "sample.docx");
  if (fs.existsSync(fixturePath)) {
    return fs.readFileSync(fixturePath);
  }
  throw new Error(
    `Fixture file not found: ${fixturePath}\n` +
    `Run: node tests/fixtures/create-fixture.mjs to generate it.`
  );
}

// ── Helper: login ──────────────────────────────────────────────────────────
async function login(page: Page) {
  await page.goto(BASE_URL);
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });

  await page.fill('input[type="email"]', E2E_EMAIL);
  await page.fill('input[type="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');

  // Wait for redirect to dashboard
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────

test.describe("Manuscript Import Flow", () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("1. Login redirects to dashboard", async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/);
    // Dashboard main heading or KPI cards visible
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible();
  });

  test("2. Books page loads and shows upload button", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/books`);
    await page.waitForLoadState("networkidle");

    // The "Subir Manuscrito" / "Nuevo" button should be visible
    const uploadBtn = page.getByRole("button", { name: /subir|nuevo|upload/i });
    await expect(uploadBtn).toBeVisible({ timeout: 10000 });
  });

  test("3. Upload modal opens on button click", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/books`);
    await page.waitForLoadState("networkidle");

    const uploadBtn = page.getByRole("button", { name: /subir|nuevo|upload/i });
    await uploadBtn.click();

    // Modal should appear with a file input
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached({ timeout: 5000 });
  });

  test("4. Upload a .docx manuscript and verify it appears in the list", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/books`);
    await page.waitForLoadState("networkidle");

    // Count existing books before upload
    const booksBefore = await page.locator("[data-testid='book-card'], .book-card, [class*='book-item']").count();

    // Open upload modal
    const uploadBtn = page.getByRole("button", { name: /subir|nuevo|upload/i });
    await uploadBtn.click();

    // Set file on input
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached({ timeout: 5000 });

    const fixturePath = path.join(__dirname, "fixtures", "sample.docx");
    await fileInput.setInputFiles(fixturePath);

    // Fill in title if a form field exists
    const titleInput = page.locator('input[placeholder*="título"], input[name="title"], input[id="title"]');
    if (await titleInput.count() > 0) {
      await titleInput.fill("Test E2E Manuscript " + Date.now());
    }

    // Submit the upload form
    const submitBtn = page.getByRole("button", { name: /subir|cargar|upload|confirmar/i }).last();
    await submitBtn.click();

    // Wait for the new book to appear (status: processing or review_editor)
    await page.waitForTimeout(3000); // brief wait for Firestore write

    // Verify at least one book is shown and the page didn't crash
    await expect(page.locator("body")).not.toContainText("Error");
    await expect(page.locator("body")).not.toContainText("Unexpected");

    // Optionally verify book count increased or a "processing" state is visible
    const processingBadge = page.locator("text=Procesando, text=processing").first();
    const booksAfter = await page.locator("[data-testid='book-card'], .book-card, [class*='book-item']").count();

    const bookUploaded = booksAfter > booksBefore || await processingBadge.isVisible().catch(() => false);
    expect(bookUploaded).toBeTruthy();
  });

  test("5. Corrections page loads without errors", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/corrections`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("body")).not.toContainText("Error al cargar");
    await expect(page.locator("body")).not.toContainText("500");
  });

  test("6. Reports page shows KPI section", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/reports`);
    await page.waitForLoadState("networkidle");

    // Should render without error; KPI or chart section should be present
    await expect(page.locator("body")).not.toContainText("Error");
    const kpiArea = page.locator("[class*='kpi'], [class*='stat'], h2, h3").first();
    await expect(kpiArea).toBeVisible({ timeout: 10000 });
  });

  test("7. Criteria page loads for SuperAdmin", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/criteria`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("body")).not.toContainText("Access denied");
    await expect(page.locator("body")).not.toContainText("500");
  });

  test("8. Settings page shows team members section", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/settings`);
    await page.waitForLoadState("networkidle");

    // "Equipo" / "Members" heading should be visible for Admin/SuperAdmin
    const teamSection = page.locator("text=Equipo, text=Team, text=Miembros").first();
    await expect(teamSection).toBeVisible({ timeout: 10000 });
  });

});
