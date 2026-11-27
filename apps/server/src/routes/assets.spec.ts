import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import supertest from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    isDev: true,
    isElectron: false,
    resourceDir: undefined as string | undefined,
    helpDir: "",
    viteMiddlewares: vi.fn(),
    createServer: vi.fn()
}));

vi.mock("../services/utils.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../services/utils.js")>();
    return {
        ...actual,
        get isDev() { return state.isDev; },
        get isElectron() { return state.isElectron; },
        getResourceDir: () => state.resourceDir ?? actual.getResourceDir()
    };
});
vi.mock("../services/port.js", () => ({ default: 8080 }));
vi.mock("../services/auth.js", () => ({
    default: { checkAuth: (_req: unknown, _res: unknown, next: () => void) => next() }
}));
vi.mock("./csrf_protection.js", () => ({
    doubleCsrfProtection: (_req: unknown, _res: unknown, next: () => void) => next()
}));
vi.mock("../in_app_help_provider.js", () => ({ getHelpAssetDir: () => state.helpDir }));
vi.mock("vite", () => ({ createServer: state.createServer }));

import { assetUrlFragment } from "../services/asset_path.js";
import assets, { getClientBuildDir, getClientDir, getPdfjsAssetDir, getShareThemeAssetDir } from "./assets.js";

const originalNodeEnv = process.env.NODE_ENV;

// The test runner sets NODE_ENV=development, which exercises the dev branch of
// these path helpers. Toggle to production to cover the resource-dir branch too.
describe("assets path helpers", () => {
    afterEach(() => { process.env.NODE_ENV = originalNodeEnv; });

    it("resolves dev paths under development", () => {
        process.env.NODE_ENV = "development";
        expect(getShareThemeAssetDir()).toBe(path.join(getClientBuildDir(), "src"));
        expect(getPdfjsAssetDir()).toContain("pdfjs-viewer");
        expect(getClientDir()).toContain("client");
        expect(getClientBuildDir()).toBe(path.join(getClientDir(), "..", "dist"));
    });

    it("resolves resource-dir paths under production", () => {
        process.env.NODE_ENV = "production";
        expect(getShareThemeAssetDir()).toBe(path.join(getClientBuildDir(), "src"));
        expect(getPdfjsAssetDir()).toContain("pdfjs-viewer");
        expect(typeof getClientDir()).toBe("string");
        expect(getClientBuildDir()).toBe(getClientDir());
    });
});

describe("assets registration", () => {
    let resourceDir: string;

    beforeAll(() => {
        resourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-assets-"));
        const write = (relativePath: string, content: string) => {
            const filePath = path.join(resourceDir, relativePath);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content);
        };
        write("assets/images/legend.txt", "image-text");
        write("help/page.txt", "help-text");
        write("public/index.html", "<html>app</html>");
        write("public/assets/app.css", "app-css");
        write("public/src/main.js", "main-js");
        write("public/stylesheets/theme.css", "theme-css");
        write("public/translations/en/translation.json", "{}");
        write("public/node_modules/lib/index.js", "lib-js");
        state.resourceDir = resourceDir;
        state.helpDir = path.join(resourceDir, "help");

        state.viteMiddlewares.mockImplementation((req: express.Request, res: express.Response) => {
            res.send(`vite:${req.url}`);
        });
        state.createServer.mockImplementation(async () => ({ middlewares: state.viteMiddlewares }));
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        state.isDev = true;
        state.isElectron = false;
        state.createServer.mockClear();
        state.viteMiddlewares.mockClear();
    });

    afterAll(() => {
        state.resourceDir = undefined;
        fs.rmSync(resourceDir, { recursive: true, force: true });
    });

    async function registerApp(nodeEnv: string) {
        process.env.NODE_ENV = nodeEnv;
        const app = express();
        await assets.register(app);
        return app;
    }

    it("hands the client to Vite in development, except the images and help served from disk", async () => {
        const app = await registerApp("development");
        const viteUrl = async (url: string) => (await supertest(app).get(url).expect(200)).text;

        expect(await viteUrl(`/${assetUrlFragment}/src/index.tsx`)).toBe("vite:/src/index.tsx");
        expect(await viteUrl("/")).toBe(`vite:/${assetUrlFragment}/index.html`);
        expect(await viteUrl("/src/index.ts")).toBe(`vite:/${assetUrlFragment}/src/index.ts`);
        expect(await viteUrl("/share/assets/scripts.css")).toBe(`vite:/${assetUrlFragment}/share/assets/scripts.css`);

        state.viteMiddlewares.mockClear();
        const image = await supertest(app).get(`/${assetUrlFragment}/images/legend.txt`).expect(200);
        expect(image.text).toBe("image-text");
        expect(image.headers["cache-control"]).toBe("public, max-age=0");
        await supertest(app).get(`/${assetUrlFragment}/help/page.txt`).expect(200, "help-text");
        expect(state.viteMiddlewares).not.toHaveBeenCalled();
    });

    it("gives Vite its own HMR port, pinned to loopback under Electron", async () => {
        await registerApp("development");
        state.isElectron = true;
        await registerApp("development");

        const [ browser, electron ] = state.createServer.mock.calls.map(([ options ]) => options.server.ws);
        expect(browser).toEqual({ port: 8090 });
        expect(electron).toEqual({ port: 8090, host: "127.0.0.1", protocol: "ws" });
    });

    it("serves the built client from the resource directory in production", async () => {
        state.isDev = false;
        const app = await registerApp("production");
        const get = (url: string) => supertest(app).get(url).expect(200);

        const index = await get("/");
        expect(index.text).toBe("<html>app</html>");
        expect(index.headers["cache-control"]).toBe("no-cache, no-store, must-revalidate");

        const css = await get("/assets/app.css");
        expect(css.text).toBe("app-css");
        expect(css.headers["cache-control"]).toBe("public, max-age=31536000");
        expect((await get("/src/main.js")).text).toBe("main-js");
        expect((await get(`/${assetUrlFragment}/src/main.js`)).text).toBe("main-js");
        expect((await get(`/${assetUrlFragment}/stylesheets/theme.css`)).text).toBe("theme-css");
        expect((await get(`/${assetUrlFragment}/translations/en/translation.json`)).text).toBe("{}");
        expect((await get("/node_modules/lib/index.js")).text).toBe("lib-js");
        expect((await get("/share/assets/main.js")).text).toBe("main-js");
        expect((await get("/share/assets/app.css")).text).toBe("app-css");
        expect((await get("/assets/vX/stylesheets/theme.css")).headers["cache-control"]).toBe("public, max-age=0");
        expect(state.createServer).not.toHaveBeenCalled();
    });

    it("refuses to start in production without the built client", async () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-assets-empty-"));
        state.resourceDir = empty;
        try {
            await expect(registerApp("production")).rejects.toThrow(
                `Public directory is missing at: ${path.resolve(empty, "public")}`);
        } finally {
            state.resourceDir = resourceDir;
            fs.rmSync(empty, { recursive: true, force: true });
        }
    });
});
