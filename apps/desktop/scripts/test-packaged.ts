/**
 * Tests the electron-forge package of the desktop app from outside the repository, where Node's
 * module resolution can no longer walk up into the workspace's `node_modules` and hide a package
 * the build forgot to ship.
 *
 * 1. Moves `dist/out/<product>-<platform>-<arch>` into the OS temp directory.
 * 2. Checks that every worker entry and every package a bundle leaves external is inside
 *    `app.asar`, together with the dependencies it needs, read from the per-entry metafiles under
 *    `meta/` in the archive.
 * 3. Launches the executable there, with throwaway data directories and an environment stripped
 *    of anything pointing into the repository, and waits for its HTTP server to answer.
 *    `--smoke` then quits it; otherwise the app stays open for manual testing.
 *
 * On NixOS the stock Electron binary runs through nix-ld, which this script points at the shared
 * libraries Electron links against, built from the nixpkgs revision in `flake.lock`.
 *
 * `electron-forge:test-packaged` packages first and then runs this script.
 */

import { spawn, spawnSync } from "child_process";
import {
    closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync,
    renameSync, rmSync
} from "fs";
import { builtinModules } from "module";
import { tmpdir } from "os";
import { delimiter, isAbsolute, join, relative } from "path";

import { PRODUCT_NAME } from "../src/app-info.js";

const DESKTOP_DIR = join(__dirname, "..");
const REPO_DIR = join(DESKTOP_DIR, "../..");
const TEST_DIR = join(tmpdir(), "trilium-packaged-test");
/** Matches `executableName` in `electron-forge/forge.config.ts`. */
const EXECUTABLE_NAME = "trilium";
const PORT = 37850;
const STARTUP_TIMEOUT_MS = 120_000;
/** The nixpkgs attributes holding the shared libraries Electron links against. */
const NIXOS_ELECTRON_LIBRARIES = [
    "alsa-lib", "at-spi2-atk", "at-spi2-core", "cairo", "cups", "dbus", "expat", "glib", "gtk3",
    "libdrm", "libGL", "libgbm", "libxkbcommon", "mesa", "nspr", "nss", "pango", "systemd",
    "xorg.libX11", "xorg.libXcomposite", "xorg.libXdamage", "xorg.libXext", "xorg.libXfixes",
    "xorg.libXrandr", "xorg.libxcb", "xorg.libxshmfence"
];

/** Workspace packages that a packaged app never loads, so they are not shipped. */
const NOT_SHIPPED: Record<string, string> = {
    "@agentclientprotocol/codex-acp": "copied to assets/codex-acp.mjs; resolved only from source",
    "@triliumnext/core": "test fixtures and schema.sql, reached only in tests or from source",
    "node-addon-api": "C++ headers for compiling better-sqlite3; the shipped prebuild needs none",
    "node-fetch": "tesseract.js requires it only when global fetch is missing",
    "pdfjs-dist": "officeparser loads it for PDFs, which go through unpdf instead"
};

/**
 * Bundled worker entries the app starts by path; without one, its pool silently falls back to the
 * main process.
 */
const WORKER_ENTRIES = [ "image_worker.cjs", "content_job_worker.cjs", "search_replica_worker.cjs" ];

async function main() {
    const smoke = process.argv.includes("--smoke");
    const appDir = moveOutOfRepo();
    console.log(`Testing the package at ${appDir}`);

    const asar = new Asar(join(getResourcesDir(appDir), "app.asar"));
    const missingWorkers = WORKER_ENTRIES.filter((entry) => !asar.has(entry));
    if (missingWorkers.length) {
        console.error(`\nWorker entries missing from app.asar: ${missingWorkers.join(", ")}\n`);
        process.exitCode = 1;
    } else {
        console.log("Every worker entry ships inside app.asar.");
    }

    const missing = findMissingPackages(asar);
    if (missing.length) {
        console.error("\nPackages the app loads but the package does not contain:");
        for (const { name, reason } of missing) {
            console.error(`  ${name} (${reason})`);
        }
        console.error("");
        process.exitCode = 1;
    } else {
        console.log("Every external package ships inside app.asar.");
    }

    await launch(appDir, smoke);
}

