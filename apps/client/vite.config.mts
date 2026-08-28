/// <reference types='vitest' />
import { codecovVitePlugin } from '@codecov/vite-plugin';
import prefresh from '@prefresh/vite';
import { join } from 'path';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy'

import { stripUniverHyphenation } from './vite-plugins.mjs';

const assets = [ "assets", "stylesheets", "fonts", "translations" ];

const isDev = process.env.NODE_ENV === "development";
let plugins: any = [];

if (isDev) {
    // Add Prefresh for Preact HMR in development
    plugins = [
        prefresh(),
        stripUniverHyphenation()
    ];
} else {
    plugins = [
        stripUniverHyphenation(),
        viteStaticCopy({
            targets: assets.map((asset) => ({
                src: `src/${asset}/**/*`,
                dest: asset,
                rename: { stripBase: 2 }
            }))
        }),
        viteStaticCopy({
            targets: [
                {
                    src: "../../node_modules/@excalidraw/excalidraw/dist/prod/fonts/**/*",
                    dest: "",
                }
            ]
        }),
        // Put the Codecov vite plugin after all other plugins
        codecovVitePlugin({
            enableBundleAnalysis: process.env.CODECOV_TOKEN !== undefined,
            bundleName: "client",
            uploadToken: process.env.CODECOV_TOKEN
        })
    ]
}

export default defineConfig(() => ({
    root: import.meta.dirname,
    cacheDir: '../../.cache/vite',
    base: "",
    plugins,
    // Use oxc for JSX transformation (Vite 8+ replaced the deprecated `esbuild` option with `oxc`)
    oxc: {
        jsx: {
            runtime: 'automatic',
            importSource: 'preact',
            development: isDev
        }
    },
    css: {
        transformer: 'lightningcss',
        devSourcemap: isDev
    },
    server: {
        watch: {
            ignored: ["**/test-output/**"]
        }
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
                index: join(import.meta.dirname, "index.html"),
                runtime: join(import.meta.dirname, "src", "runtime.ts"),
                print: join(import.meta.dirname, "src", "print.tsx")
            },
            output: {
                entryFileNames: (chunk) => {
                    // We enforce a hash in the main index file to avoid caching issues, this only works because we have the HTML entry point.
                    if (chunk.name === "index" || chunk.name === "print") {
                        return "src/[name]-[hash].js";
                    }

                    // For EJS-rendered pages (e.g. login) we need to have a stable name.
                    return "src/[name].js";
                },
                chunkFileNames: "src/[name]-[hash].js",
                assetFileNames: "src/[name]-[hash].[ext]"
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
        // Vitest skips CSS processing by default, which would hand `?inline` importers an empty
        // string. The presentation themes are SCSS compiled through that path, so their specs need
        // it on to assert against real rules.
        css: { include: [/\.scss(\?|$)/] },
        setupFiles: [
            "./src/test/setup.ts"
        ],
        reporters: [
            "verbose",
            ["html", { outputFile: "./test-output/vitest/html/index.html" }],
            ["junit", { outputFile: "./test-output/vitest/junit.xml", addFileAttribute: true }]
        ],
        coverage: {
            reportsDirectory: "./test-output/vitest/coverage",
            provider: "v8" as const,
            // Codecov resolves an lcov `SF:` path by matching it against the repo's file list.
            // Vitest defaults the lcov reporter's `projectRoot` to the Vite `root`, which would
            // emit app-relative paths (`src/…`); the shallow ones are ambiguous in this monorepo
            // and get attributed to whichever project wins the match. Anchor to the repo root so
            // every path is unambiguous.
            reporter: ["text", "html", ["lcov", { projectRoot: join(import.meta.dirname, "../..") }]],
            include: ["src/**/*.{ts,tsx}"],
            exclude: ["**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}", "**/*.d.ts"]
        },
    },
    commonjsOptions: {
        transformMixedEsModules: true,
    },
    define: {
        "process.env.IS_PREACT": JSON.stringify("true"),
    }
}));
