#!/usr/bin/env node
/**
 * Analyzes request captures produced by capture-requests.mjs.
 *
 * Usage:
 *   node analyze-requests.mjs summary <capture.json> [--top N]
 *   node analyze-requests.mjs probe <capture.json> [name ...]
 *   node analyze-requests.mjs diff <before.json> <after.json> [--filter <regex>]
 *   node analyze-requests.mjs modules <capture.json> [--depth N] [--list <regex>]
 *   node analyze-requests.mjs roots <capture.json> [--top N]
 *   node analyze-requests.mjs why <capture.json> <name>
 *   node analyze-requests.mjs check <capture.json> [allowlist.txt] [--update]
 *
 * summary  totals by resource type plus the N largest requests (default 25)
 * probe    checks whether known heavy dependencies were loaded (or the given names)
 * diff     modules that disappeared/appeared between two captures, by normalized path
 * modules  requests grouped by where the module lives (N path segments, default 3);
 *          --list prints every module whose normalized path matches
 * roots    what started each group of requests: the page, or a dynamic import / fetch made by
 *          running script, with how many requests its static imports then pulled in
 * why      the chain of importers from the page down to the first module matching <name>
 * check    fails when the requests differ from the allowlist (default: desktop-startup-allowlist.txt;
 *          mobile-startup-allowlist.txt for the mobile client); --update rewrites it from the capture
 *
 * modules, roots and why attribute each request to whatever asked for it first, so they need a
 * capture that recorded initiators.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DEFAULT_ALLOWLIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "desktop-startup-allowlist.txt");

// Heavy dependencies worth keeping off the startup path. Extend as new ones appear.
const DEFAULT_PROBES = [
    "deps/ckeditor5.js",
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
 * prefixes, each dev instance's own dependency cache and checkout locations (the @fs absolute path differs per worktree —
 * never filter on raw URLs, a worktree name like "lazy-ribbon" can match your filter).
 */
