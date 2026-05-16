import { execSync } from "child_process";
import { build as esbuild } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { delimiter, join } from "path";

export default class BuildHelper {

    private rootDir: string;
    projectDir: string;
    outDir: string;

    constructor(projectPath: string) {
        this.rootDir = join(__dirname, "..");
        this.projectDir = join(this.rootDir, projectPath);
        this.outDir = join(this.projectDir, "dist");

        rmSync(this.outDir, { recursive: true, force: true });
        mkdirSync(this.outDir, { recursive: true });
    }

    copy(projectDirPath: string, outDirPath: string) {
        let sourcePath: string;
        if (projectDirPath.startsWith("/") || projectDirPath.startsWith("\\")) {
            sourcePath = join(this.rootDir, projectDirPath.substring(1));
        } else {
            sourcePath = join(this.projectDir, projectDirPath);
        }

        if (outDirPath.endsWith("/")) {
            mkdirSync(join(this.outDir, outDirPath), { recursive: true });
        }
        cpSync(sourcePath, join(this.outDir, outDirPath), { recursive: true, dereference: true });
    }

    deleteFromOutput(path: string) {
        rmSync(join(this.outDir, path), { recursive: true });
    }

    async buildBackend(entryPoints: string[]) {
        const result = await esbuild({
            entryPoints: entryPoints.map(e => join(this.projectDir, e)),
            tsconfig: join(this.projectDir, "tsconfig.app.json"),
            platform: "node",
            bundle: true,
            outdir: this.outDir,
            outExtension: {
                ".js": ".cjs"
            },
            format: "cjs",
            external: [
                "electron",
                "@electron/remote",
                "better-sqlite3",
                "pdfjs-dist",
                "./xhr-sync-worker.js",
                "vite",
                "tesseract.js",
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
                "@triliumnext/core/src/assets/*"
            ],
            metafile: true,
            splitting: false,
            loader: {
                ".css": "text",
                ".ejs": "text"
            },
            define: {
                "process.env.NODE_ENV": JSON.stringify("production"),
            },
            minify: true
        });
        writeFileSync(join(this.outDir, "meta.json"), JSON.stringify(result.metafile));

        // Tesseract.js is marked as external above because its worker runs in
        // a separate worker_thread. Copy the worker source, WASM core and all
        // transitive runtime deps so they are available in dist/node_modules.
        this.copyNodeModules([
            "tesseract.js", "tesseract.js-core", "wasm-feature-detect",
            "regenerator-runtime", "is-url", "bmp-js"
        ]);
    }

    buildFrontend() {
        this.triggerBuildAndCopyTo("apps/client", "public/");
        this.deleteFromOutput("public/webpack-stats.json");

        // pdf.js
        this.triggerBuildAndCopyTo("packages/pdfjs-viewer", "pdfjs-viewer");
    }

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

    writeJson(relativePath: string, data: any) {
        const fullPath = join(this.outDir, relativePath);
        const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));
        if (dirPath) {
            mkdirSync(dirPath, { recursive: true });
        }
        writeFileSync(fullPath, JSON.stringify(data, null, 4), "utf-8");
    }

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
