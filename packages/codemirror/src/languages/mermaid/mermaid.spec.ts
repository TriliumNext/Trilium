import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { toggleComment } from "@codemirror/commands";
import { foldable, LanguageSupport } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { NodeProp } from "@lezer/common";
import { fileTests } from "@lezer/generator/test";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import type { LRParser } from "@lezer/lr";
import { describe, expect, it } from "vitest";

import { buildGrammar, listGrammars } from "../../../scripts/build_mermaid_grammars.mjs";
import { DIAGRAM_PARSERS, foldByIndent, mermaid, mermaidLanguage } from "./index.js";

const grammars = listGrammars();
const diagrams = grammars.map((grammarPath) => basename(dirname(grammarPath)));
const parsers = import.meta.glob<LRParser>("./parsers/*/parser.ts", {
    eager: true,
    import: "parser"
});
const parserOf = (diagram: string) => diagram === "mermaid"
    ? mermaidLanguage.parser
    : parsers[`./parsers/${diagram}/parser.ts`];

describe("Mermaid grammars", () => {
    it("has a committed parser that matches each grammar", () => {
        expect(grammars.length).toBeGreaterThan(0);
        for (const grammarPath of grammars) {
            for (const [ path, content ] of Object.entries(buildGrammar(grammarPath))) {
                // Run `pnpm --filter @triliumnext/codemirror build:mermaid-grammars` to regenerate.
                expect(readFileSync(path, "utf8"), path).toBe(content);
            }
        }
    });

    it("wires the parser of every diagram into the top-level language", () => {
        const { AgentflowDiagram, ...ownGrammars } = DIAGRAM_PARSERS;
        const wired = new Set(Object.values(ownGrammars));
        for (const diagram of diagrams.filter((name) => name !== "mermaid")) {
            expect(wired.has(parserOf(diagram)), diagram).toBe(true);
        }
        expect(wired.size).toBe(diagrams.length - 1);
        // Agent flow is the flowchart grammar in its `agentflow` dialect.
        expect(AgentflowDiagram.nodeSet).toBe(parserOf("flowchart").nodeSet);
    });
});

describe.each(diagrams)("%s grammar", (diagram) => {
    const parser = parserOf(diagram);
    const fileName = `${diagram}.txt`;
    const file = readFileSync(join(import.meta.dirname, "test", fileName), "utf8");

    for (const { name, run } of fileTests(file, fileName)) {
        it(name, () => run(parser));
    }
});

describe("mermaid", () => {
    it("detects the diagram type and parses the rest with that diagram's grammar", () => {
        const support = mermaid();
        expect(support).toBeInstanceOf(LanguageSupport);
        expect(support.language).toBe(mermaidLanguage);

        const tree = mermaidLanguage.parser.parse("%%{init: {}}%%\n\npie\n  \"A\": 1\n");
        expect(tree.toString())
            .toBe("MermaidDiagram(Directive,PieDiagram(DiagramName,String,Number))");
        expect(mermaidLanguage.parser.parse("not a diagram\n").toString())
            .toBe("MermaidDiagram(⚠)");
    });

    it("accepts whitespace after front matter dashes and directives", () => {
        // Kept out of the `.txt` fixtures, where an editor can strip trailing whitespace.
        const tree = (doc: string) => mermaidLanguage.parser.parse(doc).toString();
        const doc = "---\nconfig:\n  gantt: {}\n---\n%%{init: {}}%%\nsequenceDiagram\n  A->>B: hi";
        expect(tree(doc)).toContain("FrontMatter");
        expect(tree(doc)).toContain("Directive");
        const padded = doc.replace("---\n", "--- \t\n").replace("\n---", "\n---  ")
            .replace("}%%", "}%% \t");
        expect(tree(padded)).toBe(tree(doc));
    });

    it("toggles # comments in the front matter and %% comments in the diagram", () => {
        const doc = "---\ntitle: x\n---\nflowchart\n    A --> B";
        const state = EditorState.create({ doc, extensions: [ mermaid() ] });
        const view = new EditorView({ state });
        const cases = [ [ 2, "# title: x" ], [ 5, "    %% A --> B" ] ] as const;
        for (const [ lineNumber, commented ] of cases) {
            view.dispatch({ selection: { anchor: view.state.doc.line(lineNumber).from } });
            expect(toggleComment(view), commented).toBe(true);
            expect(view.state.doc.line(lineNumber).text).toBe(commented);
            toggleComment(view);
            expect(view.state.doc.toString()).toBe(doc);
        }
        view.destroy();
    });

    it("parses Windows line endings like Unix ones", () => {
        // Kept out of the `.txt` fixtures, where Git normalizes CRLF to LF.
        const tree = (doc: string) => mermaidLanguage.parser.parse(doc).toString();
        const docs = [
            "mindmap\n  root\n  \n    child\n", "mindmap\n#x\n  \n", "---\na: 1\n---\npie"
        ];
        for (const unix of docs) {
            expect(tree(unix.replaceAll("\n", "\r\n")), JSON.stringify(unix)).toBe(tree(unix));
        }
    });
});

