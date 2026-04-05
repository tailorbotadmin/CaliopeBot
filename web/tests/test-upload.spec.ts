import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

test('login and upload manuscript', async ({ page }) => {
  test.setTimeout(60000); // 60s timeout for upload to complete

  // 1. Create a dummy docx file to upload
  const dummyFilePath = path.join(__dirname, 'dummy-ag-test.docx');
  if (!fs.existsSync(dummyFilePath)) {
    fs.writeFileSync(dummyFilePath, 'This is a test document created by Antigravity Playwright tests.');
  }

  // 2. Visit the app
  await page.goto('/');

  // 3. Login
  await page.fill('input[type="email"]', 'test_e2e@tailorbot.tech');
  await page.fill('input[type="password"]', 'testpassword123');
  await page.click('button[type="submit"]');

  // 4. Wait for dashboard and navigate to Books/Manuscritos
  await expect(page.locator('text=Rol activo:')).toBeVisible({ timeout: 10000 });
  await page.click('text=Ver Catálogo');

  // 5. Click on 'Subir Manuscrito' (Open modal)
  await page.click('button:has-text("Subir Manuscrito")');
  
  // 6. Fill Out Book form
  await expect(page.getByRole('heading', { name: 'Nuevo Manuscrito' })).toBeVisible();
  await page.fill('input[placeholder="Ej. Cien años de soledad"]', 'Test Automated Manuscript');
  
  // Choose organization if multiple
  // SuperAdmin might have it auto-selected or we need to click.
  // We'll see if the 'Subir manuscrito' button works or is disabled
  
  // 7. Upload file
  const fileInput = await page.locator('input[type="file"]');
  await fileInput.setInputFiles(dummyFilePath);

  // 8. Submit
  await page.click('button[type="submit"]:has-text("Subir Manuscrito")');

  // 9. Verify success: it should navigate back to books or show success
  // Currently the code should redirect away from the modal and we should see "Test Automated Manuscript"
  // Wait to see the title in the list
  await expect(page.locator('text=Test Automated Manuscript').first()).toBeVisible({ timeout: 15000 });
});
