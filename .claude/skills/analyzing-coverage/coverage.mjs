#!/usr/bin/env node
// Unified Vitest/v8 coverage analyzer for the Trilium monorepo.
//
// Replaces the one-off scripts agents kept re-inventing (cov-analyze.mjs,
// cov-parse.mjs, cov-lines.mjs, cov-gaps.cjs). It auto-detects the coverage
// format and does the two things those scripts did:
//
//   summary  — list files below a coverage threshold + aggregate totals
//   gaps     — print the uncovered line/branch numbers for matched files
//              (so you know exactly what a new test must exercise)
//
// Supported inputs (auto-detected by content):
//   - lcov.info               (default `lcov` reporter — always present)
//   - coverage-summary.json   (`--coverage.reporter=json-summary`)
//   - coverage-final.json     (`--coverage.reporter=json`)
//
// summary works with any format. gaps needs per-line detail, so it works with
// lcov.info and coverage-final.json but NOT coverage-summary.json.
//
// Usage:
//   node coverage.mjs <coverage-file> [mode] [options]
//
// Modes:
//   summary        (default) files below threshold + aggregate
//   gaps           uncovered line/branch numbers for matched files
//
// Options:
//   --filter <s>   only files whose normalized path contains <s>.
//                  Repeatable, or comma-separated (matches ANY). Default: all.
//   --threshold N  summary: report files strictly below N% (default 100).
//   --metric M     summary cutoff metric: lines|branches|functions|any
//                  (default any — flag a file if ANY metric is below threshold).
//   --top N        limit listed files to the N worst.
//   --json         emit machine-readable JSON (for workflows / agents).
//   -h, --help     this help.
//
// Examples:
//   # Which trilium-core services are below 100%, worst first?
//   node coverage.mjs apps/server/test-output/vitest/coverage/lcov.info \
//        --filter packages/trilium-core/src/services
//
//   # Exactly which lines of bnote.ts still need a test?
//   node coverage.mjs apps/server/test-output/vitest/coverage/lcov.info gaps \
//        --filter becca/entities/bnote.ts
//
//   # Client entities/services summary as JSON for a workflow:
//   node coverage.mjs apps/client/test-output/vitest/coverage/lcov.info \
//        --filter src/services,src/entities --json

import { readFileSync } from "node:fs";

function parseArgs(argv) {
    const opts = { file: null, mode: "summary", filters: [], threshold: 100, metric: "any", top: Infinity, json: false };
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "-h" || a === "--help") opts.help = true;
        else if (a === "--json") opts.json = true;
        else if (a === "--filter") opts.filters.push(...argv[++i].split(","));
        else if (a === "--threshold") opts.threshold = Number(argv[++i]);
        else if (a === "--metric") opts.metric = argv[++i];
        else if (a === "--top") opts.top = Number(argv[++i]);
        else if (a === "summary" || a === "gaps") opts.mode = a;
        else if (a.startsWith("-")) { console.error(`Unknown flag: ${a}`); process.exit(2); }
        else rest.push(a);
    }
    // First positional is the coverage file; any extras are extra filters.
    if (rest.length) opts.file = rest.shift();
    opts.filters.push(...rest);
    opts.filters = opts.filters.map((f) => f.split("\\").join("/")).filter(Boolean);
    return opts;
}

// Make a coverage key into a stable, repo-relative display path.
function normalizePath(key) {
    let p = key.split("\\").join("/");
    while (p.startsWith("../")) p = p.slice(3);
    const m = p.match(/(?:^|\/)((?:apps|packages)\/.*)$/);
    return m ? m[1] : p.replace(/^\.\//, "");
}

function compressRanges(numbers) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const out = [];
    let start = null;
    let prev = null;
    for (const n of sorted) {
        if (start === null) { start = prev = n; continue; }
        if (n === prev + 1) { prev = n; continue; }
        out.push(start === prev ? `${start}` : `${start}-${prev}`);
        start = prev = n;
    }
    if (start !== null) out.push(start === prev ? `${start}` : `${start}-${prev}`);
    return out;
}

function pct(covered, total) {
    return total === 0 ? 100 : Math.round((covered / total) * 10000) / 100;
}

// ---- Format detection + parsing -> array of file records ----
// record: { path, lines:{covered,total,pct}, branches:{...}, functions:{...},
//           uncoveredLines:number[], uncoveredBranchLines:number[] }   (last two only when available)

function detectFormat(file, text) {
    if (file.endsWith(".info") || /^SF:/m.test(text)) return "lcov";
    const json = JSON.parse(text);
    const sample = Object.values(json).find((v) => v && typeof v === "object");
    if (sample && sample.statementMap) return "final";
    if (sample && sample.lines && typeof sample.lines.pct === "number") return "summary";
    if (json.total && json.total.lines) return "summary";
    throw new Error("Unrecognized JSON coverage shape (not coverage-summary.json or coverage-final.json).");
}

