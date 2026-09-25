/**
 * Aggregates a V8 `.cpuprofile` by self time, so the output names the functions actually burning
 * the CPU rather than the call tree that reached them.
 *
 *   node --import tsx apps/server/bench-profile.mts <profile.cpuprofile> [topN]
 */

import fs from "fs";
import path from "path";

interface CallFrame {
    functionName: string;
    url: string;
    lineNumber: number;
}

interface ProfileNode {
    id: number;
    callFrame: CallFrame;
    children?: number[];
}

interface Profile {
    nodes: ProfileNode[];
    samples: number[];
    timeDeltas: number[];
}

const [ profilePath, topArg ] = process.argv.slice(2);
const TOP = Number(topArg ?? 30);

if (!profilePath) {
    console.error("usage: bench-profile.mts <profile.cpuprofile> [topN]");
    process.exit(1);
}

const profile: Profile = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
const nodesById = new Map(profile.nodes.map((node) => [ node.id, node ]));

// Self time per node: a sample is attributed to the frame that was executing when it was taken.
const selfMicrosByNode = new Map<number, number>();
let totalMicros = 0;

for (const [ index, nodeId ] of profile.samples.entries()) {
    const delta = profile.timeDeltas[index] ?? 0;
    if (delta <= 0) {
        continue;
    }

    selfMicrosByNode.set(nodeId, (selfMicrosByNode.get(nodeId) ?? 0) + delta);
    totalMicros += delta;
}

function label(frame: CallFrame) {
    const name = frame.functionName || "(anonymous)";
    if (!frame.url) {
        return name;
    }

    const file = frame.url.startsWith("file://") ? path.relative(process.cwd(), frame.url.slice(7)) : frame.url;
    return `${name}  ${file}:${frame.lineNumber + 1}`;
}

// Several nodes can share a call frame (the same function reached by different paths), so fold them.
const selfMicrosByFrame = new Map<string, number>();

for (const [ nodeId, micros ] of selfMicrosByNode) {
    const node = nodesById.get(nodeId);
    if (!node) {
        continue;
    }

    const key = label(node.callFrame);
    selfMicrosByFrame.set(key, (selfMicrosByFrame.get(key) ?? 0) + micros);
}

const attributeTo = process.argv[4] ?? "";
const skip = new Set((process.argv[5] ?? "").split(",").filter(Boolean));

// "children:<fn>" breaks that function's subtree down by direct callee, which says where a phase
// spends its time rather than which leaf is hottest.
if (attributeTo.startsWith("children:")) {
    // "children:execute@note_flat_text" narrows to one file, since a name like `execute` is
    // implemented by every expression type.
    const [ target, inFile ] = attributeTo.slice("children:".length).split("@");
    const matches = (frame: CallFrame) =>
        frame.functionName === target && (!inFile || frame.url.includes(inFile));

    const totalOf = new Map<number, number>();
    const totalFor = (id: number): number => {
        const cached = totalOf.get(id);
        if (cached !== undefined) {
            return cached;
        }

        const node = nodesById.get(id);
        let total = selfMicrosByNode.get(id) ?? 0;
        for (const child of node?.children ?? []) {
            total += totalFor(child);
        }

        totalOf.set(id, total);
        return total;
    };

    const byChild = new Map<string, number>();
    let ownSelf = 0;
    let subtree = 0;

    for (const node of profile.nodes) {
        if (!matches(node.callFrame)) {
            continue;
        }

        ownSelf += selfMicrosByNode.get(node.id) ?? 0;
        subtree += totalFor(node.id);

        for (const child of node.children ?? []) {
            const childNode = nodesById.get(child);
            if (!childNode) {
                continue;
            }

            const key = label(childNode.callFrame);
            byChild.set(key, (byChild.get(key) ?? 0) + totalFor(child));
        }
    }

    console.log(`${target}: ${(subtree / 1000).toFixed(1)}ms subtree, ${(ownSelf / 1000).toFixed(1)}ms self\n`);
    for (const [ name, micros ] of [ ...byChild.entries() ].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
        console.log(`${(micros / 1000).toFixed(1).padStart(9)}  ${((micros / subtree) * 100).toFixed(1).padStart(5)}  ${name}`);
    }
    process.exit(0);
}

// With a function name as the third argument, attribute that function's self time to whoever
// called it, which says why a hot leaf is hot rather than merely that it is.

if (attributeTo) {
    const parentOf = new Map<number, number>();
    for (const node of profile.nodes) {
        for (const child of node.children ?? []) {
            parentOf.set(child, node.id);
        }
    }

    const byCaller = new Map<string, number>();
    let attributed = 0;

    for (const [ nodeId, micros ] of selfMicrosByNode) {
        const node = nodesById.get(nodeId);
        if (node?.callFrame.functionName !== attributeTo) {
            continue;
        }

        // Walk past thin wrappers so the blame lands on code that chose to normalize, not on the
        // one-line helper it went through.
        let ancestor = parentOf.get(nodeId);
        while (ancestor !== undefined && skip.has(nodesById.get(ancestor)?.callFrame.functionName ?? "")) {
            ancestor = parentOf.get(ancestor);
        }

        const parent = ancestor === undefined ? undefined : nodesById.get(ancestor);
        const key = parent ? label(parent.callFrame) : "(root)";
        byCaller.set(key, (byCaller.get(key) ?? 0) + micros);
        attributed += micros;
    }

    console.log(`${attributeTo}: ${(attributed / 1000).toFixed(1)}ms self time, by caller\n`);
    for (const [ name, micros ] of [ ...byCaller.entries() ].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
        console.log(`${(micros / 1000).toFixed(1).padStart(9)}  ${((micros / attributed) * 100).toFixed(1).padStart(5)}  ${name}`);
    }
    process.exit(0);
}

const ranked = [ ...selfMicrosByFrame.entries() ].sort((a, b) => b[1] - a[1]).slice(0, TOP);

console.log(`total sampled: ${(totalMicros / 1000).toFixed(1)}ms across ${profile.samples.length} samples\n`);
console.log(`${"self ms".padStart(9)}  ${"%".padStart(5)}  function`);

for (const [ name, micros ] of ranked) {
    const ms = (micros / 1000).toFixed(1).padStart(9);
    const share = ((micros / totalMicros) * 100).toFixed(1).padStart(5);
    console.log(`${ms}  ${share}  ${name}`);
}
