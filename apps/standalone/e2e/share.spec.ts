import test, { expect } from "@playwright/test";

import App from "../../../packages/trilium-e2e/src/support/app";

/**
 * Shared notes in the browser-only build.
 *
 * There is no server here, so a `/share/` URL is claimed by the service worker, forwarded to the
 * tab holding the database, and rendered by `@triliumnext/core`'s share subsystem inside the
 * worker. Nobody outside this browser can reach these pages; what they make possible is working on
 * the share feature, and reading published notes, without a server build.
 *
 * Requests go through the page rather than Playwright's `request` fixture, which issues them
 * outside the browser and so never reaches the service worker.
 *
 * The fixture's share root is "Shared notes" (`y0AFOwgOgkWO`, labelled `#shareRoot`).
 */
const SHARE_ROOT_ID = "y0AFOwgOgkWO";

test("renders a published note, its tree and the share theme", async ({ context }) => {
    // The database lives in the app tab; without one open there is nothing to render the page.
    const app = new App(await context.newPage(), context);
    await app.goto();
    await expect(app.noteTree).toContainText("Trilium Integration Test");

    const share = await context.newPage();
    const response = await share.goto(`/share/${SHARE_ROOT_ID}`);

    expect(response?.status()).toBe(200);
    await expect(share.locator("h1#title")).toContainText("Shared notes");

    // The tree lists the shared children, but not the one marked #shareHiddenFromTree.
    await expect(share.locator("#menu")).toContainText("Shared that uses template");
    await expect(share.locator("#menu")).not.toContainText("Shared Note Template");

    // The theme's stylesheet is copied into the build rather than answered by a route, so a missing
    // copy step would leave the page unstyled instead of failing outright.
    const stylesStatus = await share.evaluate(async () => (await fetch("/share/assets/styles.css")).status);
    expect(stylesStatus).toBe(200);
});

test("refuses a note behind shareCredentials until they are supplied", async ({ context }) => {
    const app = new App(await context.newPage(), context);
    await app.goto();
    await expect(app.noteTree).toContainText("Trilium Integration Test");

    // "Password protected share" carries #shareCredentials=root:password.
    const anonymous = await app.page.evaluate(async () => {
        const res = await fetch("/share/YjlPRj2E9fOV");

        return { status: res.status, authenticate: res.headers.get("www-authenticate") };
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.authenticate).toContain("Basic realm=");

    const authorized = await app.page.evaluate(async () => {
        const res = await fetch("/share/YjlPRj2E9fOV", { headers: { authorization: `Basic ${btoa("root:password")}` } });

        return { status: res.status, body: await res.text() };
    });
    expect(authorized.status).toBe(200);
    expect(authorized.body).toContain("Password protected share");
});
