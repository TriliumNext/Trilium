import { test, expect } from "@playwright/test";
import App from "./support/app";

test("Can duplicate note with broken links", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto({
        url: "http://localhost:8082/#root/Q5abPvymDH6C/2VammGGdG6Ie"
    });

    await app.noteTree.getByText("Note map").first().click({ button: "right" });
    await page.locator("#context-menu-container").getByText("Duplicate").click();
    await expect(page.locator(".toast-body")).toBeHidden();
    await expect(app.noteTree.getByText("Note map (dup)")).toBeVisible();
});
