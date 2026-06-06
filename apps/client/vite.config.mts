/// <reference types='vitest' />
import { codecovVitePlugin } from '@codecov/vite-plugin';
import prefresh from '@prefresh/vite';
import { join } from 'path';
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
            "mathlive",
            // Pre-bundle so the first spreadsheet XLSX export (which dynamically imports
            // exceljs) doesn't trigger an on-demand re-optimization + dev-server reload
            // that aborts the export.
            "exceljs"
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
                index: join(__dirname, "index.html"),
                login: join(__dirname, "src", "login.ts"),
                set_password: join(__dirname, "src", "set_password.ts"),
                runtime: join(__dirname, "src", "runtime.ts"),
                print: join(__dirname, "src", "print.tsx")
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
            reporter: ["text", "html", "lcov"],
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
