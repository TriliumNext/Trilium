import { execSync } from "child_process";
import { build as esbuild } from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, delimiter, extname, join } from "path";

export default class BuildHelper {

    rootDir: string;
    projectDir: string;
    outDir: string;

    constructor(projectPath: string) {
        this.rootDir = join(__dirname, "..");
        this.projectDir = join(this.rootDir, projectPath);
        this.outDir = join(this.projectDir, "dist");

        rmSync(this.outDir, { recursive: true, force: true });
        mkdirSync(this.outDir, { recursive: true });
    }

    /**
     * @param opts.filter receives each source path and returns whether to copy it; directories are
     *   consulted too, so returning false for one skips its whole subtree.
     */
    copy(projectDirPath: string, outDirPath: string, opts?: { filter?: (sourcePath: string) => boolean }) {
        let sourcePath: string;
        if (projectDirPath.startsWith("/") || projectDirPath.startsWith("\\")) {
            sourcePath = join(this.rootDir, projectDirPath.substring(1));
        } else {
            sourcePath = join(this.projectDir, projectDirPath);
        }

        if (outDirPath.endsWith("/")) {
            mkdirSync(join(this.outDir, outDirPath), { recursive: true });
        }
        cpSync(sourcePath, join(this.outDir, outDirPath), { recursive: true, dereference: true, filter: opts?.filter });
    }

    deleteFromOutput(path: string) {
        rmSync(join(this.outDir, path), { recursive: true });
    }

    /**
     * @param entryPoints source entry points to bundle.
     * @param opts.importMetaUrlShim redirects `import.meta.url` to the bundle's own file so
     *   bundled ESM deps calling `createRequire(import.meta.url)` work in CJS output (defaults
     *   to `true`). Must be disabled for scripts that run in Electron's sandboxed renderer (e.g.
     *   the desktop preload), where the injected `require("node:url")` banner throws. Ignored
     *   for ESM output, where `import.meta.url` needs no shim.
     * @param opts.format output format (defaults to `"cjs"`). `"esm"` emits `.mjs` with code
     *   splitting: dynamic `import()` boundaries become separate chunks under `chunks/`, so
     *   V8 never parses or retains the source of a subsystem until it is first used. The
     *   desktop preload must stay `"cjs"` — Electron's sandboxed renderer cannot load ESM.
     */
    async buildBackend(entryPoints: string[], opts: { importMetaUrlShim?: boolean; format?: "cjs" | "esm" } = {}) {
        const { importMetaUrlShim = true, format = "cjs" } = opts;
        const esm = format === "esm";
        const result = await esbuild({
            entryPoints: entryPoints.map(e => join(this.projectDir, e)),
            tsconfig: join(this.projectDir, "tsconfig.app.json"),
            platform: "node",
            bundle: true,
            outdir: this.outDir,
            outExtension: {
                ".js": esm ? ".mjs" : ".cjs"
            },
            format,
            splitting: esm,
            chunkNames: "chunks/[name]-[hash]",
            external: [
                "electron",
                "better-sqlite3",
                "pdfjs-dist",
                "./xhr-sync-worker.js",
                "vite",
                // tesseract.js requires it only when `global.fetch` is missing, which no
                // supported Node or Electron version is. Bundling it would pull in
                // `encoding` and a second iconv-lite.
                "node-fetch",
                // Test fixtures referenced via require.resolve from
                // integration-test-only code paths in apps/server. These
                // paths are gated at runtime by TRILIUM_INTEGRATION_TEST and
                // never reached in production, but esbuild can't see through
                // the gate during static analysis. Marking them external
                // suppresses the spurious "require.resolve not external"
                // warning without affecting the bundle behavior.
                "@triliumnext/core/src/test/*",
                // schema.sql is read via core_assets.ts, which prefers a
                // bundled copy at RESOURCE_DIR/schema.sql (placed there by
                // apps/server/scripts/build.ts) and only falls back to
                // require.resolve in dev/test mode. In bundled production
                // the require.resolve branch is unreachable, but esbuild
                // still sees the static string and warns. External marker
                // suppresses the warning without changing runtime behavior.
                "@triliumnext/core/src/assets/*",
                // The Codex ACP adapter is copied to RESOURCE_DIR/codex-acp.mjs by the
                // build; codex_binary.ts only require.resolve()s the package when running
                // from source.
                "@agentclientprotocol/codex-acp",
                // Loads its native addon from its own platform package at runtime.
                "sherpa-onnx-node"
            ],
            metafile: true,
            loader: {
                ".css": "text",
                ".ejs": "text"
            },
            define: {
                "process.env.NODE_ENV": JSON.stringify("production"),
                // CJS output has no `import.meta`, so esbuild rewrites
                // `import.meta.url` to `{}` (→ undefined). Bundled ESM deps
                // (e.g. @anthropic-ai/claude-agent-sdk) call
                // `createRequire(import.meta.url)` at module top level, which
                // then throws `ERR_INVALID_ARG_VALUE`. Redirect it to the
                // bundle's own file so createRequire()/`.resolve()` anchor at
                // dist/ and can still locate sibling node_modules packages.
                ...(importMetaUrlShim && !esm && { "import.meta.url": "__bundleImportMetaUrl" }),
            },
            // The CJS banner defines the redirect target above. It uses
            // `require("node:url")`, which throws in Electron's sandboxed
            // renderer, so it must be omitted for preload-style bundles.
            // The ESM banner is the mirror image: bundled CJS deps reference
            // `require`, `__filename` and `__dirname`, which do not exist in
            // ESM, so each output file defines them from `import.meta.url`.
            // esbuild's `__require` interop helper picks up the banner's
            // `require` binding for external packages (better-sqlite3 etc.).
            // `__dirname` in a chunk resolves to the bundle root, not
            // `chunks/`: bundled code uses it to find siblings of the entry
            // (preload.cjs, image_worker.cjs, assets/), and which chunk a
            // module lands in must not change what the path means. The
            // `chunks` suffix check matches `chunkNames` above.
            ...(esm ? {
                banner: {
                    js: [
                        `import { createRequire as __bundleCreateRequire } from "node:module";`,
                        `import { fileURLToPath as __bundleFileURLToPath } from "node:url";`,
                        `import { dirname as __bundleDirname } from "node:path";`,
                        `const require = __bundleCreateRequire(import.meta.url);`,
                        `const __filename = __bundleFileURLToPath(import.meta.url);`,
                        `const __bundleFileDir = __bundleDirname(__filename);`,
                        `const __dirname = /[\\\\/]chunks$/.test(__bundleFileDir) ? __bundleDirname(__bundleFileDir) : __bundleFileDir;`
                    ].join("\n")
                }
            } : importMetaUrlShim && {
                banner: {
                    js: `const __bundleImportMetaUrl = require("node:url").pathToFileURL(__filename).href;`
                }
            }),
            minify: true
        });
        // One metafile per entry, named after it, so a later build call cannot overwrite an
        // earlier one's.
        const metaDir = join(this.outDir, "meta");
        mkdirSync(metaDir, { recursive: true });
        const entryName = basename(entryPoints[0], extname(entryPoints[0]));
        writeFileSync(join(metaDir, `${entryName}.json`), JSON.stringify(result.metafile));
    }

