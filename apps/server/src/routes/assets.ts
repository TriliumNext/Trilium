import express from "express";
import rateLimit from "express-rate-limit";
import { existsSync } from "fs";
import path from "path";
import type serveStatic from "serve-static";

import { assetUrlFragment } from "../services/asset_path.js";
import auth from "../services/auth.js";
import { getResourceDir, isDev } from "../services/utils.js";
import { doubleCsrfProtection as csrfMiddleware } from "./csrf_protection.js";

const persistentCacheStatic = (root: string, options?: serveStatic.ServeStaticOptions<express.Response<unknown, Record<string, unknown>>>) => {
    if (!isDev) {
        options = {
            maxAge: "1y",
            ...options
        };
    }
    return express.static(root, options);
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
            server: { middlewareMode: true },
            appType: "spa",
            configFile: path.join(clientDir, "vite.config.mts"),
            base: `/${assetUrlFragment}/`
        });
        app.use(`/${assetUrlFragment}/`, (req, res, next) => {
            if (req.url.startsWith("/images/")) {
                // Images are served as static assets from the server.
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
            res.sendFile(path.join(publicDir, "index.html"));
        });
        app.use("/assets", persistentCacheStatic(path.join(publicDir, "assets")));
        app.use(`/src`, persistentCacheStatic(path.join(publicDir, "src")));
        app.use(`/${assetUrlFragment}/src`, persistentCacheStatic(path.join(publicDir, "src")));
        app.use(`/${assetUrlFragment}/stylesheets`, persistentCacheStatic(path.join(publicDir, "stylesheets")));
        app.use(`/${assetUrlFragment}/fonts`, persistentCacheStatic(path.join(publicDir, "fonts")));
        app.use(`/${assetUrlFragment}/translations/`, persistentCacheStatic(path.join(publicDir, "translations")));
        app.use(`/node_modules/`, persistentCacheStatic(path.join(publicDir, "node_modules")));
    }
    app.use(`/share/assets/fonts/`, express.static(path.join(getClientDir(), "fonts")));
    app.use(`/share/assets/`, express.static(getShareThemeAssetDir()));
    app.use(`/pdfjs/`, persistentCacheStatic(getPdfjsAssetDir()));
    app.use(`/${assetUrlFragment}/images`, persistentCacheStatic(path.join(resourceDir, "assets", "images")));
    app.use(`/${assetUrlFragment}/doc_notes`, persistentCacheStatic(path.join(resourceDir, "assets", "doc_notes")));
    app.use(`/assets/vX/fonts`, express.static(path.join(srcRoot, "public/fonts")));
    app.use(`/assets/vX/images`, express.static(path.join(srcRoot, "..", "images")));
    app.use(`/assets/vX/stylesheets`, express.static(path.join(srcRoot, "public/stylesheets")));
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