function moveOutOfRepo() {
    const packageName = `${PRODUCT_NAME}-${process.platform}-${process.arch}`;
    // forge resolves its `outDir` against the packaged directory, `dist`.
    const source = join(DESKTOP_DIR, "dist", "out", packageName);
    if (!existsSync(source)) {
        throw new Error(`No package at ${source}. Run `
            + `"pnpm --filter @triliumnext/desktop electron-forge:package" first.`);
    }
    if (isInside(REPO_DIR, TEST_DIR)) {
        throw new Error(`The temp directory ${TEST_DIR} is inside the repository.`);
    }

    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    const destination = join(TEST_DIR, packageName);
    try {
        renameSync(source, destination);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EXDEV") {
            throw e;
        }
        cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
        rmSync(source, { recursive: true, force: true });
    }
    return destination;
}

function getResourcesDir(appDir: string) {
    return process.platform === "darwin"
        ? join(appDir, `${PRODUCT_NAME}.app`, "Contents", "Resources")
        : join(appDir, "resources");
}

function getExecutablePath(appDir: string) {
    switch (process.platform) {
        case "darwin":
            return join(appDir, `${PRODUCT_NAME}.app`, "Contents", "MacOS", PRODUCT_NAME);
        case "win32": return join(appDir, `${EXECUTABLE_NAME}.exe`);
        default: return join(appDir, EXECUTABLE_NAME);
    }
}

/**
 * Lists the packages imported by the bundles, or required by a shipped package, that the archive
 * does not contain but the workspace does. A package the workspace lacks as well fails the same
 * way in development, which makes it an optional import (`ws` probing for `bufferutil`), not a
 * hidden dependency. The same test selects the optional dependencies that apply to this machine,
 * since pnpm installs only the platform-specific binary packages matching it.
 */
function findMissingPackages(asar: Asar) {
    const missing: { name: string; reason: string }[] = [];
    const visited = new Set<string>();

    const visit = (name: string, fromDir: string, reason: string) => {
        if (name in NOT_SHIPPED || !isInstalledInWorkspace(name)) {
            return;
        }
        const dir = [ `${fromDir}/node_modules/${name}`, `node_modules/${name}` ]
            .find((d) => asar.has(`${d}/package.json`));
        if (!dir) {
            missing.push({ name, reason });
            return;
        }
        if (visited.has(dir)) {
            return;
        }
        visited.add(dir);

        const pkg = JSON.parse(asar.read(`${dir}/package.json`));
        for (const dep of Object.keys(pkg.dependencies ?? {})) {
            visit(dep, dir, `dependency of ${name}`);
        }
        for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
            visit(dep, dir, `optional dependency of ${name}, installed for this platform`);
        }
    };

    for (const [ name, importers ] of getExternalPackages(asar)) {
        visit(name, "", `imported by ${[ ...importers ].join(", ")}`);
    }
    return missing;
}

