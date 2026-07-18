#!/usr/bin/env node
/**
 * Analyzes request captures produced by capture-requests.mjs.
 *
 * Usage:
 *   node analyze-requests.mjs summary <capture.json> [--top N]
 *   node analyze-requests.mjs probe <capture.json> [name ...]
 *   node analyze-requests.mjs diff <before.json> <after.json> [--filter <regex>]
 *
 * summary  totals by resource type plus the N largest requests (default 25)
 * probe    checks whether known heavy dependencies were loaded (or the given names)
 * diff     modules that disappeared/appeared between two captures, by normalized path
 */
import fs from "fs";

// Heavy dependencies worth keeping off the startup path. Extend as new ones appear.
const DEFAULT_PROBES = [
    "deps/ckeditor5.js",
    "ckeditor5-premium-features",
    "highlight__js",
    "deps/katex.js",
    "snapdom",
    "codemirror-vim",
    "force-graph",
    "mermaid",
    "excalidraw",
    "emoji_definitions",
    "llm_chat/",
    "fancytree",
    "numfmt"
];

/**
 * Makes URLs comparable across hosts, Vite cache-busting params, asset version
 * prefixes and checkout locations (the @fs absolute path differs per worktree —
 * never filter on raw URLs, a worktree name like "lazy-ribbon" can match your filter).
 */
function normalize(url) {
    return url
        .replace(/^https?:\/\/[^/]+/, "")
        .replace(/[?&](v|t)=[a-z0-9]+/gi, "")
        .replace(/\/assets\/v[^/]+\//, "/")
        .replace(/\/@fs\/.*?\/(packages|apps|node_modules|\.cache)\//, "/$1/");
}

function load(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function kb(bytes) {
    return `${(bytes / 1024).toFixed(1)}K`;
}

function totals(requests) {
    const bytes = requests.reduce((sum, r) => sum + (r.bodySize || 0), 0);
    const scripts = requests.filter((r) => r.resourceType === "script").length;
    return `${requests.length} requests / ${(bytes / 1024 / 1024).toFixed(2)} MB / ${scripts} scripts`;
}

function summary(file, topN) {
    const requests = load(file);
    const byType = {};
    for (const r of requests) {
        const type = r.resourceType || "other";
        byType[type] = byType[type] || { count: 0, size: 0 };
        byType[type].count++;
        byType[type].size += r.bodySize || 0;
    }

    console.log(`Total: ${totals(requests)}\n`);
    console.log("--- By resource type ---");
    for (const [type, v] of Object.entries(byType).sort((a, b) => b[1].size - a[1].size)) {
        console.log(type.padEnd(12), String(v.count).padStart(4), kb(v.size).padStart(10));
    }

    console.log(`\n--- Top ${topN} largest ---`);
    for (const r of [...requests].sort((a, b) => (b.bodySize || 0) - (a.bodySize || 0)).slice(0, topN)) {
        console.log(kb(r.bodySize || 0).padStart(9), (r.resourceType || "").padEnd(11), normalize(r.url));
    }
}

function probe(file, names) {
    const requests = load(file);
    for (const name of names.length ? names : DEFAULT_PROBES) {
        const hit = requests.find((r) => normalize(r.url).includes(name));
        console.log(
            name.padEnd(28),
            hit ? `LOADED  seq ${String(hit.seq).padStart(4)}  ${kb(hit.bodySize || 0)}` : "not loaded"
        );
    }
}

function diff(beforeFile, afterFile, filterRegex) {
    const filter = filterRegex ? new RegExp(filterRegex) : null;
    const collect = (file) => {
        const map = new Map();
        for (const r of load(file)) {
            const url = normalize(r.url);
            if (!filter || filter.test(url)) map.set(url, r.bodySize || 0);
        }
        return map;
    };
    const before = collect(beforeFile);
    const after = collect(afterFile);

    const print = (title, entries) => {
        const total = entries.reduce((sum, [, size]) => sum + size, 0);
        console.log(`\n--- ${title} (${entries.length} requests, ${kb(total)}) ---`);
        for (const [url, size] of entries.sort((a, b) => b[1] - a[1])) {
            console.log(kb(size).padStart(9), url);
        }
    };

    print("Gone (in before, not in after)", [...before].filter(([url]) => !after.has(url)));
    print("Added (in after, not in before)", [...after].filter(([url]) => !before.has(url)));
    console.log(`\nBefore: ${totals(load(beforeFile))}`);
    console.log(`After:  ${totals(load(afterFile))}`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
    case "summary": {
        const topIndex = args.indexOf("--top");
        summary(args[0], topIndex >= 0 ? parseInt(args[topIndex + 1], 10) : 25);
        break;
    }
    case "probe":
        probe(args[0], args.slice(1));
        break;
    case "diff": {
        const filterIndex = args.indexOf("--filter");
        diff(args[0], args[1], filterIndex >= 0 ? args[filterIndex + 1] : null);
        break;
    }
    default:
        console.error("Usage: analyze-requests.mjs <summary|probe|diff> ... (see file header)");
        process.exit(1);
}
