#!/usr/bin/env node
// Direction-aware IPC parity checker for Trilium's Electron contextBridge.
//
// The desktop bridge has four moving parts that must stay in sync:
//   1. preload.ts          — ipcRenderer.send / sendSync / invoke (renderer→main)
//                            and ipcRenderer.on (main→renderer push).
//   2. handler modules     — ipcMain.on / ipcMain.handle (the main-process side).
//   3. main.ts             — must call each module's setupX() or the handlers
//                            never register (the #1 footgun: dead until wired).
//   4. preload.spec.ts     — asserts the exact {channel,args} each method emits.
//
// This script diffs them and reports four classes of drift:
//   (a) renderer→main channel in preload with NO ipcMain handler
//       → send no-ops; sendSync HANGS the renderer; invoke rejects. (exit 1)
//   (b) transport/handler-kind mismatch (send/sendSync↔on, invoke↔handle). (exit 1)
//   (c) ipcMain handler with NO preload caller (dead / legacy). Advisory.
//   (d) preload channel with NO preload.spec.ts assertion (untested). Advisory.
//   (e) handler module whose setupX() is never called from main.ts
//       → every channel it owns is dead. (exit 1)
//
// It is channel-granular (the multiplexed `navigation-history` collapses to one
// channel, avoiding false positives) and whitelists push-only channels in (a).
//
// Usage:
//   node .claude/skills/electron-desktop-bridge/scripts/ipc-parity.mjs [--root <dir>] [--json]

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ipcMain handlers that have no preload caller and are known legacy (replaced by
// the preview-based print flow). Reported but not alarming.
const KNOWN_ORPHAN_HANDLERS = new Set(["print-note", "export-as-pdf"]);

const __dirname = dirname(fileURLToPath(import.meta.url));

function findRepoRoot() {
    const argRoot = argValue("--root");
    if (argRoot) return resolve(argRoot);
    // scripts → electron-desktop-bridge → skills → .claude → repo root
    const computed = resolve(__dirname, "..", "..", "..", "..");
    if (existsSync(join(computed, "apps", "desktop", "src", "preload.ts"))) return computed;
    return process.cwd();
}

function argValue(flag) {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : null;
}

function read(path) {
    return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** Recursively list *.ts files under `dir`, excluding *.spec.ts. */
function listSourceFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            out.push(...listSourceFiles(full));
        } else if (entry.endsWith(".ts") && !entry.endsWith(".spec.ts") && !entry.endsWith(".d.ts")) {
            out.push(full);
        }
    }
    return out;
}

/** All matches of `re` (must have one capture group) as an array of {value, ...extra}. */
function matchAll(text, re, map) {
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
        out.push(map(m));
    }
    return out;
}

