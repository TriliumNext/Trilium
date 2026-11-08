/**
 * Prints the Langium grammar of a Mermaid diagram from `@mermaid-js/parser`, one rule per line.
 *
 *   npx tsx .claude/skills/developing-mermaid-highlighting/langium.mts [<Module>]
 *
 * Without an argument it lists the grammar modules (`RadarGrammarGeneratedModule`, …). Diagrams
 * missing from that list use a Jison or Chevrotain parser inside Mermaid's own chunks instead
 * (`node_modules/mermaid/dist/chunks/mermaid.core/<name>Diagram-*.mjs`): look for `rules: [` (Jison
 * lexer), `productions_` and `performAction` (Jison grammar), or `createToken(` and `this.RULE(`
 * (Chevrotain).
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

const CHUNKS = join(import.meta.dirname,
    "../../../node_modules/mermaid/node_modules/@mermaid-js/parser/dist/chunks/mermaid-parser.core");

interface Element {
    $type: string;
    cardinality?: string;
    elements?: Element[];
    value?: string;
    rule?: { ref?: { name: string } };
    feature?: string;
    operator?: string;
    terminal?: Element;
    type?: { ref?: { name: string } };
    regex?: string;
    left?: { value: string };
    right?: { value: string };
}

interface Rule {
    $type: string;
    name: string;
    fragment?: boolean;
    hidden?: boolean;
    definition: Element;
}

const modules: Record<string, { Grammar?: () => { rules: Rule[] } }> = {};
for (const file of readdirSync(CHUNKS).filter((name) => name.endsWith(".mjs"))) {
    Object.assign(modules, await import(join(CHUNKS, file)));
}

const [ name ] = process.argv.slice(2);
const grammar = name ? modules[name]?.Grammar?.() : undefined;
if (!grammar) {
    const names = Object.keys(modules).filter((key) => key.endsWith("GeneratedModule"));
    console.log(name ? `no grammar module "${name}"; these exist:` : "grammar modules:");
    console.log(names.join("\n"));
    process.exit(name ? 1 : 0);
}

for (const rule of grammar.rules) {
    const kind = [ rule.$type === "TerminalRule" && "terminal", rule.fragment && "fragment",
        rule.hidden && "hidden" ].filter(Boolean).join(" ");
    console.log(`${kind ? `${kind} ` : ""}${rule.name}: ${show(rule.definition)}`);
}

function show(element: Element): string {
    const card = element.cardinality ?? "";
    const children = (separator: string) => `(${(element.elements ?? []).map(show).join(separator)})${card}`;
    switch (element.$type) {
        case "Group": case "TerminalGroup": return children(" ");
        case "Alternatives": case "TerminalAlternatives": return children(" | ");
        case "UnorderedGroup": return children(" & ");
        case "Keyword": return JSON.stringify(element.value) + card;
        case "RuleCall": case "TerminalRuleCall": return (element.rule?.ref?.name ?? "?") + card;
        case "Assignment":
            return `${element.feature}${element.operator}${element.terminal ? show(element.terminal) : ""}${card}`;
        case "CrossReference": return `[${element.type?.ref?.name ?? "?"}]${card}`;
        case "RegexToken": return `/${element.regex}/${card}`;
        case "CharacterRange":
            return JSON.stringify(element.left?.value) + (element.right ? `..${JSON.stringify(element.right.value)}` : "") + card;
        default: return element.$type;
    }
}
