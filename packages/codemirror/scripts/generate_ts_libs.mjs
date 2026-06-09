// Regenerates src/type_completion/ts_lib_files.ts — the LIST of TypeScript
// lib.*.d.ts files (the transitive closure for target ES2020, lib ["es2020",
// "dom"]) that the in-browser language service loads, imported as raw text so it
// works offline (no CDN).
//
// The file content is resolved at build time from the installed `typescript`, so
// a normal TS upgrade needs no regeneration. Only re-run this when a TS upgrade
// changes which lib files exist in the closure, or when changing the target lib:
//   node scripts/generate_ts_libs.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const libDir = dirname(require.resolve("typescript/lib/lib.es5.d.ts"));
const OUT = new URL("../src/type_completion/ts_lib_files.ts", import.meta.url);

// Entry libs for `lib: ["es2020", "dom"]`; follow /// <reference lib="…"/> transitively.
const ENTRIES = ["lib.es2020.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"];
const REFERENCE = /\/\/\/\s*<reference\s+lib=["']([^"']+)["']\s*\/>/g;

const seen = new Set();
function visit(name) {
    if (seen.has(name)) return;
    const file = join(libDir, name);
    if (!existsSync(file)) return; // skip legacy phantom names (lib.core.*, lib.es6, …)
    seen.add(name);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(REFERENCE)) {
        visit(`lib.${match[1]}.d.ts`);
    }
}
ENTRIES.forEach(visit);

const files = [...seen].sort();
const ident = (name) => `_${name.replace(/[.]/g, "_")}`;

let out = "// AUTO-GENERATED — do not edit by hand.\n";
out += "// The transitive closure of TypeScript lib.*.d.ts for target ES2020 + lib [\"es2020\", \"dom\"],\n";
out += "// imported as raw text so the language service works offline (no CDN). These ship in the\n";
out += "// lazy script-editor chunk.\n";
out += "//\n";
out += "// Only the file LIST is pinned here. The .d.ts CONTENT is read from the installed `typescript`\n";
out += "// at build time (via ?raw), so it tracks the installed version automatically. Re-run\n";
out += "// scripts/generate_ts_libs.mjs only if a TypeScript upgrade changes which lib files exist in\n";
out += "// this set — a removed/renamed file fails the build loudly; an added one is silently missing.\n\n";
files.forEach((name) => { out += `import ${ident(name)} from "typescript/lib/${name}?raw";\n`; });
out += "\n/** Map of vfs path (\"/lib.*.d.ts\") to file contents. */\n";
out += "export const tsLibFiles: Record<string, string> = {\n";
files.forEach((name) => { out += `    "/${name}": ${ident(name)},\n`; });
out += "};\n";

writeFileSync(OUT, out);
console.log(`Wrote ${files.length} lib files to ${OUT.pathname}`);
