import fs from "fs";
import { join, resolve, sep } from "path";

import prefresh from "@prefresh/vite";
import { defineConfig, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const clientAssets = ["assets", "stylesheets", "fonts", "translations"];

const isDev = process.env.NODE_ENV === "development";

// Watch client files and trigger reload in development
const clientWatchPlugin = () => ({
    name: "client-watch",
    configureServer(server: any) {
        if (isDev) {
            // Watch client source files (adjusted for new root)
            server.watcher.add("../../client/src/**/*");
            server.watcher.on("change", (file: string) => {
                if (file.includes("../../client/src/")) {
                    server.ws.send({
                        type: "full-reload"
                    });
                }
            });
        }
    }
});

// Serve PDF.js files directly in dev mode to bypass SPA fallback
const pdfjsServePlugin = (): Plugin => ({
    name: "pdfjs-serve",
    configureServer(server) {
        const pdfjsRoot = join(__dirname, "../../packages/pdfjs-viewer/dist");

        server.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith("/pdfjs/")) {
                return next();
            }

            // Map /pdfjs/web/... to dist/web/...
            // Map /pdfjs/build/... to dist/build/...
            // Strip query string (e.g., ?v=0.102.2) before resolving path
            const urlWithoutQuery = req.url.split("?")[0];
            const relativePath = urlWithoutQuery.replace(/^\/pdfjs\//, "");
            const filePath = join(pdfjsRoot, relativePath);

            // Security: resolve both paths to prevent prefix-collision attacks
            // (e.g. pdfjsRoot="/foo/bar" matching "/foo/bar2/evil.js")
            const resolvedRoot = resolve(pdfjsRoot);
            const resolvedFilePath = resolve(filePath);
            if (!resolvedFilePath.startsWith(resolvedRoot + sep)) {
                return next();
            }

            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                const ext = filePath.split(".").pop() || "";
                const mimeTypes: Record<string, string> = {
                    html: "text/html",
                    css: "text/css",
                    js: "application/javascript",
                    mjs: "application/javascript",
                    wasm: "application/wasm",
                    png: "image/png",
                    svg: "image/svg+xml",
                    json: "application/json"
                };
                res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
                res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
                fs.createReadStream(filePath).pipe(res);
            } else {
                next();
            }
        });
    }
});

// Remove the hashed sqlite3.wasm duplicate from the bundle.
// Vite detects `new URL("sqlite3.wasm", import.meta.url)` in the sqlite-wasm library and
// emits a hashed copy (e.g. sqlite3-B5ovX4lD.wasm). Since the service worker needs the
// unhashed filename anyway (provided by viteStaticCopy), we drop the hashed duplicate.
const sqliteWasmDedupePlugin = (): Plugin => ({
    name: "sqlite-wasm-dedupe",
    generateBundle(_options, bundle) {
        for (const fileName of Object.keys(bundle)) {
            const asset = bundle[fileName];
            if (asset.type === "asset" && /sqlite3-\w+\.wasm$/.test(fileName)) {
                delete bundle[fileName];
            }
        }
    }
});

// Copy SQLite WASM files so they're available to the service worker at runtime.
// The .wasm file must be copied with its original name because the sqlite-wasm library
// resolves it by convention inside the worker (where Vite's hashed import.meta.url won't work).
const sqliteWasmPlugin = viteStaticCopy({
    targets: [
        {
            src: "../../../node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3.wasm",
            dest: "assets",
            rename: { stripBase: true }
        },
        {
            src: "../../../node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3-opfs-async-proxy.js",
            dest: "assets",
            rename: { stripBase: true }
        }
    ]
});

let plugins: any = [
    sqliteWasmDedupePlugin(),
    sqliteWasmPlugin,
    viteStaticCopy({
        targets: clientAssets.map((asset) => ({
            src: `../../client/src/${asset}/**/*`,
            dest: asset,
            rename: { stripBase: 3 }
        })),
        // Enable watching in development
        ...(isDev && {
            watch: {
                reloadPageOnChange: true
            }
        })
    }),
    viteStaticCopy({
        targets: [
            {
                src: [
                    "../../server/src/assets/**/*",
                    // Exclude the User Guide (~20 MB) since it's not needed in standalone mode.
                    "!../../server/src/assets/doc_notes/en/User Guide/**"
                ],
                dest: "server-assets",
                rename: { stripBase: 3 }
            }
        ]
    }),
    // PDF.js viewer for PDF preview support
    // stripBase: 4 removes packages/pdfjs-viewer/dist/web (or /build)
    viteStaticCopy({
        targets: [
            {
                src: "../../../packages/pdfjs-viewer/dist/web/**/*",
                dest: "pdfjs/web",
                rename: { stripBase: 4 }
            },
            {
                src: "../../../packages/pdfjs-viewer/dist/build/**/*",
                dest: "pdfjs/build",
                rename: { stripBase: 4 }
            }
        ]
    }),
    // Watch client files for changes in development
    ...(isDev ? [
        prefresh(),
        clientWatchPlugin(),
        pdfjsServePlugin()
    ] : [])
];

