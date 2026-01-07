import { defineConfig } from 'vite';
import { join } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const assets = ["assets", "stylesheets", "fonts", "translations"];

export default defineConfig(() => ({
    root: __dirname,
    base: "",
    plugins: [
        viteStaticCopy({
            targets: assets.map((asset) => ({
                src: `../${asset}/*`,
                dest: asset
            }))
        })
    ],
    server: {
        watch: {
            ignored: ['!**/node_modules/@triliumnext/**']
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
    commonjsOptions: {
        transformMixedEsModules: true,
    },
    build: {
        target: "esnext",
        outDir: join(__dirname, 'dist'),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: join(__dirname, 'src', 'index.html')
            }
        }
    },
    define: {
        "process.env.IS_PREACT": JSON.stringify("true"),
    }
}));