function parseLcov(text) {
    const records = [];
    for (const block of text.split("end_of_record")) {
        const sf = block.split("\n").find((l) => l.startsWith("SF:"));
        if (!sf) continue;
        const uncoveredLines = [];
        const uncoveredBranchLines = new Set();
        let lh = 0, lf = 0, fnh = 0, fnf = 0, brh = 0, brf = 0;
        for (const line of block.split("\n")) {
            if (line.startsWith("DA:")) {
                const [ln, hits] = line.slice(3).split(",");
                lf++;
                if (Number(hits) === 0) uncoveredLines.push(Number(ln)); else lh++;
            } else if (line.startsWith("BRDA:")) {
                const [ln, , , taken] = line.slice(5).split(",");
                if (taken === "0" || taken === "-") uncoveredBranchLines.add(Number(ln));
            } else if (line.startsWith("LH:")) lh = Number(line.slice(3));
            else if (line.startsWith("LF:")) lf = Number(line.slice(3));
            else if (line.startsWith("FNH:")) fnh = Number(line.slice(4));
            else if (line.startsWith("FNF:")) fnf = Number(line.slice(4));
            else if (line.startsWith("BRH:")) brh = Number(line.slice(4));
            else if (line.startsWith("BRF:")) brf = Number(line.slice(4));
        }
        records.push({
            path: normalizePath(sf.slice(3).trim()),
            lines: { covered: lh, total: lf, pct: pct(lh, lf) },
            branches: { covered: brh, total: brf, pct: pct(brh, brf) },
            functions: { covered: fnh, total: fnf, pct: pct(fnh, fnf) },
            uncoveredLines,
            uncoveredBranchLines: [...uncoveredBranchLines]
        });
    }
    return records;
}

function parseSummary(text) {
    const json = JSON.parse(text);
    const records = [];
    for (const [k, v] of Object.entries(json)) {
        if (k === "total" || !v || !v.lines) continue;
        records.push({
            path: normalizePath(k),
            lines: { covered: v.lines.covered, total: v.lines.total, pct: v.lines.pct },
            branches: { covered: v.branches.covered, total: v.branches.total, pct: v.branches.pct },
            functions: { covered: v.functions.covered, total: v.functions.total, pct: v.functions.pct }
            // no per-line detail -> gaps unavailable
        });
    }
    return records;
}

function parseFinal(text) {
    const json = JSON.parse(text);
    const records = [];
    for (const [k, data] of Object.entries(json)) {
        if (!data || !data.statementMap) continue;
        const uncovered = new Set();
        for (const [id, count] of Object.entries(data.s)) {
            if (count === 0) {
                const loc = data.statementMap[id];
                if (loc) for (let l = loc.start.line; l <= loc.end.line; l++) uncovered.add(l);
            }
        }
        for (const [id, count] of Object.entries(data.f)) {
            if (count === 0) {
                const fn = data.fnMap[id];
                const loc = fn && (fn.decl || fn.loc);
                if (loc) uncovered.add(loc.start.line);
            }
        }
        const uncoveredBranchLines = new Set();
        for (const [id, counts] of Object.entries(data.b)) {
            const bm = data.branchMap[id];
            if (!bm) continue;
            counts.forEach((c, i) => {
                if (c !== 0) return;
                const loc = (bm.locations && bm.locations[i]) || bm.loc;
                if (loc && loc.start && typeof loc.start.line === "number") uncoveredBranchLines.add(loc.start.line);
            });
        }
        // Line totals from the statement map.
        const lineHit = new Map();
        for (const [id, count] of Object.entries(data.s)) {
            const loc = data.statementMap[id];
            if (!loc) continue;
            for (let l = loc.start.line; l <= loc.end.line; l++) {
                lineHit.set(l, (lineHit.get(l) || 0) || count);
            }
        }
        const lTotal = lineHit.size;
        const lCovered = [...lineHit.values()].filter((c) => c > 0).length;
        const fIds = Object.values(data.f);
        const bCounts = Object.values(data.b).flat();
        records.push({
            path: normalizePath(k),
            lines: { covered: lCovered, total: lTotal, pct: pct(lCovered, lTotal) },
            branches: { covered: bCounts.filter((c) => c > 0).length, total: bCounts.length, pct: pct(bCounts.filter((c) => c > 0).length, bCounts.length) },
            functions: { covered: fIds.filter((c) => c > 0).length, total: fIds.length, pct: pct(fIds.filter((c) => c > 0).length, fIds.length) },
            uncoveredLines: [...uncovered],
            uncoveredBranchLines: [...uncoveredBranchLines]
        });
    }
    return records;
}

function loadRecords(file) {
    const text = readFileSync(file, "utf8");
    const fmt = detectFormat(file, text);
    const records = fmt === "lcov" ? parseLcov(text) : fmt === "summary" ? parseSummary(text) : parseFinal(text);
    return { fmt, records };
}

