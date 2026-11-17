# Worked sketches

Each sketch names the decisions of SKILL.md ("Decide first") for one kind of content, and the
places that change. They are starting points, not settled designs: the link parameter of each
one is the decision to confirm with the maintainer first.

## Markdown headings

Markdown notes are `type === "code"` notes with `isMarkdownMime(mime)` (`@triliumnext/commons`).
Their headings are of kind `heading`, so `LINK_TARGET_KINDS`, the cards and the `@` list need no
change.

### The link parameter

| | Slug, no reference | Id written into the source |
|---|---|---|
| Link | `?bookmark=installation` or a new `?heading=installation` | `?block=<id>` |
| Source | Unchanged | `## Installation {#<id>}`, the attribute syntax of Pandoc and markdown-it-attrs |
| `createReference` | None, every target has `params` | Appends ` {#<id>}` to the heading line, as `insertBlockId()` splices |
| Rename of the heading | Breaks the link | Keeps the link |
| Duplicate titles | Suffixes (`setup-1`), which depend on the order | No issue |
| The view | Computes the same slugs to find the heading | The renderer reads `{#id}`, strips it and puts the id on the heading |

With `bookmark`, `consumeBookmark()` finds the heading by `id` in a rendered preview if the
renderer gives headings slug ids. With a new parameter, add it to `TARGET_PARAMS` and follow the
steps of SKILL.md, "Navigation" (`ViewScope`, `VIEW_SCOPE_PARAMS`, `calculateHash()`,
`useFollowLinksWithin()`). With `block`, `loadReferenceLinkTitle()`, `getReferenceLinkTitleSync()`
and the block excerpt code read text note HTML and need a Markdown branch before
`isTitleMirrored` holds for these links.

With ids in the source, the same id can occur twice (a heading copied with its `{#id}`). Read it as
`text.ts` does: the id counts on the first heading only, a later heading with it is listed without
`params`, and `createReference` writes a new `{#id}` for it. The renderer must keep the first one
too, or links land on the wrong heading.

### The provider

Lex with `marked`, which commons depends on and which `markdown_renderer.ts` (import, share pages,
backlink excerpts) and the Markdown view use. It skips code fences and reads setext headings as
the preview does, which a regular expression over lines gets wrong.

```ts
// packages/trilium-core/src/services/references/markdown.ts
import { isMarkdownMime, type ReferenceTarget } from "@triliumnext/commons";
import { Lexer, type Token } from "marked";

import type { ReferenceProvider } from "./index.js";

/** The headings of Markdown notes. */
const markdownReferences: ReferenceProvider = {
    isFor: (type, mime) => type === "code" && isMarkdownMime(mime),
    findTargets: (content) => typeof content === "string" ? findMarkdownTargets(content) : []
};

export default markdownReferences;

/** The headings that have text, in document order. */
export function findMarkdownTargets(content: string): ReferenceTarget[] {
    const targets: ReferenceTarget[] = [];
    for (const token of new Lexer().lex(content)) {
        if (token.type !== "heading") continue;

        const title = getPlainText(token.tokens ?? []);
        if (title) {
            targets.push({
                kind: "heading", title, level: token.depth, params: { /* the parameter */ }
            });
        }
    }
    return targets;
}
```

- `getPlainText()` joins the `text` of inline tokens and drops markup, links and HTML, so a title
  is never HTML. Collapse white space as `getHeadingText()` in `text.ts` does.
- Headings nested in lists or block quotes are child tokens: walk `token.tokens` with a stack if
  they count, as `getElements()` in `text.ts` walks HTML.
- Front matter: check how `services/import/frontmatter.ts` splits it before lexing.
- Add the provider to `providers` in `references/index.ts`, and a spec next to it.

### The editor side

- The Markdown `@` list (`createCompletionList()` in `type_widgets/code/editor_completions.tsx`)
  renders `LinkMentionList` without `getOwnTargets`, so a link to the note being edited lists its
  saved headings. Pass `getOwnTargets` built from the CodeMirror document to list unsaved ones.
- The Markdown link dialog (`showEditLinkDialog()` in `type_widgets/markdown/editor_utils.ts`)
  passes no `noteId` and no `headings`. Pass them to show the note's own headings on the note
  page, and to open the Heading / anchor page.
- The Markdown view (`type_widgets/markdown/Markdown.tsx`) reads the parameter from
  `noteContext.viewScope` and scrolls the source or the preview to the heading.
- The chip of a Wikilink (`resolveWikilinkChip()`) labels `block` and `bookmark` only.

## PDF pages and outline entries

- **Notes**: `type === "file"` with `mime === "application/pdf"`; PDF attachments once the routes
  take attachments (SKILL.md, "Attachments").
- **Kinds**: a new `page` kind for pages (flat, no `level`), and `heading` for the outline
  (bookmarks), whose entries nest by `level`.
- **Parameters**: `page` exists already. `Pdf.tsx` reads `viewScope.page` and `annotation` in
  `revealLinkTarget()`, and the PDF sidebar copies `?page=7` and `?page=5&annotation=12R` links.
  An outline entry links to its page; an annotation target carries both parameters.
- **Titles**: the page label when the PDF has page labels, else the number, worded with the
  server's `t()` (`server.json`) if a word is needed. Outline titles as plain text.
- **Parser**: core cannot parse PDFs in standalone (`pdfjs-dist` is stubbed there). The server has
  `unpdf` (the OCR processor imports it on demand), so the provider lives in `apps/server`,
  registered with `registerReferenceProvider()` at startup, and imports `unpdf` inside
  `findTargets`. No `createReference`.
- **Strings**: reword `add_link.select_note_for_targets` and `add_link.no_link_targets`, which name
  headings and anchors. Load the `developing-pdf-viewer` skill for the viewer side.

## DOCX headings and bookmarks

- **Notes**: `type === "file"` with the Word MIME type, and attachments.
- **Parser**: core converts office files for previews in `services/office_preview.ts` with
  `officeparser`, loaded on demand and bundled in standalone through aliases. If its HTML keeps
  the headings as `<h1>` to `<h6>`, the provider can convert and reuse the heading walk of
  `text.ts`; check that first.
- **Parameter**: the file cannot take ids, so the link names the heading by position or slug,
  which a later edit of the file can move. Word bookmarks have names, which suit `bookmark`.
- **The view**: the file preview must find the heading in its converted HTML and scroll to it.

## Spreadsheet sheets

- **Notes**: `type === "spreadsheet"`, whose content is the workbook JSON.
- **Kind**: a new `sheet` kind, flat. Named ranges could be a second kind.
- **Parameter**: a new `sheet` parameter with the sheet id from the JSON, which stays when the
  sheet is renamed. Title: the sheet name.
- **The view**: the spreadsheet widget activates the sheet when `viewScope.sheet` is set.
