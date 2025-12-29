import express from "express";
import { existsSync } from "fs";
import path from "path";
import type serveStatic from "serve-static";

import { assetUrlFragment } from "../services/asset_path.js";
import { getResourceDir, isDev } from "../services/utils.js";

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

    if (process.env.NODE_ENV === "development") {
        const { createServer: createViteServer } = await import("vite");
        const clientDir = path.join(srcRoot, "../client");
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: "custom",
            cacheDir: path.join(srcRoot, "../../.cache/vite"),
            base: `/${assetUrlFragment}/`,
            root: clientDir,
            css: { devSourcemap: true }
        });
        app.use(`/${assetUrlFragment}/`, (req, res, next) => {
            req.url = `/${assetUrlFragment}${req.url}`;
            vite.middlewares(req, res, next);
        });
        app.use(`/node_modules/@excalidraw/excalidraw/dist/prod`, persistentCacheStatic(path.join(srcRoot, "../../node_modules/@excalidraw/excalidraw/dist/prod")));
    } else {
        const publicDir = path.join(resourceDir, "public");
        if (!existsSync(publicDir)) {
            throw new Error(`Public directory is missing at: ${path.resolve(publicDir)}`);
        }

        app.use(`/${assetUrlFragment}/src`, persistentCacheStatic(path.join(publicDir, "src")));
        app.use(`/${assetUrlFragment}/stylesheets`, persistentCacheStatic(path.join(publicDir, "stylesheets")));
        app.use(`/${assetUrlFragment}/fonts`, persistentCacheStatic(path.join(publicDir, "fonts")));
        app.use(`/${assetUrlFragment}/translations/`, persistentCacheStatic(path.join(publicDir, "translations")));
        app.use(`/node_modules/`, persistentCacheStatic(path.join(publicDir, "node_modules")));
    }
    app.use(`/share/assets/fonts/`, express.static(path.join(getClientDir(), "fonts")));
    app.use(`/share/assets/`, express.static(getShareThemeAssetDir()));
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
