// Boots a backend bundle, waits for it to serve HTTP, then records memory
// statistics (and optionally a heap snapshot) and exits.
//
//   node --expose-gc profile-bundle.cjs <bundle> [--port 8123] [--stats out.json] [--snapshot out.heapsnapshot]
//
// The caller supplies the TRILIUM_* environment (see SKILL.md). Run with
// --expose-gc so the post-GC numbers are meaningful. Without --port the
// script settles on a fixed 20 s timer instead of polling.
const v8 = require("v8");
const http = require("http");
const fs = require("fs");
const { pathToFileURL } = require("url");

const args = process.argv.slice(2);
const bundle = args[0];
const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};
const port = flag("--port");
const statsOut = flag("--stats") || "memory-stats.json";
const snapshotOut = flag("--snapshot");

if (!bundle) {
    console.error("usage: node --expose-gc profile-bundle.cjs <bundle.mjs|bundle.cjs> [--port N] [--stats f] [--snapshot f]");
    process.exit(1);
}

function collectStats(label) {
    return {
        label,
        memoryUsage: process.memoryUsage(),
        heapStatistics: v8.getHeapStatistics(),
        heapCodeStatistics: v8.getHeapCodeStatistics(),
    };
}

const stats = [collectStats("baseline (before load)")];

if (bundle.endsWith(".mjs")) {
    import(pathToFileURL(bundle).href);
} else {
    require(bundle);
}

function waitForServer(retries) {
    if (retries <= 0) {
        console.error("server never became ready; collecting anyway");
        finish();
        return;
    }
    const req = http.get({ host: "127.0.0.1", port, path: "/" }, (res) => {
        res.resume();
        console.log(`server responded with ${res.statusCode}, settling 15s...`);
        setTimeout(finish, 15000);
    });
    req.on("error", () => setTimeout(() => waitForServer(retries - 1), 500));
}

function finish() {
    stats.push(collectStats("after startup (pre-GC)"));
    if (global.gc) {
        for (let i = 0; i < 3; i++) global.gc();
    }
    stats.push(collectStats("after startup (post-GC)"));
    fs.writeFileSync(statsOut, JSON.stringify(stats, null, 2));
    const last = stats[stats.length - 1];
    const mb = (n) => (n / 1048576).toFixed(1) + " MB";
    console.log(`rss=${mb(last.memoryUsage.rss)} heapUsed=${mb(last.memoryUsage.heapUsed)} heapTotal=${mb(last.memoryUsage.heapTotal)} (details: ${statsOut})`);
    if (snapshotOut) {
        console.log("writing heap snapshot...");
        v8.writeHeapSnapshot(snapshotOut);
        console.log(`snapshot: ${snapshotOut} (${fs.statSync(snapshotOut).size} bytes)`);
    }
    process.exit(0);
}

if (port) {
    setTimeout(() => waitForServer(120), 2000);
} else {
    setTimeout(finish, 20000);
}