/** Maps each external package in the bundles' metafiles to the output files importing it. */
function getExternalPackages(asar: Asar) {
    const metaFiles = asar.list("meta").filter((f) => f.endsWith(".json"));
    if (!metaFiles.length) {
        throw new Error("The package has no meta/*.json metafiles; package it again.");
    }

    const packages = new Map<string, Set<string>>();
    for (const metaFile of metaFiles) {
        const { outputs } = JSON.parse(asar.read(`meta/${metaFile}`)) as {
            outputs: Record<string, { imports: { path: string; external?: boolean }[] }>;
        };
        for (const [ outputPath, output ] of Object.entries(outputs)) {
            for (const { path, external } of output.imports) {
                const name = external && getPackageName(path);
                if (name) {
                    const importers = packages.get(name) ?? new Set<string>();
                    importers.add(outputPath.replace(/^dist\//, ""));
                    packages.set(name, importers);
                }
            }
        }
    }
    return packages;
}

/** Returns the package an import specifier names, or `null` for a relative path or a built-in. */
function getPackageName(specifier: string) {
    if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) {
        return null;
    }
    const segments = specifier.split("/");
    const name = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
    const isBuiltin = builtinModules.includes(name) || builtinModules.includes(specifier);
    if (name === "electron" || isBuiltin) {
        return null;
    }
    return name;
}

function isInstalledInWorkspace(name: string) {
    return [ REPO_DIR, DESKTOP_DIR ].some((dir) => existsSync(join(dir, "node_modules", name)));
}

async function launch(appDir: string, smoke: boolean) {
    const url = `http://localhost:${PORT}/`;
    if (await responds(url)) {
        throw new Error(`Something already answers on ${url}; close it first.`);
    }

    const dataDir = join(TEST_DIR, "data");
    const cleanEnv = getCleanEnv();
    const env = {
        ...cleanEnv,
        ...getNixOsEnv(cleanEnv),
        TRILIUM_DATA_DIR: dataDir,
        TRILIUM_ELECTRON_DATA_DIR: join(TEST_DIR, "data-electron"),
        TRILIUM_PORT: String(PORT)
    };
    const startedAt = Date.now();
    const child = spawn(getExecutablePath(appDir), [], { cwd: TEST_DIR, env, stdio: "inherit" });
    let exitCode: number | null | undefined;
    const exited = new Promise<void>((resolve) => child.on("exit", (code) => {
        exitCode = code;
        resolve();
    }));

    while (exitCode === undefined && !(await responds(url))) {
        if (Date.now() - startedAt > STARTUP_TIMEOUT_MS) {
            console.error(`No answer on ${url} within ${STARTUP_TIMEOUT_MS / 1000} s.`);
            printLogTail(dataDir);
            killTree(child.pid);
            process.exit(1);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (exitCode !== undefined) {
        console.error(`The app exited with code ${exitCode} before its server answered.`);
        printLogTail(dataDir);
        process.exit(1);
    }

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`The server answered on ${url} after ${seconds} s.`);
    if (smoke) {
        killTree(child.pid);
    } else {
        console.log(`Data directory: ${dataDir}\nClose the app to finish.`);
    }
    await exited;
}

/**
 * Copies the environment without package-manager, Node, Electron and Trilium variables, or any
 * value pointing into the repository.
 */
function getCleanEnv() {
    const env: Record<string, string> = {};
    for (const [ key, value ] of Object.entries(process.env)) {
        if (value === undefined || /^(npm_|pnpm_|node_|electron_|trilium_)|^INIT_CWD$/i.test(key)) {
            continue;
        }
        if (key.toUpperCase() === "PATH") {
            const entries = value.split(delimiter).filter((entry) => !isInside(REPO_DIR, entry));
            env[key] = entries.join(delimiter);
        } else if (!value.toLowerCase().includes(REPO_DIR.toLowerCase())) {
            env[key] = value;
        }
    }
    return env;
}

/**
 * On NixOS, returns a `NIX_LD_LIBRARY_PATH` that adds Electron's shared libraries to those of
 * `programs.nix-ld.libraries`. Elsewhere, returns no variables.
 */
function getNixOsEnv(env: Record<string, string>): Record<string, string> {
    if (process.platform !== "linux" || !existsSync("/etc/NIXOS")) {
        return {};
    }
    if (!env.NIX_LD) {
        throw new Error("NixOS runs the packaged app only through nix-ld; "
            + "enable it with `programs.nix-ld.enable = true;`.");
    }

    const lock = JSON.parse(readFileSync(join(REPO_DIR, "flake.lock"), "utf-8"));
    const { owner, repo, rev, narHash } = lock.nodes[lock.nodes.root.inputs.nixpkgs].locked;
    const nixpkgs = `github:${owner}/${repo}/${rev}?narHash=${encodeURIComponent(narHash)}`;
    const expression = `
        let pkgs = (builtins.getFlake "${nixpkgs}").legacyPackages.\${builtins.currentSystem};
        in pkgs.symlinkJoin {
            name = "trilium-electron-libs";
            paths = map pkgs.lib.getLib (with pkgs; [ ${NIXOS_ELECTRON_LIBRARIES.join(" ")} ]);
        }`;
    console.log("Building Electron's shared libraries for nix-ld.");
    const build = spawnSync(
        "nix", [ "build", "--impure", "--no-link", "--print-out-paths", "--expr", expression ],
        { encoding: "utf-8", stdio: [ "ignore", "pipe", "inherit" ] }
    );
    if (build.status !== 0) {
        const reason = build.error ?? `exit code ${build.status}`;
        throw new Error(`Building Electron's shared libraries failed (${reason}).`);
    }

    const libDir = join(build.stdout.trim(), "lib");
    return {
        NIX_LD_LIBRARY_PATH: [ libDir, env.NIX_LD_LIBRARY_PATH ].filter(Boolean).join(delimiter)
    };
}

async function responds(url: string) {
    try {
        await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2000) });
        return true;
    } catch {
        return false;
    }
}

