---
name: developing-mermaid-highlighting
description: Use when changing how Mermaid diagram source is highlighted in Trilium's code editor — the Lezer grammars vendored in `packages/codemirror/src/languages/mermaid/` (`parsers/<diagram>/<diagram>.grammar`, `tokens.ts`, `highlight.ts`, `tags/`, the `mermaid` dispatcher grammar, `index.ts`), adding highlighting for a diagram type a newer Mermaid adds (from its Langium, Jison or Chevrotain parser), fixing a diagram that highlights wrongly, the `test/<diagram>.txt` fixtures, `scripts/build_mermaid_grammars.mts`, or the `text/vnd.mermaid` entry and the Markdown code-block wiring (`buildMarkdown()`) in `syntax_highlighting.ts`. Covers regenerating the committed parsers, the checklist for a new diagram type, the Lezer traps already hit (precedence beats length, external-tokenizer order, CRLF), and how to prove a grammar change (fixtures first, real Mermaid as the referee, tree comparison over a generated corpus). Includes tree.mts, fixtures.mts, compare.mts and langium.mts — don't write new parse-tree probes.
---

# Developing Mermaid syntax highlighting

A Mermaid note is highlighted by a Lezer language in `packages/codemirror/src/languages/mermaid/`,
loaded by `syntax_highlighting.ts` for the `text/vnd.mermaid` and `text/mermaid` MIME types. In
Markdown, `buildMarkdown()` there mounts it on ` ```mermaid ` code blocks through a
`LanguageDescription` listed ahead of `@codemirror/language-data`'s languages, which have no
Mermaid; `foldByIndent()` stays off there, since it folds by indentation across the whole document.

The language was vendored from
[Edge-Tools/codemirror-lang-mermaid](https://github.com/Edge-Tools/codemirror-lang-mermaid) at
`03bcd7d`, itself a fork of inspirnathan's `codemirror-lang-mermaid`. Both upstreams are dormant:
**the code is ours now**. Never re-vendor over it;
`git log -- packages/codemirror/src/languages/mermaid` shows what changed after the verbatim copy
and why.

## Layout

```
languages/mermaid/
  index.ts              mermaid(), mermaidLanguage, DIAGRAM_PARSERS; re-exports foldByIndent()
  extensions/index.ts   foldByIndent() — folds a line with the deeper-indented lines after it
  tags/index.ts         highlight tags, one set per diagram
  parsers/mermaid/      the dispatcher: detects the diagram type from the first meaningful line
  parsers/<diagram>/    <diagram>.grammar, tokens.ts (external tokenizers, optional),
                        highlight.ts (styleTags), parser.ts + parser.terms.ts (GENERATED)
  parsers/line_text.ts  lineText(): the "rest of the line after a keyword" tokenizer (titles, styles)
  test/<diagram>.txt    Lezer fixtures, one file per parsers/ directory, same name
  mermaid.spec.ts       runs every fixture file, checks generated parsers are current
  LICENSE               MIT notices of codemirror-lang-mermaid, @mermaid-js/parser and Mermaid
                        — keep them
