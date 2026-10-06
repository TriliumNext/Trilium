// Catches the CommonJS interop break in a split ESM build: a dynamic import of
// a CJS package yields a chunk that can only export `default`, so destructuring
// named exports from it silently gives `undefined` at runtime — a failure unit
// tests miss whenever they mock the package.
//
//   node check-dynamic-imports.mjs <dist-dir>
//
// Exit code 1 if any consumer destructures a name its target chunk lacks.
// Run it on a CLEAN build: leftover chunks from an earlier build are still
// scanned and report stale findings.
import fs from "node:fs";
import path from "node:path";

const dist = process.argv[2];
if (!dist) {
    console.error("usage: node check-dynamic-imports.mjs <dist-dir>");
    process.exit(1);
}
const chunkDir = path.join(dist, "chunks");
const files = [path.join(dist, "main.mjs"),
    ...fs.readdirSync(chunkDir).map(f => path.join(chunkDir, f))];

function exportedNames(file) {
    const src = fs.readFileSync(file, "utf8");
    const names = new Set();
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
        for (const part of m[1].split(",")) {
            const bits = part.trim().split(/\s+as\s+/);
            const name = (bits[1] ?? bits[0]).trim();
            if (name) names.add(name);
        }
    }
    if (/export\s+default\s/.test(src)) names.add("default");
    return names;
}

const exportCache = new Map();
let checked = 0, broken = 0;
for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    // No declarator anchor: minified output continues a `let` with commas, so
    // the destructure often has no keyword directly before it.
    for (const m of src.matchAll(/\{([^}]*)\}\s*=\s*await import\("\.\/([^"]+\.mjs)"\)/g)) {
        // `[^}]*` starts after the previous `}`, so the capture can include
        // preceding code; the destructure is whatever follows the last `{`.
        const inner = m[1].slice(m[1].lastIndexOf("{") + 1);
        const wanted = inner.split(",").map(s => s.split(":")[0].trim())
            .filter(n => /^[A-Za-z_$][\w$]*$/.test(n));
        const target = path.join(chunkDir, path.basename(m[2]));
        if (!exportCache.has(target)) exportCache.set(target, exportedNames(target));
        const has = exportCache.get(target);
        const missing = wanted.filter(n => !has.has(n));
        checked++;
        if (missing.length) {
            broken++;
            console.log(`BROKEN  ${path.basename(file)} -> ${path.basename(m[2])}  wants=[${wanted}]  exports=[${[...has].slice(0, 5)}]`);
        }
    }
    // The other spelling of the same read: `(await import("./x.mjs")).name`
    // reaches straight into the namespace and breaks identically.
    for (const m of src.matchAll(/\(await import\("\.\/([^"]+\.mjs)"\)\)\.([A-Za-z_$][\w$]*)/g)) {
        const target = path.join(chunkDir, path.basename(m[1]));
        if (!exportCache.has(target)) exportCache.set(target, exportedNames(target));
        const has = exportCache.get(target);
        checked++;
        if (!has.has(m[2])) {
            broken++;
            console.log(`BROKEN  ${path.basename(file)} -> ${path.basename(m[1])}  wants=[${m[2]}]  exports=[${[...has].slice(0, 5)}]`);
        }
    }
}
console.log(`\n${checked} dynamic import reads checked, ${broken} broken`);
if (broken) {
    console.log("Fix: read the module object through its CJS interop, e.g.\n" +
        "  const mod = await import(\"pkg\");\n" +
        "  const { thing } = mod.default ?? mod;\n" +
        "and give the package's test mock a matching `default` key.");
    process.exit(1);
}
