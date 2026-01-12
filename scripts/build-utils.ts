import { execSync } from "child_process";
import { build as esbuild } from "esbuild";
import { cpSync, existsSync, rmSync, writeFileSync } from "fs";
import { copySync, emptyDirSync, mkdirpSync } from "fs-extra";
import { delimiter, join } from "path";

export default class BuildHelper {

    private rootDir: string;
    projectDir: string;
    outDir: string;

    constructor(projectPath: string) {
        this.rootDir = join(__dirname, "..");
        this.projectDir = join(this.rootDir, projectPath);
        this.outDir = join(this.projectDir, "dist");

        emptyDirSync(this.outDir);
    }

    copy(projectDirPath: string, outDirPath: string) {
        let sourcePath: string;
        if (projectDirPath.startsWith("/") || projectDirPath.startsWith("\\")) {
            sourcePath = join(this.rootDir, projectDirPath.substring(1));
        } else {
            sourcePath = join(this.projectDir, projectDirPath);
        }

        if (outDirPath.endsWith("/")) {
            mkdirpSync(join(outDirPath));
        }
        copySync(sourcePath, join(this.outDir, outDirPath), { dereference: true });
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
                "./xhr-sync-worker.js",
                "vite"
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
        copySync(join(projectDir, "dist"), join(this.projectDir, "dist", destPath));
    }

    copyNodeModules(nodeModules: string[]) {
        for (const moduleName of nodeModules) {
            const sourceDir = tryPath([
                join(this.projectDir, "node_modules", moduleName),
                join(this.rootDir, "node_modules", moduleName)
            ]);

            const destDir = join(this.outDir, "node_modules", moduleName);
            mkdirpSync(destDir);
            cpSync(sourceDir, destDir, { recursive: true, dereference: true });
        }
    }

    writeJson(relativePath: string, data: any) {
        const fullPath = join(this.outDir, relativePath);
        const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));
        if (dirPath) {
            mkdirpSync(dirPath);
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
