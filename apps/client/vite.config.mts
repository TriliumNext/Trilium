/// <reference types='vitest' />
import prefresh from '@prefresh/vite';
import { join } from 'path';
import webpackStatsPlugin from 'rollup-plugin-webpack-stats';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy'

const assets = [ "assets", "stylesheets", "fonts", "translations" ];

const isDev = process.env.NODE_ENV === "development";
let plugins: any = [];

if (isDev) {
    // Add Prefresh for Preact HMR in development
    plugins = [
        prefresh()
    ];
} else {
    plugins = [
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
    cacheDir: '../../.cache/vite',
    base: "",
    plugins,
    // Use esbuild for JSX transformation (much faster than Babel)
    esbuild: {
        jsx: 'automatic',
        jsxImportSource: 'preact',
        jsxDev: isDev
    },
    css: {
        transformer: 'lightningcss',
        devSourcemap: isDev
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
    optimizeDeps: {
        include: [
            "ckeditor5-premium-features",
            "ckeditor5",
            "mathlive"
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
                index: join(__dirname, "src", "index.html"),
                login: join(__dirname, "src", "login.ts"),
                setup: join(__dirname, "src", "setup.ts"),
                set_password: join(__dirname, "src", "set_password.ts"),
                runtime: join(__dirname, "src", "runtime.ts"),
                print: join(__dirname, "src", "print.tsx")
            },
            output: {
                entryFileNames: (chunk) => {
                    // We enforce a hash in the main index file to avoid caching issues, this only works because we have the HTML entry point.
                    if (chunk.name === "index") {
                        return "src/[name]-[hash].js";
                    }

                    // For EJS-rendered pages (e.g. login) we need to have a stable name.
                    return "src/[name].js";
                },
                chunkFileNames: "src/[name]-[hash].js",
                assetFileNames: "src/[name]-[hash].[ext]",
                manualChunks: {
                    "ckeditor5": [ "@triliumnext/ckeditor5" ]
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