```

How a document parses: `mermaid.grammar` first takes the front matter, the way Mermaid does: a `---`
line at the very start of the document, opening only when a closing `---` line follows. Its
`frontMatter` tokenizer (`parsers/mermaid/tokens.ts`) emits a `FrontMatter` node, and `parseMixed()`
in `index.ts` mounts the YAML parser of `@codemirror/lang-yaml` on its content, so the tree shows
YAML's `Stream` there. The front matter must be its own token, not lines for diagram detection:
Mermaid's config keys (`flowchart:`, `gantt:`, `block:`, …) start with diagram keywords. The rest of
the preamble is `Directive`s (`%%{…}%%`, which can span lines), `LineComment`s and blank
`preDiagramLine`s, then the `diagramText` tokenizer matches the first other line against
`diagramMap` and emits one node for the rest of the document, such as `FlowchartDiagram`.
`parseMixed()` looks that node's name up in `DIAGRAM_PARSERS` and mounts the diagram's own parser
over it. A diagram with no entry there, or a keyword missing from `diagramMap`, gets no highlighting
at all. Every diagram parser is in turn wrapped by `metadataYaml()`, which mounts YAML on a
`Metadata` node (`@{ shape: tool }` in flowchart and kanban), split as Mermaid's `addVertex()`
reads it: on one line with its braces, as a flow mapping; over several lines without them.

Accessibility lines (`accTitle:`, `accDescr:`, `accDescr { … }`) are handled once, here, not in
each grammar. In the 15 diagrams whose Mermaid parser stores them (`accessibleDiagrams` in
`parsers/mermaid/tokens.ts`), the diagram node is a rule: an anonymous `…Text` token, then
`AccTitle`/`AccDescr` nodes and `diagramRest` chunks. `textAroundAccessibility()` in `index.ts`
mounts the diagram's parser as an **overlay** on the text around those nodes, so the diagram grammar
never sees them. `Tree.toString()` does not print overlay mounts: a fixture with an accessibility
line shows only the dispatcher's nodes, and the spec reads the mounted tree through
`NodeProp.mounted`. Timeline and kanban read these lines as content; mindmap, sankey and block
reject them.

## Rules

- **Never edit `parser.ts` or `parser.terms.ts`.** After any `.grammar` change, regenerate:
  `pnpm --filter @triliumnext/codemirror build:mermaid-grammars`. The spec fails while a committed
  parser differs from what its grammar generates. The parsers are committed because the client
  consumes `packages/codemirror` as source, and no Vite/Vitest config compiles `.grammar` files.
- **Relative imports end in `.js`** (`nodenext`), in TypeScript and in a grammar's
  `@external … from "./tokens.js"` alike.
- **Run the narrow suite**: `pnpm --filter @triliumnext/codemirror test src/languages/mermaid`
  (add `syntax_highlighting` when touching the wiring). Then `pnpm typecheck` once.
- **The package gates on 100% coverage** in CI (`pnpm run --filter=codemirror test --coverage`),
  and vendored code counts. Measure just this folder:
  ```bash
  cd packages/codemirror && pnpm exec vitest run src/languages/mermaid \
    --coverage --coverage.include='src/languages/mermaid/**/*.ts' --coverage.reporter=json-summary
  ```
  then read `test-output/vitest/coverage/coverage-summary.json`. The text table hides rows that are
  at 100%, so read totals rather than inferring them from missing output. Generated parsers are
  excluded from coverage (`vite.config.ts`) and from the formatter (`eslint.format.config.mjs`).
- **Format check** only the folder:
  `pnpm exec eslint -c eslint.format.config.mjs packages/codemirror/src/languages/mermaid`.

## Adding a diagram type

Every type Mermaid 12.2.0 registers has a grammar, and the client's `mermaid_highlighting.spec.ts`
(next to `sample_diagrams.ts`) keeps it so: it fails when `mermaid.getRegisteredDiagramsMetadata()`
lists an id missing from its `HIGHLIGHTED_AS` table, and when a sample of a listed type does not
parse as that node with a parser in `DIAGRAM_PARSERS`. A Mermaid upgrade that adds a type therefore
starts here; a type with no Trilium sample goes in `UNSAMPLED_CODE`. Swimlanes (`swimlane-beta`) is a flowchart to
Mermaid and to us; agent flow (`agentflow-beta`) is the flowchart grammar in its `agentflow`
dialect (`DIAGRAM_PARSERS` configures it), which adds its `flow`, `connector` and `global`
keywords without taking those names away from flowchart node ids. Use case follows Mermaid's
lexer token for token, without statement structure: its Chevrotain parser has about fifty rules.

**Write a new grammar from Mermaid's own parser, not from its docs.** `langium.mts` prints the
Langium grammars of `@mermaid-js/parser` (radar, treemap, tree view, Wardley, Cynefin, event
modeling, railroad, …); the others are Jison or Chevrotain inside Mermaid's chunks, and the tool's
header says where to look. The grammar can still differ from what Mermaid accepts (event modeling
declares `title` but rejects it), so check each construct with the probe below. The VS Code
extension (Mermaid-Chart/vscode-mermaid-chart, `syntaxes/`) only lists keywords.

1. **`parsers/<diagram>/<diagram>.grammar`.** Its `@top` node is named `<Something>Diagram`. Start
   from the closest existing grammar: line-oriented diagrams (pie, packet, sankey) are small;
   indentation-based ones (mindmap, kanban) need a context tracker.
2. **`highlight.ts`** maps node names to tags with `styleTags`, using `@external propSource … from
   "./highlight.js"` in the grammar. **`tokens.ts`** only if the grammar needs external tokenizers.
   A literal (`"(("`) is a node, and so can be styled, only when the grammar's `@tokens` block
   declares it; otherwise it stays anonymous and unstyled.
3. **Tags** go in `tags/index.ts`. Give each one a standard parent
   (`Tag.define(t.keyword)`): themes style standard tags only, so a parentless tag renders unstyled.
   Mindmap's five `lineText` tags, one per tree level, were parentless until they took `keyword`,
   `typeName`, `string`, `number` and `propertyName`.
4. **Teach the dispatcher.** In `parsers/mermaid/mermaid.grammar`, add the node to both the `@top`
   alternatives and the `@external tokens diagramText` list; in `parsers/mermaid/tokens.ts` add each
   keyword the diagram starts with to `diagramMap` (`radar-beta`, …). `diagramMap` matches with
   `startsWith` and takes the first hit, so list a longer key before a shorter key it starts with.
   If Mermaid stores `accTitle` for the new type (ask `mermaid.mermaidAPI.getDiagramFromText()`
   after a `mermaid.parse()`, then `db.getAccTitle()`), make the node a rule like the others,
   `<Name>Diagram { <name>Text accessible* }`, and add its token to `accessibleDiagrams`.
5. **Wire it** into `DIAGRAM_PARSERS` in `index.ts`, keyed by the node name. The spec fails if a
   parser directory is missing from the map.
6. **Fixtures**: `test/<diagram>.txt`, named exactly like the directory. Start with Trilium's own
   sample for the type (`apps/client/src/widgets/type_widgets/mermaid/sample_diagrams.ts`), then one
   case per construct. Add a detection case to `test/mermaid.txt`.
7. **Map Mermaid's id** to the node in `HIGHLIGHTED_AS` (`mermaid_highlighting.spec.ts`), and run
   it: `cd apps/client && pnpm exec vitest run src/widgets/type_widgets/mermaid`.
8. **Credit the source** in `LICENSE`: add the diagram to the section of the parser it follows
   (`@mermaid-js/parser` for Langium, Mermaid for Jison and Chevrotain).
9. Regenerate, run the suite, measure coverage.

## Lezer traps already hit

- **`@precedence` beats length.** A higher-precedence token wins even where a lower one would match
  more. Flowchart's `--` label opener ranked below the link tokens, so `-- text -->` always lexed as
  a link: the edge-label rule could never match, and upstream fixtures recorded the broken tree.
  The fix made the opener longer (`"--" $[ \t]+`) so no link token overlaps it, then ranked it first.
- **External tokenizers run before the grammar's skip.** One that reads text must decline at
  whitespace, or its token starts with the spaces after the keyword. `lineText()` declines, lets
  the skip run, then looks back for a newline so a `title` on its own line takes no text.
- **The spec does not see a new `parsers/<dir>` until `mermaid.spec.ts` changes.** Vitest's
  module cache (`node_modules/.vitest-cache`) keys the spec's transform by its contents, and that
  transform holds the expanded `import.meta.glob`. The symptom: the wiring test and every fixture of
  the new grammar fail with `Cannot read properties of undefined (reading 'configure')`. Delete
  the cache entries that hold the spec (`grep -l fileTests` there, then those containing
  `parsers/mermaid/parser.ts`).
- **A literal token next to flowchart's Unicode `identifier` overflows the tokenizer tables**
  ("too big to represent with 16-bit offsets"). The `swimlane-beta`/`agentflow-beta` headers are
  an external token for that reason.
- **`styleTags` selectors treat `/` as a path separator**: quote it (`'"/"'`). `Tag.define()`
  cannot take a modified tag such as `t.definition(…)`; apply the modifier in `styleTags` instead.
- **External tokenizers run in declaration order; the first that accepts wins.** Kanban's
  `columnTitleTokens` claims every line without a `[`, so `nodeIdTokens` only ever sees card lines.
  Check what an earlier tokenizer swallows before deciding a later one's branch is reachable.
- **An external tokenizer runs only in parse states that accept one of its tokens**, and
  `stack.canShift(term)` says which. For context (am I at the start, inside front matter?) ask the
  stack, not `input.pos`: `frontMatter` has a separate `frontMatterStart` token, valid only at the
  start of the document, and both its `---` tokens keep one node name with `[@name=DashLine]`.
  The same rule makes branches dead: a literal in `@tokens` (such as `}`) is claimed before a
  later external tokenizer runs, and an `else if (stack.canShift(…))` that every calling state
  satisfies can never be false. Coverage finds these; delete them instead of writing fixtures.
- **`acceptToken(term, offset)`** with a negative offset ends the token before what was read —
  kanban uses it to keep the spaces in `id1 [Task]` out of the id. Fixture trees do not show token
  ranges; assert those in the spec, or look with `tree.mts --spans`.
- **Line endings.** CodeMirror normalizes `\r\n` and `\r` to `\n` before parsing, but the grammars
  still meet CRLF in specs and anywhere else they run. Git normalizes CRLF in `.txt` fixtures, so a
  CRLF case belongs in `mermaid.spec.ts` (`parses Windows line endings like Unix ones`).
- **Language data lives on top nodes.** `state.languageDataAt()` reads it from the innermost top
  node at a position, which inside a diagram is that diagram's own top node, not `MermaidDiagram`.
  `languageData` on `mermaidLanguage` alone reaches only the preamble, so `index.ts` configures every
  diagram parser with `languageDataProp` pointing at `mermaidLanguage.data` (that is how `%%`
  comment toggling, `commentTokens`, reaches the diagram body). Add new data (autocompletion
  sources, indentation hints) to `languageData`, never to one diagram parser. The YAML parser keeps
  its own data, which is why Ctrl+/ comments front matter with `#`.
