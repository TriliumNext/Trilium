import preact from "@preact/preset-vite";
import { defineConfig } from 'vite';
import { join } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const assets = ["assets", "stylesheets", "fonts", "translations"];

const isDev = process.env.NODE_ENV === "development";

// Watch client files and trigger reload in development
const clientWatchPlugin = () => ({
    name: 'client-watch',
    configureServer(server: any) {
        if (isDev) {
            // Watch client source files (adjusted for new root)
            server.watcher.add('../../client/src/**/*');
            server.watcher.on('change', (file: string) => {
                if (file.includes('../../client/src/')) {
                    server.ws.send({
                        type: 'full-reload'
                    });
                }
            });
        }
    }
});

// Always copy SQLite WASM files so they're available to the module
const sqliteWasmPlugin = viteStaticCopy({
    targets: [
        {
            // Copy the entire jswasm directory to maintain the module's expected structure
            src: "../../../node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3.wasm",
            dest: "assets"
        }
    ]
});

let plugins: any = [
    preact({
        babel: {
            compact: !isDev
        }
    }),
    sqliteWasmPlugin,  // Always include SQLite WASM files
    viteStaticCopy({
        targets: assets.map((asset) => ({
            src: `../../client/src/${asset}/*`,
            dest: asset
        })),
        // Enable watching in development
        ...(isDev && {
            watch: {
                reloadPageOnChange: true
            }
        })
    }),
    // Watch client files for changes in development
    ...(isDev ? [clientWatchPlugin()] : [])
];

if (!isDev) {
    plugins = [
        ...plugins,
        viteStaticCopy({
            structured: true,
            targets: [
                {
                    src: "../../../node_modules/@excalidraw/excalidraw/dist/prod/fonts/*",
                    dest: "",
                }
            ]
        })
    ]
}

export default defineConfig(() => ({
    root: join(__dirname, 'src'),  // Set src as root so index.html is served from /
    cacheDir: '../../../node_modules/.vite/apps/client-standalone',
    base: "",
    plugins,
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
            // Required for SharedArrayBuffer which is needed by SQLite WASM OPFS VFS
            // See: https://sqlite.org/wasm/doc/trunk/persistence.md#coop-coep
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp"
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
                'local-server-worker': join(__dirname, 'src', 'local-server-worker.ts')
            },
            output: {
                entryFileNames: (chunkInfo) => {
                    // Service worker and other workers should be at root level
                    if (chunkInfo.name === 'sw' || chunkInfo.name === 'local-server-worker') {
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
        environment: "happy-dom"
    },
    define: {
        "process.env.IS_PREACT": JSON.stringify("true"),
    }
}));