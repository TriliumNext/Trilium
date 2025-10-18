/// <reference types='vitest' />
import { join, resolve } from 'path';
import { defineConfig, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy'
import webpackStatsPlugin from 'rollup-plugin-webpack-stats';
import preact from "@preact/preset-vite";

const assets = [ "assets", "stylesheets", "fonts", "translations" ];

const isDev = process.env.NODE_ENV === "development";
let plugins: any = [
    preact({
        babel: {
            compact: !isDev
        }
    })
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
                desktop: join(__dirname, "src", "desktop.ts"),
                mobile: join(__dirname, "src", "mobile.ts"),
                login: join(__dirname, "src", "login.ts"),
                setup: join(__dirname, "src", "setup.ts"),
                share: join(__dirname, "src", "share.ts"),
                set_password: join(__dirname, "src", "set_password.ts"),
                runtime: join(__dirname, "src", "runtime.ts"),
                print: join(__dirname, "src", "print.ts")
            },
            output: {
                entryFileNames: "src/[name].js",
                chunkFileNames: "src/[name].js",
                assetFileNames: "src/[name].[ext]",
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
