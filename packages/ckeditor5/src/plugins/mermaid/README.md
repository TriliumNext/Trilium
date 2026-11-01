# Mermaid diagrams

The `mermaid` split button and the Mermaid slash commands, which insert a diagram, blank or from a
template in `mermaid.samples`. Load the `Mermaid` glue plugin; it pulls in `MermaidUI`.

| File | Role |
|---|---|
| `mermaid.ts` | Glue plugin; also declares the `ckeditor5` module augmentation |
| `mermaid_ui.ts` | The insert split button with its template dropdown, and `insertMermaidDiagram()` |

## A diagram is an inline embed

This package has no Mermaid editing or rendering of its own. A diagram is a `contentEmbed` that
keeps its source in the note (`content_embed/inline_source.ts`): it is saved as
`<pre><code class="language-mermaid">…</code></pre>`, with the box size, flags and size of the
embed on the `<pre>`, and the host renders and edits it through `contentEmbed.loadInline()`. The
host must list `mermaid` in `contentEmbed.inlineLanguages`, or a diagram loads as a plain code
block.

## Provenance

The insert button derives from CKSource's `@ckeditor/ckeditor5-mermaid`, copyright CKSource
Holding sp. z o.o., used under the GPL-2.0-or-later arm of its license — see `LICENSE.md` next to
this file, which combines with this repository's AGPL-3.0-or-later.
