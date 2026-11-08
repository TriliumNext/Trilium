/**
 * Prints the Lezer parse tree of a Mermaid document, as one diagram's grammar sees it.
 *
 *   npx tsx .claude/skills/developing-mermaid-highlighting/tree.mts <diagram> '<input>' [--spans]
 *
 * <diagram> is a directory under packages/codemirror/src/languages/mermaid/parsers/ (`flowchart`,
 * `kanban`, …); `mermaid` parses with the top-level language, which mounts the diagram's grammar
 * the way the editor does. `\n`, `\r` and `\t` in <input> are unescaped. `--spans` also prints
 * every node with the text it covers, which a fixture's tree cannot show.
 */
import { join } from "node:path";

const PARSERS = join(import.meta.dirname, "../../../packages/codemirror/src/languages/mermaid");

const [ diagram, raw, flag ] = process.argv.slice(2);
if (!diagram || raw === undefined) {
    console.error("usage: tree.mts <diagram> '<input>' [--spans]");
    process.exit(1);
}

const input = raw.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
const { parser } = diagram === "mermaid"
    ? { parser: (await import(join(PARSERS, "index.ts"))).mermaidLanguage.parser }
    : await import(join(PARSERS, "parsers", diagram, "parser.ts"));

const tree = parser.parse(input);
console.log(tree.toString());

if (flag === "--spans") {
    tree.iterate({
        enter(node: { name: string; from: number; to: number; depth?: number }) {
            console.log(`  ${node.name.padEnd(24)} ${node.from}-${node.to}  ${JSON.stringify(input.slice(node.from, node.to))}`);
        }
    });
}