function main() {
    const root = findRepoRoot();
    const desktopSrc = join(root, "apps", "desktop", "src");
    const preloadPath = join(desktopSrc, "preload.ts");
    const specPath = join(desktopSrc, "preload.spec.ts");
    const mainPath = join(desktopSrc, "main.ts");

    if (!existsSync(preloadPath)) {
        console.error(`Could not find ${preloadPath}. Pass --root <repo-root>.`);
        process.exit(2);
    }

    const preloadText = read(preloadPath);
    const specText = read(specPath);
    const mainText = read(mainPath);

    // --- preload: renderer→main channels (transport-aware) and push channels ---
    const r2m = new Map(); // channel -> Set<transport>
    for (const { ch, transport } of matchAll(
        preloadText,
        /ipcRenderer\.(send|sendSync|invoke)\(\s*["'`]([^"'`]+)["'`]/g,
        (m) => ({ transport: m[1], ch: m[2] })
    )) {
        if (!r2m.has(ch)) r2m.set(ch, new Set());
        r2m.get(ch).add(transport);
    }
    const pushChannels = new Set(
        matchAll(
            preloadText,
            /ipcRenderer\.(on|removeAllListeners|removeListener)\(\s*["'`]([^"'`]+)["'`]/g,
            (m) => m[2]
        )
    );

    // --- handler modules: ipcMain.on / handle, mapped channel -> {kind, file} ---
    // ipcMain is the AUTHORITATIVE kind map (string literals + same-file const
    // channels like `const IPC_FROM_RENDERER = "..."`). `handled` is a looser
    // set used only for the "missing handler" check: it adds the literals of
    // any module that registers a channel via INDIRECTION (an identifier/param
    // first arg, e.g. security_settings' `ipcMain.handle(channel, ...)`), so
    // those don't false-positive. Normal literal-only modules stay strict.
    const ipcMain = new Map(); // channel -> { kind, file }
    const handled = new Set(); // channels we have evidence are handled main-side
    const handlerFiles = listSourceFiles(desktopSrc).filter((f) => f !== preloadPath);
    for (const file of handlerFiles) {
        const text = read(file);
        const rel = file.slice(root.length + 1);
        const constMap = new Map(
            matchAll(text, /const\s+([A-Za-z_$][\w$]*)\s*=\s*["'`]([^"'`]+)["'`]/g, (m) => [m[1], m[2]])
        );
        // First definition wins; transient re-registrations don't override.
        const define = (ch, kind) => {
            handled.add(ch);
            if (!ipcMain.has(ch)) ipcMain.set(ch, { kind, file: rel });
        };
        for (const { ch, kind } of matchAll(
            text,
            /ipcMain\.(on|handle)\(\s*["'`]([^"'`]+)["'`]/g,
            (m) => ({ kind: m[1], ch: m[2] })
        )) {
            define(ch, kind);
        }
        let hasIndirection = false;
        for (const { ident, kind } of matchAll(
            text,
            /ipcMain\.(on|handle)\(\s*([A-Za-z_$][\w$]*)/g,
            (m) => ({ kind: m[1], ident: m[2] })
        )) {
            hasIndirection = true;
            const lit = constMap.get(ident);
            if (lit) define(lit, kind);
        }
        // A module that registers a channel via a non-literal first arg may name
        // its channels in helper-call literals; trust this file's literals.
        if (hasIndirection) {
            for (const lit of constMap.values()) handled.add(lit);
            for (const lit of matchAll(text, /["'`]([a-z][a-z0-9-]+)["'`]/g, (m) => m[1])) handled.add(lit);
        }
    }

    // --- spec: every channel the spec references in any form ---
    const specChannels = new Set([
        ...matchAll(specText, /channel:\s*["'`]([^"'`]+)["'`]/g, (m) => m[1]),
        ...matchAll(specText, /ipcRendererSyncResults\.set\(\s*["'`]([^"'`:]+):/g, (m) => m[1]),
        ...matchAll(specText, /ipcRendererListeners\.(?:get|has)\(\s*["'`]([^"'`]+)["'`]/g, (m) => m[1])
    ]);

    // --- (e) module registration in main.ts ---
    // Only modules that actually own an ipcMain handler need a setupX() in
    // main.ts. setupWebContentsSecurity (no ipcMain handlers; called
    // transitively by setupWindowing) is correctly excluded.
    const setupFns = new Set();
    for (const file of handlerFiles) {
        const text = read(file);
        if (!/ipcMain\.(on|handle)\(/.test(text)) continue;
        for (const fn of matchAll(
            text,
            /export\s+(?:async\s+)?function\s+((?:setup|register)\w+)\s*\(/g,
            (m) => m[1]
        )) {
            setupFns.add(JSON.stringify({ fn, file: file.slice(root.length + 1) }));
        }
    }

    // --- compute findings ---
    const findings = { missingHandler: [], mismatch: [], deadHandler: [], untested: [], unregistered: [] };

    for (const [ch, transports] of r2m) {
        if (!handled.has(ch)) {
            if (pushChannels.has(ch)) continue; // also a push channel; tolerate
            findings.missingHandler.push({ ch, transports: [...transports] });
            continue;
        }
        const handler = ipcMain.get(ch);
        if (!handler) continue; // handled via indirection; kind not resolvable
        for (const t of transports) {
            const expected = t === "invoke" ? "handle" : "on";
            if (handler.kind !== expected) {
                findings.mismatch.push({ ch, transport: t, expected, got: handler.kind });
            }
        }
    }

    for (const [ch, info] of ipcMain) {
        if (!r2m.has(ch)) {
            findings.deadHandler.push({ ch, file: info.file, known: KNOWN_ORPHAN_HANDLERS.has(ch) });
        }
    }

    for (const ch of [...r2m.keys(), ...pushChannels]) {
        if (!specChannels.has(ch)) findings.untested.push(ch);
    }

    for (const entry of setupFns) {
        const { fn, file } = JSON.parse(entry);
        if (!new RegExp(`\\b${fn}\\s*\\(`).test(mainText)) {
            findings.unregistered.push({ fn, file });
        }
    }
    // The ws provider registers via a class method, not an exported setup fn.
    if (ipcMain.has("trilium-ws-from-renderer") && !/ipcMessaging\.init\s*\(/.test(mainText)) {
        findings.unregistered.push({ fn: "ipcMessaging.init", file: "apps/desktop/src/ipc_messaging_provider.ts" });
    }

    if (process.argv.includes("--json")) {
        console.log(JSON.stringify({ root, counts: countOf(findings), findings }, null, 2));
    } else {
        report(findings, { r2m, ipcMain, pushChannels });
    }

    const fatal = findings.missingHandler.length + findings.mismatch.length + findings.unregistered.length;
    process.exit(fatal > 0 ? 1 : 0);
}

function countOf(f) {
    return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.length]));
}

function report(f, stats) {
    const line = "-".repeat(64);
    console.log(line);
    console.log("IPC bridge parity report");
    console.log(line);
    console.log(
        `preload renderer→main channels: ${stats.r2m.size}   push channels: ${stats.pushChannels.size}   ipcMain handlers: ${stats.ipcMain.size}`
    );
    console.log("");

    section("(a) renderer→main channels with NO ipcMain handler  [FATAL: hang/no-op]", f.missingHandler, (x) =>
        `  ${x.ch}  (preload uses ${x.transports.join("/")})`
    );
    section("(b) transport / handler-kind mismatch  [FATAL]", f.mismatch, (x) =>
        `  ${x.ch}: preload ${x.transport} expects ipcMain.${x.expected}, found ipcMain.${x.got}`
    );
    section("(e) handler module setupX() never called from main.ts  [FATAL: channels dead]", f.unregistered, (x) =>
        `  ${x.fn}()  (${x.file})`
    );
    section("(c) ipcMain handlers with no preload caller  [advisory: dead/legacy]", f.deadHandler, (x) =>
        `  ${x.ch}  (${x.file})${x.known ? "  — known legacy orphan" : ""}`
    );
    section("(d) preload channels with no preload.spec.ts assertion  [advisory: untested]", f.untested, (x) => `  ${x}`);

    const fatal = f.missingHandler.length + f.mismatch.length + f.unregistered.length;
    console.log(line);
    console.log(fatal > 0 ? `RESULT: ${fatal} fatal finding(s) — fix before shipping.` : "RESULT: no fatal findings.");
    console.log(line);
}

function section(title, items, fmt) {
    console.log(title);
    if (items.length === 0) {
        console.log("  (none)");
    } else {
        for (const it of items) console.log(fmt(it));
    }
    console.log("");
}

main();