if (!isDev) {
    plugins = [
        ...plugins,
        viteStaticCopy({
            targets: [
                {
                    src: "../../../node_modules/@excalidraw/excalidraw/dist/prod/fonts/**/*",
                    dest: "",
                }
            ]
        })
    ]
}

// Include the integration test fixture database for e2e tests
if (process.env.TRILIUM_INTEGRATION_TEST) {
    plugins = [
        ...plugins,
        viteStaticCopy({
            targets: [
                {
                    // Forward slashes are required because fast-glob (used
                    // internally) treats backslashes as escape characters on
                    // Windows. `stripBase` drops the source's directory
                    // structure so the file lands flat at `test-fixtures/document.db`
                    // rather than mirroring the `packages/trilium-core/...` path.
                    src: join(__dirname, "../../packages/trilium-core/src/test/fixtures/document.db").replace(/\\/g, "/"),
                    dest: "test-fixtures",
                    rename: { stripBase: true }
                }
            ]
        })
    ]
}

export default defineConfig(() => ({
    root: join(__dirname, 'src'),  // Set src as root so index.html is served from /
    envDir: __dirname,  // Load .env files from standalone directory, not src/
    cacheDir: '../../../node_modules/.vite/apps/standalone',
    base: "",
    plugins,
    esbuild: {
        jsx: 'automatic',
        jsxImportSource: 'preact',
        jsxDev: isDev
    },
    css: {
        transformer: 'lightningcss',
        devSourcemap: isDev
    },
    publicDir: join(__dirname, 'public'),
    resolve: {
        alias: [
            {
                find: "react",
                replacement: "preact/compat"
            },
            {
                find: "react-dom",
                replacement: "preact/compat"
            },
            {
                find: "@client",
                replacement: join(__dirname, "../client/src")
            }
        ],
        dedupe: [
            "react",
            "react-dom",
            "preact",
            "preact/compat",
            "preact/hooks"
        ]
    },
    server: {
        watch: {
            // Watch workspace packages
            ignored: ['!**/node_modules/@triliumnext/**'],
            // Also watch client assets for live reload
            usePolling: false,
            interval: 100,
            binaryInterval: 300
        },
        // Watch additional directories for changes
        fs: {
            allow: [
                // Allow access to workspace root
                '../../../',
                // Explicitly allow client directory
                '../../client/src/'
            ]
        },
        headers: {
            // COOP is kept for security (prevents window.opener attacks).
            // COEP is intentionally omitted: SAHPool (our primary SQLite VFS) does not
            // require SharedArrayBuffer/COEP, and omitting it allows cross-origin iframes
            // (e.g. in-app help pointing to docs.triliumnotes.org).
            "Cross-Origin-Opener-Policy": "same-origin"
        }
    },
    preview: {
        headers: {
            "Cross-Origin-Opener-Policy": "same-origin"
        }
    },
    optimizeDeps: {
        exclude: ['@sqlite.org/sqlite-wasm', '@triliumnext/core']
    },
    worker: {
        format: "es" as const
    },
    commonjsOptions: {
        transformMixedEsModules: true,
    },
    build: {
        target: "esnext",
        outDir: join(__dirname, 'dist'),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: join(__dirname, 'src', 'index.html'),
                sw: join(__dirname, 'src', 'sw.ts'),
                'local-bridge': join(__dirname, 'src', 'local-bridge.ts'),
            },
            output: {
                entryFileNames: (chunkInfo) => {
                    // Service worker and other workers should be at root level
                    if (chunkInfo.name === 'sw') {
                        return '[name].js';
                    }
                    return 'src/[name].js';
                },
                chunkFileNames: "src/[name].js",
                assetFileNames: "src/[name].[ext]"
            }
        }
    },
    test: {
        environment: "happy-dom",
        setupFiles: [join(__dirname, "src/test_setup.ts")],
        dir: join(__dirname),
        include: [
            "src/**/*.{test,spec}.{ts,tsx}",
            "../../packages/trilium-core/src/**/*.{test,spec}.{ts,tsx}"
        ],
        server: {
            deps: {
                inline: ["@sqlite.org/sqlite-wasm"]
            }
        },
        alias: {
            // The package's `node.mjs` entry references a non-existent
            // `sqlite3-node.mjs`. Force the browser-style entry which works
            // under Node + happy-dom too.
            "@sqlite.org/sqlite-wasm": join(
                __dirname,
                "../../node_modules/@sqlite.org/sqlite-wasm/index.mjs"
            )
        }
    },
    define: {
        "process.env.IS_PREACT": JSON.stringify("true"),
        __TRILIUM_INTEGRATION_TEST__: JSON.stringify(process.env.TRILIUM_INTEGRATION_TEST ?? ""),
    }
}));