- **Error recovery is behaviour too.** A fixture whose tree has `⚠` pins how the grammar recovers.
  That is fine for input Mermaid rejects; for input Mermaid accepts it records a limitation, and the
  fixture name must say so (`… (unsupported, parses as empty lines)`).

## Proving a change

**Fixtures first.** Write or correct the fixture, run it red against the current grammar, then fix.
`fixtures.mts` generates fixture blocks from the current parser — that is for recording behaviour
you have already judged correct, never for deciding what correct is.

**Real Mermaid is the referee** on what syntax is valid. Before pinning a tree for an odd input, ask
Mermaid, from a throwaway client spec (delete it afterwards):

```ts
// apps/client/src/zz_probe.spec.ts
import mermaid from "mermaid";
import { it } from "vitest";
it("probe", async () => {
    for (const code of [ "kanban\n  todo\n    id1 [Task]", "mindmap root" ]) {
        try { await mermaid.parse(code); console.log("OK ", code); }
        catch (e) { console.log("ERR", code, (e as Error).message.split("\n")[0]); }
    }
});
```

run with `cd apps/client && pnpm exec vitest run src/zz_probe.spec.ts`. The upstream fixtures were
written against the parser, not against Mermaid, and some recorded bugs as expected output.

**A refactor that claims "no behaviour change" needs proof, not reasoning.** Record the trees,
change the code, check:

