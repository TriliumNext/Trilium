import express from "express";
import rateLimit from "express-rate-limit";
import { existsSync } from "fs";
import path from "path";
import type serveStatic from "serve-static";

import { assetUrlFragment } from "../services/asset_path.js";
import auth from "../services/auth.js";
import port from "../services/port.js";
import { getResourceDir, isDev, isElectron } from "../services/utils.js";
import { doubleCsrfProtection as csrfMiddleware } from "./csrf_protection.js";

// Allow serving assets even if the installation path contains a hidden (dot-prefixed) directory.
const STATIC_OPTIONS: serveStatic.ServeStaticOptions = { dotfiles: "allow" };

const persistentCacheStatic = (root: string, options?: serveStatic.ServeStaticOptions<express.Response<unknown, Record<string, unknown>>>) => {
    if (!isDev) {
        options = {
            maxAge: "1y",
            ...options
        };
    }
    return express.static(root, { ...STATIC_OPTIONS, ...options });
};

async function register(app: express.Application) {
    const srcRoot = path.join(__dirname, "..", "..");
    const resourceDir = getResourceDir();

    const rootLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100 // limit each IP to 100 requests per windowMs
    });

    if (process.env.NODE_ENV === "development") {
        const { createServer: createViteServer } = await import("vite");
        const clientDir = path.join(srcRoot, "../client");
        const vite = await createViteServer({
            server: {
                middlewareMode: true,
                hmr: {
                    // Derive a unique HMR port from the application port so
                    // multiple dev instances (e.g. server on 8080, desktop on
                    // 37742) don't all fight over Vite's default port 24678.
                    port: port + 10,
                    // Under Electron the page loads from `trilium-app://app/`,
                    // so Vite's default of using `window.location.hostname`
                    // would try `ws://app:…` — DNS fails. Pin the HMR client
                    // to loopback explicitly.
                    ...(isElectron ? { host: "127.0.0.1", protocol: "ws" as const } : {})
                }
            },
            appType: "spa",
            configFile: path.join(clientDir, "vite.config.mts"),
            base: `/${assetUrlFragment}/`,
            // One dep-optimizer cache per dev instance. The client config points
            // `cacheDir` at a single repo-level directory, but the optimizer
            // invalidates the whole cache whenever its `configHash` changes —
            // and that hash differs between the Node-hosted dev server and the
            // Electron-hosted one. Sharing the directory therefore made every
            // switch between `server:start` and `desktop:start` re-scan and
            // re-bundle the whole dependency graph, adding ~3s to startup.
            cacheDir: path.join(clientDir, "../..", ".cache", `vite-${port}`)
        });
        app.use(`/${assetUrlFragment}/`, (req, res, next) => {
            if (req.url.startsWith("/images/") || req.url.startsWith("/help/")) {
                // Images and the in-app help's assets are served as static assets from the server.
                // Anything not listed here is handed to Vite, which answers unknown paths with
                // index.html — a 200 that looks fine until you read the body.
                next();
                return;
            }

            vite.middlewares(req, res, next);
        });
        app.get(`/`, [ rootLimiter, auth.checkAuth, csrfMiddleware ], (req, res, next) => {
            req.url = `/${assetUrlFragment}/index.html`;
            vite.middlewares(req, res, next);
        });
        app.get(`/src/index.ts`, [ rootLimiter ], (req, res, next) => {
            req.url = `/${assetUrlFragment}/src/index.ts`;
            vite.middlewares(req, res, next);
        });
        app.use(`/node_modules/@excalidraw/excalidraw/dist/prod`, persistentCacheStatic(path.join(srcRoot, "../../node_modules/@excalidraw/excalidraw/dist/prod")));
    } else {
        const publicDir = path.join(resourceDir, "public");
        if (!existsSync(publicDir)) {
            throw new Error(`Public directory is missing at: ${path.resolve(publicDir)}`);
        }

        app.get(`/`, [ rootLimiter, auth.checkAuth, csrfMiddleware ], (_, res) => {
            // We force the page to not be cached since on mobile the CSRF token can be
            // broken when closing the browser and coming back in to the page.
            // The page is restored from cache, but the API call fail.
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            res.sendFile(path.join(publicDir, "index.html"), STATIC_OPTIONS);
        });
        app.use("/assets", persistentCacheStatic(path.join(publicDir, "assets")));
        app.use(`/src`, persistentCacheStatic(path.join(publicDir, "src")));
        app.use(`/${assetUrlFragment}/src`, persistentCacheStatic(path.join(publicDir, "src")));
        app.use(`/${assetUrlFragment}/stylesheets`, persistentCacheStatic(path.join(publicDir, "stylesheets")));
        app.use(`/${assetUrlFragment}/fonts`, persistentCacheStatic(path.join(publicDir, "fonts")));
        app.use(`/${assetUrlFragment}/translations/`, persistentCacheStatic(path.join(publicDir, "translations")));
        app.use(`/node_modules/`, persistentCacheStatic(path.join(publicDir, "node_modules")));
    }
    app.use(`/share/assets/fonts/`, express.static(path.join(getClientDir(), "fonts"), STATIC_OPTIONS));
    app.use(`/share/assets/`, express.static(getShareThemeAssetDir(), STATIC_OPTIONS));
    app.use(`/pdfjs/`, persistentCacheStatic(getPdfjsAssetDir()));
    app.use(`/${assetUrlFragment}/images`, persistentCacheStatic(path.join(resourceDir, "assets", "images")));
    // Images and attachments of the in-app help. They are not committed under the server's assets
    // — the User Guide owns them — so in a source checkout they are served straight out of docs/,
    // while a packaged build copies them in (see scripts/build.ts).
    app.use(`/${assetUrlFragment}/help`, persistentCacheStatic(getHelpAssetDir(srcRoot, resourceDir)));
    app.use(`/assets/vX/fonts`, express.static(path.join(srcRoot, "public/fonts"), STATIC_OPTIONS));
    app.use(`/assets/vX/images`, express.static(path.join(srcRoot, "..", "images"), STATIC_OPTIONS));
    app.use(`/assets/vX/stylesheets`, express.static(path.join(srcRoot, "public/stylesheets"), STATIC_OPTIONS));
}

/**
 * Where the in-app help's assets live: the markdown export in a source checkout, the copy the
 * build makes in a packaged one.
 */
function getHelpAssetDir(srcRoot: string, resourceDir: string) {
    if (isDev) {
        return path.join(srcRoot, "..", "..", "docs", "User Guide");
    }
    return path.join(resourceDir, "assets", "help");
}

export function getShareThemeAssetDir() {
    if (process.env.NODE_ENV === "development") {
        const srcRoot = path.join(__dirname, "..", "..");
        return path.join(srcRoot, "../../packages/share-theme/dist");
    }
    const resourceDir = getResourceDir();
    return path.join(resourceDir, "share-theme/assets");
}

export function getPdfjsAssetDir() {
    if (process.env.NODE_ENV === "development") {
        const srcRoot = path.join(__dirname, "..", "..");
        return path.join(srcRoot, "../../packages/pdfjs-viewer/dist");
    }
    const resourceDir = getResourceDir();
    return path.join(resourceDir, "pdfjs-viewer");
}

export function getClientDir() {
    if (process.env.NODE_ENV === "development") {
        const srcRoot = path.join(__dirname, "..", "..");
        return path.join(srcRoot, "../client/src");
    }
    const resourceDir = getResourceDir();
    return path.join(resourceDir, "public");
}

export default {
    register
};
