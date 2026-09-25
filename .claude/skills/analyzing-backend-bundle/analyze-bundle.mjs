// Bundle analysis for the backend ESM builds (server, desktop main).
//
//   record   — boot a bundle and record which dist/ files it loads
//   startup  — join a recording with the esbuild metafile: eager vs lazy, per package
//   why      — shortest static import path from the entry to a package (why is it eager?)
//   packages — whole-bundle composition per package (no recording needed)
//
// See SKILL.md for the workflow and the interpretation guide.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [cmd, ...args] = process.argv.slice(2);

const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
};

const commands = { record, startup, why, packages };
if (!commands[cmd]) {
    console.error(`usage:
  node analyze-bundle.mjs record --bundle <main.mjs> --out <loaded.txt> [--port 8123] [--settle 20]
  node analyze-bundle.mjs startup --meta <meta.json> --loaded <loaded.txt> [--top 20]
  node analyze-bundle.mjs why --meta <meta.json> <package-substring> [more...]
  node analyze-bundle.mjs packages --meta <meta.json> [--top 25]`);
    process.exit(1);
}
await commands[cmd]();

/** Boots the bundle with the module-load hook preloaded and records dist/ loads. */
async function record() {
    const bundle = path.resolve(flag("--bundle"));
    const out = path.resolve(flag("--out", "loaded-modules.txt"));
    const port = flag("--port");
    const settle = Number(flag("--settle", "20"));
    const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), "loghook.cjs");

    fs.writeFileSync(out, "");
    const loader = bundle.endsWith(".mjs")
        ? `import(${JSON.stringify("file://" + bundle)})`
        : `require(${JSON.stringify(bundle)})`;
    const child = spawn(process.execPath, ["--require", hook, "-e", loader], {
        env: { ...process.env, LOAD_LOG: out },
        stdio: "ignore",
    });

    if (port) {
        await waitForHttp(port, 120);
        await sleep(5000);
    } else {
        await sleep(settle * 1000);
    }
    // The server handles SIGTERM (closes the DB) without exiting, so escalate
    // to SIGKILL after giving the close a moment.
    child.kill("SIGTERM");
    await new Promise((resolve) => {
        child.on("exit", resolve);
        setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
        }, 3000);
    });

    const lines = [...new Set(fs.readFileSync(out, "utf8").split("\n").filter(Boolean))].sort();
    fs.writeFileSync(out, lines.join("\n") + "\n");
    console.log(`${lines.length} dist files loaded at startup -> ${out}`);
}

