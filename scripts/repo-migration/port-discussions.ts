/**
 * @module
 *
 * Goes through all discussions in the source repository and transfers them to the target repository.
 *
 * Limitations:
 * - Upon encountering a locked discussion, the script will fail. Make sure to unlock discussions before running the script.
 */

import { type BrowserContext, chromium } from 'playwright';
import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'fs';

const SOURCE_URL = "https://github.com/TriliumNext/Trilium";
const TARGET_REPOSITORY_ID = 92111509;

const fsLog = createWriteStream('port-discussions.log', { flags: 'a' });

async function login(context: BrowserContext) {
    const page = await context.newPage();
    await page.goto('https://github.com/login');

    console.log("👤 Please log in manually in the opened browser...");
    await page.waitForNavigation({ url: 'https://github.com/' }); // Wait for login

    // Save storage state (cookies, localStorage, etc.)
    const storage = await context.storageState();
    writeFileSync('auth.json', JSON.stringify(storage))
    await page.close();
}

async function portIssue(issue: string, context: BrowserContext) {
    const page = await context.newPage();
    await page.goto(`${SOURCE_URL}/discussions/${issue}`);

    const button = page.locator("#dialog-show-discussion-transfer-conversation");
    await button.click();

    const modal = page.locator("#discussion-transfer-conversation");
    const modalContent = page.locator("#transfer-candidate-repos");
    await modalContent.waitFor({ state: 'visible' });

    modalContent.locator(`#transfer_repository_${TARGET_REPOSITORY_ID}`).click();
    const navigationPromise = page.waitForNavigation({
        waitUntil: "domcontentloaded"
    });

    const submitButton = modal.locator(`button[type="submit"]`);
    await submitButton.waitFor({ state: 'attached' });
    await submitButton.click();

    await navigationPromise;
    console.log(`✅ Discussion ${issue} has been transferred to the target repository.`);
    fsLog.write(`Transferred discussion ${issue} to ${page.url()}\n`);
    await page.waitForTimeout(2000); // Wait for a second to ensure the transfer is complete
    await page.close();
}

async function getFirstPageResults(context: BrowserContext) {
    const page = await context.newPage();
    await page.goto(SOURCE_URL + "/discussions");

    // Wait for the discussions to load
    const allDiscussionLinks = (await (page.locator(`a[data-hovercard-type="discussion"]`).all()));
    let ids: string[] = [];
    for (const link of allDiscussionLinks) {
        const url = await link.getAttribute('href');
        const number = url?.match(/\/discussions\/(\d+)/)?.[1];
        if (number) ids.push(number);
    }
    console.log(`Found ${ids.length} discussions.`);
    await page.close();
    return ids;
}

(async () => {
    const browser = await chromium.launch({ headless: false }); // show browser
    let storageState = undefined;
    if (existsSync('auth.json')) {
        console.log("🔑 Using existing authentication state...");
        storageState = JSON.parse(readFileSync('auth.json', 'utf-8'));
    }

    const context = await browser.newContext({ storageState });
    if (!storageState) {
        await login(context);
    }

    const travelledIds: string[] = [];
    let ids = await getFirstPageResults(context);

    while (ids.length > 0) {
        for (const id of ids) {
            try {
                if (travelledIds.includes(id)) {
                    console.log(`Discussion ${id} has already been transferred.`);
                    process.exit(2);
                }

                await portIssue(id, context);
                travelledIds.push(id);
            } catch (error) {
                console.error(`❌ Error transferring discussion ${id}:`, error);
                process.exit(1);
            }
        }

        ids = await getFirstPageResults(context);
    }
    await browser.close();
})();
