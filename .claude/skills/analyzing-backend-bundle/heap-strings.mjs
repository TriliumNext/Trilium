// Aggregates a V8 .heapsnapshot by node type and lists the largest strings,
// classifying retained script sources — the proof of what the process keeps
// in heap for each loaded bundle/chunk.
//
//   node --max-old-space-size=8192 heap-strings.mjs <file.heapsnapshot> [--min-kb 128]
import fs from "node:fs";

const snapPath = process.argv[2];
const minIdx = process.argv.indexOf("--min-kb");
const minBytes = (minIdx >= 0 ? Number(process.argv[minIdx + 1]) : 128) * 1024;

console.error("parsing snapshot...");
const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));

const meta = snap.snapshot.meta;
const nodeTypes = meta.node_types[0];
const fieldCount = meta.node_fields.length;
const idxType = meta.node_fields.indexOf("type");
const idxName = meta.node_fields.indexOf("name");
const idxSelfSize = meta.node_fields.indexOf("self_size");

const byType = new Map();
const big = [];
for (let i = 0; i < snap.nodes.length; i += fieldCount) {
    const type = nodeTypes[snap.nodes[i + idxType]];
    const size = snap.nodes[i + idxSelfSize];
    const agg = byType.get(type) ?? { count: 0, size: 0 };
    agg.count++;
    agg.size += size;
    byType.set(type, agg);
    if (size >= minBytes) {
        big.push({ type, size, nameIdx: snap.nodes[i + idxName] });
    }
}

const totalSize = [...byType.values()].reduce((a, b) => a + b.size, 0);
console.log(`total self_size: ${(totalSize / 1048576).toFixed(1)} MB, nodes: ${snap.nodes.length / fieldCount}`);
console.log("\n=== self_size by node type ===");
for (const [type, agg] of [...byType.entries()].sort((a, b) => b[1].size - a[1].size)) {
    console.log(`${(agg.size / 1048576).toFixed(2).padStart(8)} MB  ${String(agg.count).padStart(8)} nodes  ${type}`);
}

// The buildBackend banners open every bundle/chunk, so a retained source
// string is recognizable by its first characters.
const SOURCE_PREFIXES = [
    "const __bundleImportMetaUrl",                 // CJS bundle
    "import { createRequire as __bundleCreateRequire", // ESM bundle/chunk
];
const isSource = (s) => SOURCE_PREFIXES.some((p) => s.startsWith(p));

big.sort((a, b) => b.size - a.size);
let sourceBytes = 0;
let sourceCount = 0;
console.log(`\n=== strings >= ${(minBytes / 1024).toFixed(0)} KB ===`);
for (const n of big) {
    if (!n.type.includes("string")) {
        continue;
    }
    const s = snap.strings[n.nameIdx] ?? "";
    if (isSource(s)) {
        sourceBytes += n.size;
        sourceCount++;
    }
    // A one-byte source string weighs ~its file size; two-byte weighs double —
    // if a source string is ~2x its chunk's size on disk, the chunk contains
    // characters above U+00FF (see SKILL.md).
    const label = isSource(s) ? "SCRIPT SOURCE" : "string";
    console.log(`${(n.size / 1048576).toFixed(2).padStart(8)} MB  ${label.padEnd(14)} ${s.replace(/\s+/g, " ").slice(0, 90)}`);
}
console.log(`\nretained script source: ${(sourceBytes / 1048576).toFixed(2)} MB in ${sourceCount} strings`);