function printLogTail(dataDir: string) {
    const logDir = join(dataDir, "log");
    const logFile = existsSync(logDir) ? readdirSync(logDir).sort().at(-1) : undefined;
    if (!logFile) {
        console.error(`No log file under ${logDir}.`);
        return;
    }
    const lines = readFileSync(join(logDir, logFile), "utf-8").trimEnd().split("\n");
    console.error(`\nLast lines of ${join(logDir, logFile)}:\n${lines.slice(-40).join("\n")}`);
}

function killTree(pid: number | undefined) {
    if (pid === undefined) {
        return;
    }
    if (process.platform === "win32") {
        spawnSync("taskkill", [ "/pid", String(pid), "/T", "/F" ], { stdio: "ignore" });
    } else {
        process.kill(pid);
    }
}

function isInside(parent: string, child: string) {
    const rel = relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Reads an asar archive: a pickled JSON header listing every file, followed by the packed file
 * contents. Files marked `unpacked` live in `app.asar.unpacked` beside it.
 */
class Asar {
    private readonly header: AsarDirectory;
    private readonly dataOffset: number;

    constructor(private readonly path: string) {
        const fd = openSync(path, "r");
        try {
            const prefix = Buffer.alloc(16);
            readSync(fd, prefix, 0, 16, 0);
            const headerPickleSize = prefix.readUInt32LE(4);
            const headerLength = prefix.readUInt32LE(12);
            const header = Buffer.alloc(headerLength);
            readSync(fd, header, 0, headerLength, 16);
            this.header = JSON.parse(header.toString("utf-8"));
            this.dataOffset = 8 + headerPickleSize;
        } finally {
            closeSync(fd);
        }
    }

    has(path: string) {
        return this.find(path) !== undefined;
    }

    list(path: string) {
        const entry = this.find(path);
        return entry && "files" in entry ? Object.keys(entry.files) : [];
    }

    read(path: string) {
        const entry = this.find(path);
        if (!entry || "files" in entry) {
            throw new Error(`${path} is not a file in ${this.path}`);
        }
        if (entry.unpacked) {
            return readFileSync(join(`${this.path}.unpacked`, path), "utf-8");
        }
        const buffer = Buffer.alloc(entry.size);
        const fd = openSync(this.path, "r");
        try {
            readSync(fd, buffer, 0, entry.size, this.dataOffset + Number(entry.offset));
        } finally {
            closeSync(fd);
        }
        return buffer.toString("utf-8");
    }

    private find(path: string) {
        let entry: AsarEntry | undefined = this.header;
        for (const segment of path.split("/").filter(Boolean)) {
            entry = entry && "files" in entry ? entry.files[segment] : undefined;
        }
        return entry;
    }
}

type AsarDirectory = { files: Record<string, AsarEntry> };
type AsarEntry = AsarDirectory | { size: number; offset: string; unpacked?: boolean };

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
