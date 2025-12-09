import test, { expect } from "@playwright/test";
import App from "./support/app";

test("Native Title Bar not displayed on web", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto({ url: "http://localhost:8082/#root/_hidden/_options/_optionsAppearance" });
    await expect(app.currentNoteSplitContent.getByRole("heading", { name: "Theme" })).toBeVisible();
    await expect(app.currentNoteSplitContent.getByRole("heading", { name: "Native Title Bar (requires" })).toBeHidden();
});

test("Tray settings not displayed on web", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto({ url: "http://localhost:8082/#root/_hidden/_options/_optionsOther" });
    await expect(app.currentNoteSplitContent.getByRole("heading", { name: "Note Erasure Timeout" })).toBeVisible();
    await expect(app.currentNoteSplitContent.getByRole("heading", { name: "Tray" })).toBeHidden();
});

test("Spellcheck settings not displayed on web", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto({ url: "http://localhost:8082/#root/_hidden/_options/_optionsSpellcheck" });
    await expect(app.currentNoteSplitContent.getByRole("heading", { name: "Spell Check" })).toBeVisible();
    await expect(app.currentNoteSplitContent.getByRole("heading", { name: "Tray" })).toBeHidden();
    await expect(app.currentNoteSplitContent.getByText("These options apply only for desktop builds")).toBeVisible();
    await expect(app.currentNoteSplitContent.getByText("Enable spellcheck")).toBeHidden();
});