    /**
     * Bundles the Tesseract.js OCR worker into the bundle root and copies the engine builds beside
     * it, where their loaders read them from, one per CPU feature level.
     *
     * Only the full engine builds are copied, not the `-lstm` ones. The Node worker's `getCore()`
     * compares its `lstmOnly` boolean against OEM numbers, so it never selects an `-lstm` build.
     *
     * @param entryPoint the path of `tesseract_worker.ts`, relative to the project.
     */
    async buildTesseractWorker(entryPoint: string) {
        await this.buildBackend([ entryPoint ]);
        for (const variant of [ "", "-simd", "-relaxedsimd" ]) {
            const file = `tesseract-core${variant}.wasm`;
            this.copy(`/node_modules/tesseract.js-core/${file}`, file);
        }
    }

    /**
     * Copies the assets the server code reads from `RESOURCE_DIR` at runtime. Both the server and
     * the desktop app run that code, so both builds call this.
     */
    copyServerAssets() {
        this.copy("/apps/server/src/assets", "assets/");
        // Core owns these, but the bundle cannot resolve `@triliumnext/core` paths where no
        // workspace exists (Docker, a packaged app), so they are read from RESOURCE_DIR instead.
        // See core_assets.ts.
        this.copy("/packages/trilium-core/src/assets/schema.sql", "assets/schema.sql");
        this.copy("/packages/trilium-core/src/assets/llm/skills", "assets/llm/skills/");
        // PDFium's own loader resolves the wasm against `import.meta.url`, which in the split
        // bundle names a file under chunks/. See pdf_renderer.ts.
        this.copy("/node_modules/@hyzyla/pdfium/dist/pdfium.wasm", "assets/pdfium.wasm");
        // The Codex ACP adapter runs as a script of its own in a worker thread. See
        // codex_binary.ts.
        this.copy(
            "/node_modules/@agentclientprotocol/codex-acp/dist/index.js", "assets/codex-acp.mjs");
        this.copy("/packages/share-theme/src/templates", "share-theme/templates/");
        // The in-app help's images and attachments live with the User Guide; its pages travel as
        // the content bundle in assets/help, so the Markdown and its meta stay out of the package.
        this.copy("/docs/User Guide", "assets/help/", {
            filter: (sourcePath) => !sourcePath.endsWith(".md") && !sourcePath.endsWith("!!!meta.json")
        });
    }

    buildFrontend() {
        this.triggerBuildAndCopyTo("apps/client", "public/");

        // pdf.js
        this.triggerBuildAndCopyTo("packages/pdfjs-viewer", "pdfjs-viewer");
    }

