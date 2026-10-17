/**
 * Turns test cases into Lezer fixture blocks, with the expected tree taken from the current parser.
 *
 *   npx tsx .claude/skills/developing-mermaid-highlighting/fixtures.mts <cases.json> [--append]
 *
 * <cases.json> holds `[diagram, name, input][]`, e.g.
 *   [["kanban", "Card id with a hyphen", "kanban\n  todo\n    my-card[Task]"]]
 * Without `--append` the blocks are printed for review; with it they are appended to
 * test/<diagram>.txt. Review every tree before appending: the parser's current output is what the
 * fixture will then require, wrong or not.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../../../packages/codemirror/src/languages/mermaid");

const [ casesPath, flag ] = process.argv.slice(2);
if (!casesPath) {
    console.error("usage: fixtures.mts <cases.json> [--append]");
    process.exit(1);
}

const cases: [string, string, string][] = JSON.parse(readFileSync(casesPath, "utf8"));
for (const [ diagram, name, input ] of cases) {
    if (input.includes("\r")) {
        console.error(`skipped "${name}": Git normalizes CRLF in fixtures, test it in mermaid.spec.ts`);
        continue;
    }
    const { parser } = diagram === "mermaid"
        ? { parser: (await import(join(ROOT, "index.ts"))).mermaidLanguage.parser }
        : await import(join(ROOT, "parsers", diagram, "parser.ts"));
    const block = `# ${name}\n\n${input}\n\n==>\n\n${parser.parse(input).toString()}\n`;

    if (flag === "--append") {
        appendFileSync(join(ROOT, "test", `${diagram}.txt`), `\n${block}`);
        console.log(`appended to test/${diagram}.txt: ${name}`);
    } else {
        console.log(`--- test/${diagram}.txt\n${block}`);
    }
}