```bash
K=.claude/skills/developing-mermaid-highlighting
npx tsx $K/compare.mts record mindmap /tmp/before.json
# … change, regenerate if a grammar changed …
npx tsx $K/compare.mts check mindmap /tmp/before.json
```

The corpus recombines the lines of the diagram's fixtures (2000 documents, LF and CRLF) and
compares every node with its range. Then **break the changed line on purpose once** and confirm
`check` reports differences — a corpus that never reaches the code passes everything. Both halves
have caught real mistakes: a mindmap check that a handful of hand-picked documents never reached
(logging suggested it was dead; 98 corpus documents changed without it), and a token-range change
that an earlier name-only comparison missed.

**Before deleting a branch as unreachable**, log what reaches it across the corpus, not across a
few documents you wrote. If the corpus reaches it, it needs a fixture; if neither the corpus nor
any document Mermaid accepts reaches it, remove it, and say how you know in the commit.

## Tools

| | does |
|---|---|
| `tree.mts <diagram> '<input>' [--spans]` | prints the parse tree; `--spans` adds each node's range and text. `mermaid` parses with the top-level language |
| `fixtures.mts <cases.json> [--append]` | `[diagram, name, input][]` → fixture blocks from the current parser; `--append` writes them to `test/<diagram>.txt` |
| `compare.mts record\|check <diagram> <file>` | before/after tree comparison over a generated corpus |
| `langium.mts [<Module>]` | prints a Langium grammar of `@mermaid-js/parser`; without an argument, lists them |

All run with `npx tsx .claude/skills/developing-mermaid-highlighting/<script>` from the repository
root; `\n`, `\r` and `\t` in an input are unescaped.

## Known limitations

- An `accTitle:` or `accDescr:` line inside multi-line content is that content, and
  `textAroundAccessibility()` finds it by the diagram grammar's tree: a token begun on an earlier
  line, or a body in `CONTENT_BODIES`. State notes, class notes, git commit messages and pie labels
  over several lines are not tokens in their grammars, so a statement there still highlights as one.
- `mindmap root` (root on the `mindmap` line, valid Mermaid) parses as empty lines.
- A bare word under a kanban column parses as another column, not a card.
- Dotted edge labels (`A -. text .-> B`) parse as two links.
- `flowchart` or `graph` without a direction (valid Mermaid, top to bottom) parses with errors.
- Block has no `style` statement: `style B fill:#969` parses with errors (Trilium's own sample).
- Diagram detection is case-sensitive; Mermaid accepts `ISHIKAWA-BETA` and `SET` in a Venn
  diagram.
- Radar, treemap, Wardley and the railroad dialects skip newlines, so they accept a few layouts
  Mermaid rejects (a statement split over lines, two Wardley names on separate lines as a link).
- Inside a diagram, only mindmap knows `Directive`; the other grammars highlight a directive as a
  `LineComment`. None highlights the JSON a directive holds: Mermaid accepts single quotes there,
  so a JSON parser would flag valid input.
- Mermaid strips whole-line `%%` comments before any diagram parses, so they are valid anywhere;
  check a grammar's `LineComment` before assuming it accepts one in every position.
- No autocompletion exists for Mermaid in any editor library; it would be an
  `@codemirror/autocomplete` source written here.
