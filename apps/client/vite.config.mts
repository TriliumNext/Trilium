/// <reference types='vitest' />
import preact from "@preact/preset-vite";
import { join } from 'path';
import webpackStatsPlugin from 'rollup-plugin-webpack-stats';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy'

const assets = [ "assets", "stylesheets", "fonts", "translations" ];

const isDev = process.env.NODE_ENV === "development";

// Always copy SQLite WASM files so they're available to the module
const sqliteWasmPlugin = viteStaticCopy({
    targets: [
        {
            // Copy the entire jswasm directory to maintain the module's expected structure
            src: "../../node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/*",
            dest: "node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm"
        }
    ]
});

let plugins: any = [
    preact({
        babel: {
            compact: !isDev
        }
    }),
    sqliteWasmPlugin  // Always include SQLite WASM files
];

if (!isDev) {
    plugins = [
        ...plugins,
        viteStaticCopy({
            targets: assets.map((asset) => ({
                src: `src/${asset}/*`,
                dest: asset
            }))
        }),
        viteStaticCopy({
            structured: true,
            targets: [
                {
                    src: "../../node_modules/@excalidraw/excalidraw/dist/prod/fonts/*",
                    dest: "",
                }
            ]
        }),
        webpackStatsPlugin()
    ]
}

export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../node_modules/.vite/apps/client',
    base: "",
    plugins,
    optimizeDeps: {
        exclude: ['@sqlite.org/sqlite-wasm'],
        include: ['@triliumnext/core']
    },
    worker: {
        format: 'es'
    },
    resolve: {
        alias: [
            {
                find: "react",
                replacement: "preact/compat"
            },
            {
                find: "react-dom",
                replacement: "preact/compat"
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
    build: {
        target: "esnext",
        outDir: './dist',
        emptyOutDir: true,
        reportCompressedSize: true,
        sourcemap: false,
        rollupOptions: {
            input: {
                desktop: join(__dirname, "src", "desktop.html"),
                mobile: join(__dirname, "src", "mobile.ts"),
                login: join(__dirname, "src", "login.ts"),
                setup: join(__dirname, "src", "setup.ts"),
                set_password: join(__dirname, "src", "set_password.ts"),
                runtime: join(__dirname, "src", "runtime.ts"),
                print: join(__dirname, "src", "print.tsx")
            },
            output: {
                entryFileNames: "src/[name].js",
                chunkFileNames: "src/[name].js",
                assetFileNames: "src/[name].[ext]",
                manualChunks: {
                    "ckeditor5": [ "@triliumnext/ckeditor5" ],
                    "boxicons": [ "../../node_modules/boxicons/css/boxicons.min.css" ]
                },
            },
            onwarn(warning, rollupWarn) {
                if (warning.code === "MODULE_LEVEL_DIRECTIVE") {
                    return;
                }
                rollupWarn(warning);
            }
        }
    },
    test: {
        environment: "happy-dom",
        setupFiles: [
            "./src/test/setup.ts"
        ]
    },
    commonjsOptions: {
        transformMixedEsModules: true,
    },
    define: {
        "process.env.IS_PREACT": JSON.stringify("true"),
    }
}));
