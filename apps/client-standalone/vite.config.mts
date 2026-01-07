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
        }
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
    }
}));