describe("accessibility lines", () => {
    // The diagrams whose Mermaid parser stores accTitle and accDescr; the others read them as
    // content or reject them.
    const docs = [
        "flowchart LR\n  A --> B", "sequenceDiagram\n  A->>B: hi", "classDiagram\n  class A",
        "stateDiagram-v2\n  [*] --> A", "erDiagram\n  A ||--o{ B : has", "gantt\n  title X",
        "pie\n  \"A\": 1", "journey\n  title X", "gitGraph\n  commit",
        "requirementDiagram\n  requirement r {\n    id: 1\n  }", "C4Context\n  Person(a, \"A\")",
        "quadrantChart\n  x-axis A --> B", "xychart-beta\n  bar [1, 2]",
        "packet-beta\n  0-15: \"A\"", "architecture-beta\n  service a(server)[A]",
        "radar-beta\n  axis a", "treemap-beta\n  \"A\": 1",
        "treeView-beta\n  src", "wardley-beta\n  anchor A [0.5, 0.5]",
        "cynefin-beta\n  complex", "railroad-beta\n  a = terminal(\"x\");",
        "railroad-ebnf-beta\n  a = \"x\";", "railroad-abnf-beta\n  a = \"x\";",
        "railroad-peg-beta\n  a <- \"x\";", "usecase-beta\n  actor User"
    ];
    const lines = [
        "  accTitle: My title", "  accDescr: My description", "  accDescr {\n    Line one\n  }"
    ].join("\n");

    it("highlights them and the diagram around them", () => {
        const doc = "flowchart LR\n  accTitle: My title\n  A --> B";
        const tree = mermaidLanguage.parser.parse(doc);
        const classes: Record<string, string> = {};
        highlightTree(tree, classHighlighter, (from, to, style) => {
            classes[doc.slice(from, to)] = style;
        });
        expect(classes).toMatchObject({
            "flowchart": "tok-typeName",
            "accTitle": "tok-keyword",
            "My title": "tok-string",
            "A": "tok-variableName"
        });
    });

    it.each(docs)("leaves them out of the diagram grammar in %j", (doc) => {
        const [ header, ...body ] = doc.split("\n");
        const withLines = [ header, lines, ...body ].join("\n");
        const blanked = [ header, lines.replace(/[^\n]/g, ""), ...body ].join("\n");

        const tree = mermaidLanguage.parser.parse(withLines);
        expect(tree.toString()).toContain("AccTitle(Keyword,\":\",AccText),"
            + "AccDescr(Keyword,\":\",AccText),AccDescr(Keyword,\"{\",AccText,\"}\")");
        const mounted = tree.topNode.lastChild?.tree?.prop(NodeProp.mounted);
        expect(mounted?.overlay).toBeTruthy();
        expect(`MermaidDiagram(${mounted?.tree.toString()})`)
            .toBe(mermaidLanguage.parser.parse(blanked).toString());
        expect(mounted?.tree.toString()).not.toContain("⚠");
    });
});

