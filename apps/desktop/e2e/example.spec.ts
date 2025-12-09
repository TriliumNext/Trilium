import { test, expect, _electron as electron, type ElectronApplication, request } from '@playwright/test';
import { join } from 'path';
import App from './support';

let app: ElectronApplication;

test.beforeAll(async () => {
    const distPath = join(__dirname, '../../desktop/dist/main.cjs');
    console.log("Dir", join(__dirname, 'traces'));
    app = await electron.launch({
        args: [ distPath ]
    });
});

test.afterAll(async () => {
    try {
      const pid = app.process().pid;

      if (pid) {
          // Double-check process is dead
          try {
            process.kill(pid, 0); // throws if process doesn't exist
            process.kill(pid, 'SIGKILL'); // force kill if still alive
          } catch (e) {
            // Process already dead
          }
      }
    } catch (err) {
      console.warn('Failed to close Electron app cleanly:', err);
    }

    await app.close();
});

test('First setup', async () => {
    // Get the main window
    const setupWindow = await app.firstWindow();
    await expect(setupWindow).toHaveTitle("Setup");
    await expect(setupWindow.locator('h1')).toHaveText("Trilium Notes setup");
    await setupWindow.locator(`input[type="radio"]`).first().click();

    // Wait for the finish.
    const newWindowPromise = app.waitForEvent('window');
    await setupWindow.locator(`button[type="submit"]`, { hasText: "Next" }).click();

    const mainWindow = await newWindowPromise;
    await expect(mainWindow).toHaveTitle("Trilium Notes");

    const support = new App(mainWindow);
    await support.selectNoteInNoteTree("Trilium Demo");
    await support.setNoteShared(true);

    const sharedInfoWidget = support.currentNoteSplit.locator(".shared-info-widget");
    await expect(sharedInfoWidget).toBeVisible();

    const sharedInfoLink = sharedInfoWidget.locator("a.shared-link");
    const linkUrl = await sharedInfoLink.getAttribute("href");
    expect(linkUrl).toBeDefined();

    // Verify the shared link is valid
    const requestContext = await request.newContext();
    const response = await requestContext.get(linkUrl!);
    await expect(response).toBeOK();

    await mainWindow.waitForTimeout(5000);
});