function waitForHttp(port, retries) {
    return new Promise((resolve) => {
        const attempt = (left) => {
            if (left <= 0) {
                console.error("server never became ready; recording what loaded anyway");
                resolve();
                return;
            }
            const req = http.get({ host: "127.0.0.1", port, path: "/" }, (res) => {
                res.resume();
                resolve();
            });
            req.on("error", () => setTimeout(() => attempt(left - 1), 500));
        };
        attempt(retries);
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Joins metafile output keys with recorded file URLs on their trailing two
 * path segments ("chunks/x.mjs", "dist/main.mjs"), since the metafile is
 * repo-relative and the recording is absolute.
 */
function tailKey(p) {
    return p.split("/").slice(-2).join("/");
}

function loadJoin() {
    const meta = JSON.parse(fs.readFileSync(flag("--meta"), "utf8"));
    const loadedTails = new Set(
        fs.readFileSync(flag("--loaded"), "utf8").split("\n").filter(Boolean).map(tailKey)
    );
    return { meta, isLoaded: (outKey) => loadedTails.has(tailKey(outKey)) };
}

function pkgOf(file) {
    const m = file.match(/node_modules\/(@[^/]+\/[^/]+|[^/@][^/]*)/g);
    if (m) {
        return m[m.length - 1].replace("node_modules/", "");
    }
    if (file.startsWith("packages/") || file.startsWith("apps/")) {
        return file.split("/").slice(0, 2).join("/");
    }
    return file;
}

function kb(n) {
    return (n / 1024).toFixed(0).padStart(7) + " KB";
}

/** Eager/lazy split from a recording: totals, per package, biggest loaded chunks. */
async function startup() {
    const { meta, isLoaded } = loadJoin();
    const top = Number(flag("--top", "20"));
    let eagerTotal = 0;
    let lazyTotal = 0;
    let eagerCount = 0;
    const eagerByPkg = new Map();
    const lazyByPkg = new Map();
    const eagerChunks = [];

    for (const [out, v] of Object.entries(meta.outputs)) {
        if (!/\.(mjs|cjs|js)$/.test(out)) {
            continue;
        }
        // CAUTION: v.entryPoint is set on every dynamic-import target (most
        // chunks), so it must not be used to decide eagerness — only the
        // recording can.
        const eager = isLoaded(out);
        for (const [inp, iv] of Object.entries(v.inputs ?? {})) {
            const map = eager ? eagerByPkg : lazyByPkg;
            map.set(pkgOf(inp), (map.get(pkgOf(inp)) ?? 0) + iv.bytesInOutput);
        }
        if (eager) {
            eagerTotal += v.bytes;
            eagerCount++;
            eagerChunks.push([out, v]);
        } else {
            lazyTotal += v.bytes;
        }
    }

    const mb = (n) => (n / 1048576).toFixed(2);
    console.log(`startup-loaded: ${mb(eagerTotal)} MB in ${eagerCount} files; stays lazy: ${mb(lazyTotal)} MB`);
    console.log("\n=== top packages in the startup-loaded set ===");
    for (const [pkg, sz] of [...eagerByPkg.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) {
        console.log(`${kb(sz)}  ${pkg}`);
    }
    console.log("\n=== top packages that stay lazy ===");
    for (const [pkg, sz] of [...lazyByPkg.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) {
        console.log(`${kb(sz)}  ${pkg}`);
    }
    console.log("\n=== biggest startup-loaded chunks (dominant input) ===");
    eagerChunks.sort((a, b) => b[1].bytes - a[1].bytes);
    for (const [out, v] of eagerChunks.slice(0, top)) {
        const dominant = Object.entries(v.inputs ?? {}).sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput)[0];
        console.log(`${kb(v.bytes)}  ${tailKey(out)}  <- ${dominant ? dominant[0] : "?"}`);
    }
}

/** Finds the true entry input: the one output that is not under chunks/. */
function findEntryInput(meta) {
    const override = flag("--entry");
    if (override) {
        return override;
    }
    for (const [out, v] of Object.entries(meta.outputs)) {
        if (/\.(mjs|cjs|js)$/.test(out) && !out.includes("/chunks/") && v.entryPoint) {
            return v.entryPoint;
        }
    }
    throw new Error("no entry output found; pass --entry <input path>");
}

/** BFS over static edges only — a dynamic-import edge is a lazy boundary. */
function staticReachability(meta, from) {
    const entry = from ?? findEntryInput(meta);
    if (!meta.inputs[entry]) {
        throw new Error(`no such input: ${entry}`);
    }
    const prev = new Map([[entry, null]]);
    const queue = [entry];
    while (queue.length) {
        const cur = queue.shift();
        for (const imp of meta.inputs[cur]?.imports ?? []) {
            if (imp.kind === "dynamic-import" || imp.external || !meta.inputs[imp.path] || prev.has(imp.path)) {
                continue;
            }
            prev.set(imp.path, cur);
            queue.push(imp.path);
        }
    }
    return prev;
}

/** Explains why packages are eager: the shortest static import chain from the entry. */
async function why() {
    const meta = JSON.parse(fs.readFileSync(flag("--meta"), "utf8"));
    const from = flag("--from");
    const prev = staticReachability(meta, from);
    const needles = args.filter((a) => !a.startsWith("--")
        && a !== flag("--meta") && a !== flag("--entry") && a !== from);
    for (const needle of needles) {
        const target = findInput([...prev.keys()], needle);
        if (!target) {
            console.log(`\n${needle}: NOT statically reachable from ${from ?? "the entry"}.`);
            console.log("  Two things still put it in the startup set, both visible only in a recording:");
            console.log("  - a dynamic import that runs during startup (defer that call), or");
            console.log("  - a static path from a module that is itself dynamically imported at boot");
            console.log(`    (e.g. www.ts). Re-run with --from <that input> to see the chain.`);
            continue;
        }
        const chain = [];
        for (let n = target; n; n = prev.get(n)) {
            chain.unshift(n);
        }
        console.log(`\n${needle} (matched ${target}): eager via`);
        for (const p of chain) {
            console.log("   " + p);
        }
    }
}

/**
 * Resolves a needle to one input path. A bare package name is matched at its
 * `node_modules/<name>/` boundary first: plain substring matching confuses a
 * package with any file whose name ends the same way ("highlight.js" also
 * matches postcss's `terminal-highlight.js`).
 */
function findInput(keys, needle) {
    if (needle.includes("/")) {
        return keys.find((k) => k.includes(needle));
    }
    const atBoundary = keys.find((k) => k.includes(`node_modules/${needle}/`));
    if (atBoundary) {
        return atBoundary;
    }
    // Path-segment match only, so a needle never matches the tail of a longer
    // file name.
    return keys.find((k) => k.includes(`/${needle}/`) || k.endsWith(`/${needle}`));
}

/** Whole-bundle composition, no recording needed. */
async function packages() {
    const meta = JSON.parse(fs.readFileSync(flag("--meta"), "utf8"));
    const top = Number(flag("--top", "25"));
    const byPkg = new Map();
    let total = 0;
    for (const v of Object.values(meta.outputs)) {
        for (const [inp, iv] of Object.entries(v.inputs ?? {})) {
            byPkg.set(pkgOf(inp), (byPkg.get(pkgOf(inp)) ?? 0) + iv.bytesInOutput);
            total += iv.bytesInOutput;
        }
    }
    console.log(`total bundled: ${(total / 1048576).toFixed(2)} MB`);
    for (const [pkg, sz] of [...byPkg.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) {
        console.log(`${kb(sz)}  ${pkg}`);
    }
}
