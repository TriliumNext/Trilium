/**
 * Checks that a change leaves a grammar's parse trees alone, over a generated corpus.
 *
 *   npx tsx .claude/skills/developing-mermaid-highlighting/compare.mts record <diagram> <trees.json>
 *   (make the change, regenerate the parser if a grammar changed)
 *   npx tsx .claude/skills/developing-mermaid-highlighting/compare.mts check <diagram> <trees.json>
 *
 * The corpus recombines the lines of every input in test/<diagram>.txt: 2000 documents of up to
 * eight lines, deterministic, each also with CRLF line endings. A tree is compared node by node
 * with the range each covers, so a token that grows or shrinks counts as a change even when the
 * tree prints the same. `check` lists the documents whose tree changed. A clean result only means
 * something if the corpus reaches the code: break the changed line on purpose once and confirm
 * `check` reports differences.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../../../packages/codemirror/src/languages/mermaid");

const [ mode, diagram, treesPath ] = process.argv.slice(2);
if ((mode !== "record" && mode !== "check") || !diagram || !treesPath) {
    console.error("usage: compare.mts record|check <diagram> <trees.json>");
    process.exit(1);
}

const { parser } = diagram === "mermaid"
    ? { parser: (await import(join(ROOT, "index.ts"))).mermaidLanguage.parser }
    : await import(join(ROOT, "parsers", diagram, "parser.ts"));

const docs = buildCorpus(readFileSync(join(ROOT, "test", `${diagram}.txt`), "utf8"));
const trees = docs.map((doc) => serialize(parser.parse(doc)));

if (mode === "record") {
    writeFileSync(treesPath, JSON.stringify({ docs, trees }));
    console.log(`recorded ${trees.length} trees (${new Set(trees).size} distinct) to ${treesPath}`);
} else {
    const before: { docs: string[]; trees: string[] } = JSON.parse(readFileSync(treesPath, "utf8"));
    let changed = 0;
    for (const [ index, tree ] of trees.entries()) {
        if (tree === before.trees[index]) continue;
        changed++;
        if (changed <= 8) {
            console.log(`${JSON.stringify(docs[index])}\n  before: ${before.trees[index]}\n  after:  ${tree}`);
        }
    }
    console.log(changed ? `${changed} of ${trees.length} trees changed` : `all ${trees.length} trees identical`);
    process.exitCode = changed ? 1 : 0;
}

function serialize(tree: { iterate(spec: { enter(node: Node): void }): void }) {
    const nodes: string[] = [];
    tree.iterate({ enter: (node) => { nodes.push(`${node.name}@${node.from}-${node.to}`); } });
    return nodes.join(" ");
}

interface Node { name: string; from: number; to: number }

function buildCorpus(fixtures: string) {
    const inputs = fixtures.split(/^# .*$/m)
        .map((block) => block.split(/^==>$/m)[0].trim())
        .filter(Boolean);
    const header = inputs[0].split("\n")[0];
    const lines = [ ...new Set(inputs.flatMap((input) => input.split("\n").slice(1))) ];
    lines.push("", "  ", "\t");

    let seed = 2654435761;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = () => lines[Math.floor(random() * lines.length)];

    const docs: string[] = [ ...inputs ];
    while (docs.length < 2000) {
        const body = Array.from({ length: 1 + Math.floor(random() * 8) }, pick);
        const doc = [ header, ...body ].join("\n") + (random() < 0.5 ? "\n" : "");
        docs.push(doc, doc.replaceAll("\n", "\r\n"));
    }
    return docs;
}