function normalize(url) {
    return url
        .replace(/^(https?|trilium-app):\/\/[^/]+/, "")
        .replace(/[?&](v|t)=[a-z0-9]+/gi, "")
        .replace(/\/assets\/v[^/]+\//, "/")
        .replace(/\/@fs\/.*?\/(packages|apps|node_modules|\.cache)\//, "/$1/")
        .replace(/\/\.cache\/vite-\d+\//, "/.cache/vite/");
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

/**
 * Each request with its normalized path and that of whatever requested it first. `dynamic` is set
 * when running script made the request (a dynamic import, a fetch, an injected element), which is
 * where one static import graph ends and the next begins.
 */
function graph(file) {
    const requests = load(file);
    if (!requests.some((r) => r.initiator)) {
        console.error("This capture has no initiators; capture it again with capture-requests.mjs.");
        process.exit(1);
    }
    const nodes = new Map();
    for (const r of requests) {
        const path = normalize(r.url);
        if (nodes.has(path)) continue;
        nodes.set(path, {
            path,
            seq: r.seq,
            size: r.bodySize || 0,
            type: r.resourceType,
            parent: r.initiator?.url ? normalize(r.initiator.url) : null,
            dynamic: !r.initiator || r.initiator.dynamic || r.initiator.type !== "script",
            stack: (r.initiator?.stack ?? []).map(normalize)
        });
    }
    return nodes;
}

function modules(file, depth, listRegex) {
    const nodes = [...graph(file).values()];
    if (listRegex) {
        const filter = new RegExp(listRegex);
        const hits = nodes.filter((n) => filter.test(n.path));
        for (const n of hits) {
            console.log(String(n.seq).padStart(4), kb(n.size).padStart(9), n.path, n.parent ? `  <- ${n.parent}` : "");
        }
        console.log(`\n${hits.length} requests, ${kb(hits.reduce((sum, n) => sum + n.size, 0))}`);
        return;
    }
    const groups = new Map();
    for (const n of nodes) {
        const key = n.path.split("/").slice(0, depth + 1).join("/") || "/";
        const group = groups.get(key) ?? { count: 0, size: 0 };
        group.count++;
        group.size += n.size;
        groups.set(key, group);
    }
    console.log(`${nodes.length} requests\n`);
    for (const [key, v] of [...groups].sort((a, b) => b[1].count - a[1].count)) {
        console.log(String(v.count).padStart(4), kb(v.size).padStart(10), key);
    }
}

/** The request that started the static import graph `node` belongs to. */
function rootOf(nodes, node) {
    const seen = new Set();
    let current = node;
    while (!current.dynamic && current.parent && nodes.has(current.parent) && !seen.has(current.path)) {
        seen.add(current.path);
        current = nodes.get(current.parent);
    }
    return current;
}

/**
 * The modules that render what the session has open: the note's content, the list of its child
 * notes, and the tab the right pane is open on. What they request is the session's own load. The
 * user's `#widget` and startup scripts count as well: `script_context.ts` imports the script API
 * only to run one. So does `note_types.tsx`, which imports the views of the common note types once
 * the browser is idle (`preloadCommonNoteTypes()`), and those of the open notes.
 */
const SESSION_RENDERERS = new Set([
    "/src/widgets/NoteDetail.tsx",
    "/src/widgets/note_types.tsx",
    "/src/widgets/collections/NoteList.tsx",
    "/src/widgets/sidebar/RightPanelContainer.tsx",
    "/src/services/script_context.ts"
]);

/**
 * The paths of the requests that load what the session has open rather than the app: those with
 * one of {@link SESSION_RENDERERS} on their stack, the static import graphs they start, and, in
 * turn, what the modules of that load request. Which requests these are depends on the session, so
 * `check` leaves them out. A capture without stacks (taken before they were recorded) yields none.
 */
function noteLoadPaths(nodes) {
    const paths = new Set();
    let changed = true;
    while (changed) {
        changed = false;
        for (const node of nodes.values()) {
            if (paths.has(node.path)) continue;
            const root = rootOf(nodes, node);
            const callers = root.parent ? [ root.parent, ...root.stack ] : root.stack;
            if (callers.some((caller) => SESSION_RENDERERS.has(caller) || paths.has(caller))) {
                paths.add(node.path);
                changed = true;
            }
        }
    }
    return paths;
}

function roots(file, topN) {
    const nodes = graph(file);
    const groups = new Map();
    for (const node of nodes.values()) {
        const root = rootOf(nodes, node);
        const group = groups.get(root.path) ?? { root, count: 0, size: 0 };
        group.count++;
        group.size += node.size;
        groups.set(root.path, group);
    }
    console.log(`${nodes.size} requests in ${groups.size} groups\n`);
    console.log(" seq  reqs       size  started by -> first request");
    for (const { root, count, size } of [...groups.values()].sort((a, b) => b.count - a.count).slice(0, topN)) {
        console.log(String(root.seq).padStart(4), String(count).padStart(5), kb(size).padStart(10), ` ${root.parent ?? "(page)"} -> ${root.path}`);
    }
}

function why(file, name) {
    const nodes = graph(file);
    const target = [...nodes.values()].find((n) => n.path.includes(name));
    if (!target) {
        console.log(`${name}: not loaded`);
        return;
    }
    const chain = [];
    const seen = new Set();
    for (let node = target; node && !seen.has(node.path); node = node.parent ? nodes.get(node.parent) : null) {
        seen.add(node.path);
        chain.unshift(node);
    }
    for (const [index, node] of chain.entries()) {
        const how = index === 0 ? "" : node.dynamic ? "dynamic " : "import  ";
        console.log(`${"  ".repeat(index)}${how}${node.path}  (seq ${node.seq})`);
    }
}

/**
 * The name a request has in an allowlist: its normalized path without what changes between runs
 * (the content hash of a pre-bundled dependency chunk, the query string of the HMR websocket) or
 * between sessions (the ID of the open note in `/api/notes/<id>/...` and `/api/note-map/<id>/...`,
 * of an attachment the open note shows, of each `#appCss` note in `/api/notes/download/<id>`, and
 * of an expanded note whose subtree the tree loads or whose expansion it saves).
 */
function stableName(request) {
    return normalize(request.url)
        .replace(/^\/api\/notes\/download\/[A-Za-z0-9_]+$/, "/api/notes/download/*")
        .replace(/^\/api\/(notes|note-map)\/(?!download\/\*$)[A-Za-z0-9_]+\//, "/api/$1/*/")
        .replace(/^\/api\/attachments\/download\/[A-Za-z0-9_]+$/, "/api/attachments/download/*")
        .replace(/^\/api\/attachments\/[A-Za-z0-9_]+\/image\/.*$/, "/api/attachments/*/image/*")
        .replace(/^\/api\/tree\?subTreeNoteId=(?!root$)[A-Za-z0-9_]+$/, "/api/tree?subTreeNoteId=*")
        .replace(/^\/api\/branches\/[A-Za-z0-9_]+\/expanded\/[01]$/, "/api/branches/*/expanded/*")
        .replace(/-[A-Za-z0-9_-]{8}\.js$/, "-*.js")
        .replace(/^(wss?:\/\/)[^/]+(\/[^?]*).*$/, "$1*$2");
}

/**
 * Compares the requests of a capture with an allowlist, one name per line, and exits with 1 when
 * the two differ in either direction. A line starting with `?` names a request that depends on
 * the session, which is allowed but not required. `--update` writes the allowlist from the capture
 * instead, keeping its optional names.
 */
function check(file, allowlistFile, update) {
    const requests = load(file);
    if (!requests.some((request) => normalize(request.url).startsWith("/bootstrap"))) {
        console.error(`${file} has no /bootstrap request, so it did not capture an app startup.`);
        process.exit(1);
    }
    const noteLoad = requests.some((request) => request.initiator) ? noteLoadPaths(graph(file)) : new Set();
    const startupRequests = requests.filter((request) => !noteLoad.has(normalize(request.url)));
    const actual = [ ...new Set(startupRequests.map(stableName)) ].sort();
    if (noteLoad.size) {
        console.log(`Left out ${noteLoad.size} requests that load what the session has open.`);
    }
    const lines = fs.existsSync(allowlistFile)
        ? fs.readFileSync(allowlistFile, "utf8").split("\n").map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"))
        : [];
    const optional = new Set(lines.filter((line) => line.startsWith("?"))
        .map((line) => line.slice(1).trim()));
    // A request is attributed to whatever made it first, so a module the app loads can be requested
    // first by the session's load. It was made all the same.
    const made = new Set(requests.map(stableName));

    if (update) {
        const existingHeader = fs.existsSync(allowlistFile)
            ? fs.readFileSync(allowlistFile, "utf8").split("\n").filter((line) => line.startsWith("#"))
            : [];
        const client = path.basename(allowlistFile).startsWith("mobile") ? "mobile" : "desktop";
        const header = existingHeader.length ? existingHeader : [
            `# Every request the ${client} client is allowed to make during startup, in dev mode.`,
            "# Checked by `analyze-requests.mjs check`; regenerate with `--update` only for a request that is wanted.",
            "# A `?` marks a request that depends on the session: allowed, but not required."
        ];
        // A name the session's load requested first is kept: `--update` cannot tell it from one the
        // app no longer loads, which is removed by hand.
        const kept = lines.filter((line) => !line.startsWith("?") && made.has(line));
        const required = [ ...new Set([ ...actual, ...kept ]) ].filter((name) => !optional.has(name)).sort();
        const optionalLines = [ ...optional ].sort().map((name) => `? ${name}`);
        fs.writeFileSync(allowlistFile, `${[ ...header, ...required, ...optionalLines ].join("\n")}\n`);
        console.log(`Wrote ${required.length} names and ${optional.size} optional ones to ${allowlistFile}`);
        return;
    }

    const required = new Set(lines.filter((line) => !line.startsWith("?")));
    const unexpected = actual.filter((name) => !required.has(name) && !optional.has(name));
    const missing = [ ...required ].filter((name) => !made.has(name)).sort();

    if (!unexpected.length && !missing.length) {
        console.log(`OK: the ${actual.length} startup requests match ${allowlistFile}`);
        return;
    }

    const sizes = new Map();
    for (const request of requests) {
        sizes.set(stableName(request), request.bodySize ?? 0);
    }
    if (unexpected.length) {
        console.log(`${unexpected.length} requests are not in the allowlist:`);
        for (const name of unexpected) {
            console.log(`  + ${kb(sizes.get(name) ?? 0).padStart(8)} ${name}`);
        }
    }
    if (missing.length) {
        console.log(`${missing.length} allowlisted requests were not made:`);
        for (const name of missing) {
            console.log(`  - ${name}`);
        }
    }
    console.log(`FAILED: ${actual.length} requests, ${required.size} required and ${optional.size} optional allowed`);
    process.exit(1);
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
    case "modules": {
        const depthIndex = args.indexOf("--depth");
        const listIndex = args.indexOf("--list");
        modules(args[0], depthIndex >= 0 ? parseInt(args[depthIndex + 1], 10) : 3, listIndex >= 0 ? args[listIndex + 1] : null);
        break;
    }
    case "roots": {
        const topIndex = args.indexOf("--top");
        roots(args[0], topIndex >= 0 ? parseInt(args[topIndex + 1], 10) : 30);
        break;
    }
    case "check": {
        const positional = args.filter((arg) => arg !== "--update");
        check(positional[0], positional[1] ?? DEFAULT_ALLOWLIST, args.includes("--update"));
        break;
    }
    case "why":
        why(args[0], args[1]);
        break;
    default:
        console.error("Usage: analyze-requests.mjs <summary|probe|diff|modules|roots|why|check> ... (see file header)");
        process.exit(1);
}