describe("shape metadata", () => {
    const key = "tok-propertyName tok-definition";
    const metadata = "A@{ shape: rect, label: \"Start\" }\n  B@{\n    shape: tool\n  }";

    it.each([
        `flowchart TB\n  ${metadata}`, `agentflow-beta TB\n  ${metadata}`,
        `kanban\n  todo\n    ${metadata.replaceAll("@", "[Task]@")}`
    ])("highlights the YAML inside @{ } in %j", (doc) => {
        expect(styles(doc).filter((style) => /^(@\{?|shape|label|"Start") /.test(style))).toEqual([
            "@ tok-meta", `shape ${key}`, `label ${key}`, "\"Start\" tok-string", "@{ tok-meta",
            `shape ${key}`
        ]);
    });

    it("reads unclosed kanban metadata to the end as a block mapping", () => {
        expect(styles("kanban\n  todo\n    A[Task]@{ priority: high")).toContain(`priority ${key}`);
        expect(styles("kanban\n  todo\n    A[Task]@{").at(-1)).toBe("@{ tok-meta");
    });
});

describe("requirement highlighting", () => {
    it("colours names, keys and values apart", () => {
        const doc = [
            "requirementDiagram", "  requirement test_req {", "    id: 1",
            "    text: the test text.", "    risk: high", "  }", "  element \"test entity\" {",
            "    type: simulation", "  }", "  test_entity - satisfies -> test_req"
        ].join("\n");
        const diagramKeywords = /^(requirementDiagram|requirement|element|-|->) /;
        expect(styles(doc).filter((style) => !diagramKeywords.test(style))).toEqual([
            "test_req tok-variableName", "{ tok-punctuation", "id tok-propertyName",
            ": tok-punctuation", "1 tok-number", "text tok-propertyName", ": tok-punctuation",
            "the test text. tok-string", "risk tok-propertyName", ": tok-punctuation",
            "high tok-keyword", "} tok-punctuation", "\"test entity\" tok-variableName",
            "{ tok-punctuation", "type tok-propertyName", ": tok-punctuation",
            "simulation tok-string", "} tok-punctuation", "test_entity tok-variableName",
            "satisfies tok-keyword", "test_req tok-variableName"
        ]);
    });
});

describe("mindmap highlighting", () => {
    it("colours each node by its level, and ids, shapes, icons and classes apart", () => {
        const doc = [
            "mindmap", "  root((mindmap))", "    Origins", "      Long history",
            "      ::icon(fa fa-book)", "      :::urgent", "        Buzan", "    Research",
            "      Automatic creation", "        Uses", "            Argument mapping",
            "              Pen and paper", "    id[Tools]"
        ].join("\n");
        expect(styles(doc)).toEqual([
            "mindmap tok-typeName", "root tok-variableName", "(( tok-punctuation",
            "mindmap tok-keyword", ")) tok-punctuation", "Origins tok-typeName",
            "Long history tok-string", ":: tok-punctuation", "icon tok-keyword",
            "( tok-punctuation", "fa fa-book tok-atom", ") tok-punctuation",
            "::: tok-punctuation", "urgent tok-className", "Buzan tok-number",
            "Research tok-typeName", "Automatic creation tok-string", "Uses tok-number",
            "Argument mapping tok-propertyName", "Pen and paper tok-keyword",
            "id tok-variableName", "[ tok-punctuation", "Tools tok-typeName", "] tok-punctuation"
        ]);
    });
});

describe("kanban grammar", () => {
    it("ends a card id before the spaces that separate it from its text", () => {
        const doc = "kanban\n  todo\n    my-card  [Task]";
        const id = parserOf("kanban").parse(doc).topNode.getChild("Card")?.getChild("NodeId");
        expect(id && doc.slice(id.from, id.to)).toBe("my-card");
    });
});

describe("radar grammar", () => {
    it("ends a title at a comment and leaves out the spaces around it", () => {
        const doc = "radar-beta\n  title  Grades \t%% note\n  title\r\n  axis a";
        const tree = parserOf("radar").parse(doc);
        const titles = tree.topNode.getChildren("Title").map((title) => {
            const text = title.getChild("TitleText");
            return text && doc.slice(text.from, text.to);
        });
        expect(titles).toEqual([ "Grades", null ]);
    });
});

describe("treemap grammar", () => {
    it("ends the styles of a classDef before its semicolon and the spaces around them", () => {
        const doc = "treemap\nclassDef hot  fill:#f00 ;\nclassDef cold\n\"A\": 1";
        const tree = parserOf("treemap").parse(doc);
        const styles = tree.topNode.getChildren("ClassDef").map((classDef) => {
            const text = classDef.getChild("Styles");
            return text && doc.slice(text.from, text.to);
        });
        expect(styles).toEqual([ "fill:#f00", null ]);
    });
});

describe("ishikawa grammar", () => {
    it("leaves the spaces after a line out of its node", () => {
        const doc = "ishikawa-beta\n  Blurry photo \t\n  Process";
        const effect = parserOf("ishikawa").parse(doc).topNode.getChild("Effect");
        expect(effect && doc.slice(effect.from, effect.to)).toBe("Blurry photo");
    });
});

describe("foldByIndent", () => {
    function foldAt(doc: string, lineNumber: number) {
        const state = EditorState.create({ doc, extensions: [ foldByIndent() ] });
        const line = state.doc.line(lineNumber);
        const range = foldable(state, line.from, line.to);
        return range && state.sliceDoc(range.from, range.to);
    }

    it("folds the more deeply indented lines that follow, across blank lines", () => {
        const doc = "mindmap\n  root\n    a\n\n    b\n  next\n";
        expect(foldAt(doc, 2)).toBe("\n    a\n\n    b");
        expect(foldAt(doc, 1)).toBe("\n  root\n    a\n\n    b\n  next");
    });

    it("counts a tab as four spaces", () => {
        expect(foldAt("root\n\tchild\n    sibling\n", 2)).toBeNull();
        expect(foldAt("root\n\tchild\n      grandchild\n", 2)).toBe("\n      grandchild");
    });

    it("does not fold a blank line or a line with nothing nested under it", () => {
        expect(foldAt("a\n\n  b\n", 2)).toBeNull();
        expect(foldAt("a\nb\n", 1)).toBeNull();
        expect(foldAt("a", 1)).toBeNull();
    });
});

/** Each highlighted range of `doc` as its text and classes, in document order. */
function styles(doc: string) {
    const result: string[] = [];
    highlightTree(mermaidLanguage.parser.parse(doc), classHighlighter, (from, to, style) => {
        result.push(`${doc.slice(from, to)} ${style}`);
    });
    return result;
}