    /** Builds another workspace package and copies its `dist` into this one. */
    triggerBuildAndCopyTo(projectToBuild: string, destPath: string) {
        const projectDir = join(this.rootDir, projectToBuild);
        execSync("pnpm build", { cwd: projectDir, stdio: "inherit" });
        cpSync(join(projectDir, "dist"), join(this.projectDir, "dist", destPath), { recursive: true });
    }

    copyNodeModules(nodeModules: string[]) {
        for (const moduleName of nodeModules) {
            const sourceDir = tryPath([
                join(this.projectDir, "node_modules", moduleName),
                join(this.rootDir, "node_modules", moduleName)
            ]);

            const destDir = join(this.outDir, "node_modules", moduleName);
            mkdirSync(destDir, { recursive: true });
            cpSync(sourceDir, destDir, { recursive: true, dereference: true });
        }
    }

    /**
     * Strips everything from the copied better-sqlite3 that a packaged artifact
     * never uses. Since v13 the package bundles a prebuilt binary for all eight
     * platforms it supports (~17 MB) plus the SQLite sources needed to compile
     * from scratch (~10 MB), but an artifact only ever loads one binary and never
     * compiles: 27 MB -> ~2.2 MB.
     *
     * @param opts.platform the platform being built *for*. Defaults to the host's,
     *   but pass it explicitly for cross-packaging.
     * @param opts.arch the architecture being built *for* -- not always the host's,
     *   as the macOS runners are arm64 and also package darwin-x64.
     * @param opts.includeMusl whether to keep the musl build alongside the glibc one
     *   on Linux (defaults to `true`). Only the server needs it; see below.
     */
    trimBetterSqlite3(opts: { platform?: string; arch?: string; includeMusl?: boolean } = {}) {
        const { platform = process.platform, arch = targetArch(), includeMusl = true } = opts;
        const moduleDir = join(this.outDir, "node_modules", "better-sqlite3");
        const prebuildDir = join(moduleDir, "prebuilds");

        // Every v13 install ships prebuilds/, so its absence means the module that
        // got copied is not the one the lockfile pins. The usual cause is a stale
        // pre-v13 tree in <app>/node_modules, which copyNodeModules prefers over the
        // hoisted root -- pnpm's `hoisted` linker never creates those, so anything
        // there is leftover residue. Fail here rather than shipping it: a pre-v13
        // module needs the `bindings` package that is no longer copied, so the
        // artifact would instead die at startup with a confusing resolution error.
        if (!existsSync(prebuildDir)) {
            const version = JSON.parse(readFileSync(join(moduleDir, "package.json"), "utf-8")).version;
            throw new Error(
                `better-sqlite3 ${version} in ${moduleDir} has no prebuilds/ directory. `
                + `Expected a v13+ layout -- delete any <app>/node_modules/better-sqlite3 and reinstall.`
            );
        }

        // Keep both libc variants on Linux by default. The server's dist is built
        // once on a glibc runner and then consumed by both the Debian and the Alpine
        // images, and better-sqlite3 resolves linuxmusl-* at runtime on the latter --
        // dropping it there would break the amd64 image at startup. Electron-based
        // artifacts have no such consumer (Electron ships no musl builds), so they
        // opt out and save the extra ~2.3 MB.
        const keep = new Set([ `${platform}-${arch}.node` ]);
        if (platform === "linux" && includeMusl) {
            keep.add(`linuxmusl-${arch}.node`);
        }

        const available = readdirSync(prebuildDir);
        if (!available.includes(`${platform}-${arch}.node`)) {
            throw new Error(
                `better-sqlite3 ships no prebuild for ${platform}-${arch} (found: ${available.join(", ")}). `
                + `Refusing to trim, since that would leave the artifact with no native addon.`
            );
        }

        for (const file of available) {
            if (!keep.has(file)) {
                rmSync(join(prebuildDir, file));
            }
        }

        // Compile-only: the SQLite amalgamation, the addon's own C++ sources, the
        // gyp manifest and node-gyp's scratch output. Nothing in lib/ reads them.
        for (const path of [ "deps", "src", "build", "binding.gyp" ]) {
            rmSync(join(moduleDir, path), { recursive: true, force: true });
        }
    }

    writeJson(relativePath: string, data: any) {
        const fullPath = join(this.outDir, relativePath);
        const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));
        if (dirPath) {
            mkdirSync(dirPath, { recursive: true });
        }
        writeFileSync(fullPath, JSON.stringify(data, null, 4), "utf-8");
    }

}

/**
 * The architecture currently being built for. The release workflows set these when
 * a job's target differs from the runner it happens to be executing on.
 */
/** The architecture being built for, which CI can set apart from the host's. */
export function targetArch() {
    return process.env.TARGET_ARCH || process.env.MATRIX_ARCH || process.arch;
}

function tryPath(paths: string[]) {
    for (const path of paths) {
        if (existsSync(path)) {
            return path;
        }
    }

    console.error("Unable to find any of the paths:", paths);
    process.exit(1);
}
