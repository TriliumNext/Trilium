import { assetUrlFragment } from "../services/asset_path.js";
import path from "path";
import express from "express";
import { getResourceDir, isDev } from "../services/utils.js";
import type serveStatic from "serve-static";
import { existsSync } from "fs";

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

    // In Vitest integration tests we do not want to start Vite dev server (it creates a WS server on a fixed port
    // which causes port conflicts when multiple app instances are created in parallel).
    // Skip Vite in tests and serve built assets instead.
    const isVitest = process.env.VITEST === "true" || process.env.TRILIUM_INTEGRATION_TEST;
    if (process.env.NODE_ENV === "development" && !isVitest) {
        // Use a dynamic string for the module name so TypeScript doesn't try to resolve "vite" types in app build.
        const viteModuleName = "vite" as string;
        const { createServer: createViteServer } = (await import(viteModuleName)) as any;
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: "custom",
            cacheDir: path.join(srcRoot, "../../.cache/vite"),
            base: `/${assetUrlFragment}/`,
            root: path.join(srcRoot, "../client")
        });
        app.use(`/${assetUrlFragment}/`, (req, res, next) => {
            req.url = `/${assetUrlFragment}` + req.url;
            vite.middlewares(req, res, next);
        });
    } else {
        const publicDir = path.join(resourceDir, "public");
        // In test or non-built environments, the built public directory might not exist. Fall back to
        // source public assets so app initialization doesn't fail during tests.
        let resolvedPublicDir = publicDir;
        if (!existsSync(publicDir)) {
            const fallbackPublic = path.join(srcRoot, "public");
            if (existsSync(fallbackPublic)) {
                resolvedPublicDir = fallbackPublic;
            } else {
                // If absolutely nothing exists and we're in production, fail fast; otherwise, skip mounting.
                if (process.env.NODE_ENV === "production") {
                    throw new Error("Public directory is missing at: " + path.resolve(publicDir));
                }
                // Skip mounting asset subpaths when neither built nor source assets are available (e.g. in certain tests).
                resolvedPublicDir = "";
            }
        }

        if (resolvedPublicDir) {
            app.use(`/${assetUrlFragment}/src`, persistentCacheStatic(path.join(resolvedPublicDir, "src")));
            app.use(`/${assetUrlFragment}/stylesheets`, persistentCacheStatic(path.join(resolvedPublicDir, "stylesheets")));
            app.use(`/${assetUrlFragment}/fonts`, persistentCacheStatic(path.join(resolvedPublicDir, "fonts")));
            app.use(`/${assetUrlFragment}/translations/`, persistentCacheStatic(path.join(resolvedPublicDir, "translations")));
            app.use(`/node_modules/`, persistentCacheStatic(path.join(resolvedPublicDir, "node_modules")));
        }
    }
    app.use(`/${assetUrlFragment}/images`, persistentCacheStatic(path.join(resourceDir, "assets", "images")));
    app.use(`/${assetUrlFragment}/doc_notes`, persistentCacheStatic(path.join(resourceDir, "assets", "doc_notes")));
    app.use(`/assets/vX/fonts`, express.static(path.join(srcRoot, "public/fonts")));
    app.use(`/assets/vX/images`, express.static(path.join(srcRoot, "..", "images")));
    app.use(`/assets/vX/stylesheets`, express.static(path.join(srcRoot, "public/stylesheets")));
}

export default {
    register
};