function applyFilter(records, filters) {
    if (!filters.length) return records;
    return records.filter((r) => filters.some((f) => r.path.includes(f)));
}

function isBelow(r, metric, threshold) {
    // A file with no executable lines/branches/functions can't be "below" — skip it.
    if (r.lines.total === 0 && r.branches.total === 0 && r.functions.total === 0) return false;
    if (metric === "any") return r.lines.pct < threshold || r.branches.pct < threshold || r.functions.pct < threshold;
    return r[metric].pct < threshold;
}

// ---- Output ----

function runSummary(records, opts, fmt) {
    const matched = applyFilter(records, opts.filters);
    const below = matched.filter((r) => isBelow(r, opts.metric, opts.threshold))
        .sort((a, b) => a.lines.pct - b.lines.pct || b.lines.total - a.lines.total)
        .slice(0, opts.top);
    const agg = (key) => {
        const c = matched.reduce((s, r) => s + r[key].covered, 0);
        const t = matched.reduce((s, r) => s + r[key].total, 0);
        return { covered: c, total: t, pct: pct(c, t) };
    };
    const totals = { lines: agg("lines"), branches: agg("branches"), functions: agg("functions") };

    if (opts.json) {
        console.log(JSON.stringify({ format: fmt, threshold: opts.threshold, metric: opts.metric, fileCount: matched.length, belowCount: matched.filter((r) => isBelow(r, opts.metric, opts.threshold)).length, totals, below: below.map((r) => ({ path: r.path, lines: r.lines.pct, branches: r.branches.pct, functions: r.functions.pct, coveredLines: r.lines.covered, totalLines: r.lines.total })) }, null, 2));
        return;
    }

    console.log(`Below ${opts.threshold}% (metric: ${opts.metric})   L=lines B=branches F=functions   [format: ${fmt}]`);
    console.log(`${"L%".padStart(7)} ${"B%".padStart(7)} ${"F%".padStart(7)}  lines       file`);
    for (const r of below) {
        console.log(`${String(r.lines.pct).padStart(6)}% ${String(r.branches.pct).padStart(6)}% ${String(r.functions.pct).padStart(6)}%  ${(r.lines.covered + "/" + r.lines.total).padEnd(10)}  ${r.path}`);
    }
    if (!below.length) console.log("  (none — everything at/above threshold)");
    console.log(`\nAggregate over ${matched.length} matched file(s):`);
    for (const k of ["lines", "branches", "functions"]) {
        console.log(`  ${k.padEnd(10)} ${totals[k].pct.toFixed(2)}%  (${totals[k].covered}/${totals[k].total})`);
    }
    console.log(`Files below ${opts.threshold}%: ${matched.filter((r) => isBelow(r, opts.metric, opts.threshold)).length} of ${matched.length}`);
}

function runGaps(records, opts, fmt) {
    if (fmt === "summary") {
        console.error("gaps mode needs per-line detail, but coverage-summary.json has none.");
        console.error("Re-run coverage with the default `lcov` reporter (lcov.info) or `--coverage.reporter=json` (coverage-final.json).");
        process.exit(2);
    }
    if (!opts.filters.length) {
        console.error("gaps mode requires --filter (or a positional file substring) to pick which file(s) to report.");
        process.exit(2);
    }
    const matched = applyFilter(records, opts.filters);
    if (opts.json) {
        console.log(JSON.stringify(matched.map((r) => ({ path: r.path, lines: r.lines.pct, coveredLines: r.lines.covered, totalLines: r.lines.total, uncoveredLines: compressRanges(r.uncoveredLines), uncoveredBranchLines: compressRanges(r.uncoveredBranchLines) })), null, 2));
        return;
    }
    if (!matched.length) { console.log("(no files matched the filter)"); return; }
    for (const r of matched) {
        const fns = r.functions.total ? `, fns ${r.functions.covered}/${r.functions.total}` : "";
        console.log(`\n### ${r.path}  —  lines ${r.lines.pct}% (${r.lines.covered}/${r.lines.total})${fns}`);
        const lines = compressRanges(r.uncoveredLines);
        const branches = compressRanges(r.uncoveredBranchLines);
        if (!lines.length && !branches.length) { console.log("  ✅ fully covered"); continue; }
        if (lines.length) console.log(`  uncovered lines:        ${lines.join(", ")}`);
        if (branches.length) console.log(`  uncovered branch lines: ${branches.join(", ")}`);
    }
}

function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help || !opts.file) {
        console.log(readFileSync(new URL(import.meta.url)).toString().split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
        process.exit(opts.help ? 0 : 2);
    }
    let loaded;
    try {
        loaded = loadRecords(opts.file);
    } catch (e) {
        console.error(`Failed to read/parse ${opts.file}: ${e.message}`);
        process.exit(1);
    }
    if (opts.mode === "gaps") runGaps(loaded.records, opts, loaded.fmt);
    else runSummary(loaded.records, opts, loaded.fmt);
}

main();
