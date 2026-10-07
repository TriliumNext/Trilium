import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { join } from 'path';
import App from './support';

let app: ElectronApplication;

test.beforeAll(async () => {
    const distPath = join(__dirname, '../../desktop/dist/main.mjs');
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
    await setupWindow.getByRole("button", { name: "Continue" }).click();
    await setupWindow.getByText("New knowledge base").click();

    // Wait for the finish.
    const newWindowPromise = app.waitForEvent('window');
    await setupWindow.getByText("With demo content").click();

    const mainWindow = await newWindowPromise;
    await expect(mainWindow).toHaveTitle("Trilium Notes");

    const support = new App(mainWindow);
    await support.selectNoteInNoteTree("Trilium Demo");
    await support.setNoteShared(true);

    await expect(support.currentNoteSplit.locator(".share-badge").first()).toBeVisible();
});
