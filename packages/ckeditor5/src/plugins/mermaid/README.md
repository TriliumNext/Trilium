# Mermaid diagrams

A `<mermaid>` block widget holding diagram source, shown as a source textarea, a rendered preview,
or both side by side. Load the `Mermaid` glue plugin; it pulls in `MermaidEditing`,
`MermaidToolbar` and `MermaidUI`.

| File | Role |
|---|---|
| `mermaid.ts` | Glue plugin; also declares the `ckeditor5` module augmentation and the global mermaid types |
| `mermaid_editing.ts` | Schema, conversion, and the renderer (`renderMermaid`) |
| `mermaid_ui.ts` | The insert split button with its template dropdown, the mode buttons, the info button |
| `mermaid_toolbar.ts` | Registers the balloon toolbar shown when a diagram is selected |
| `insert_mermaid_command.ts` | `insertMermaid` — inserts a blank or pre-filled diagram |
| `mermaid_{preview,source_view,split_view}_command.ts` | Switch the widget's `displayMode` |
| `utils.ts` | `debounce` for the source textarea, `checkIsOn` for button state |

## The display mode is part of the content

A diagram round-trips as `<pre spellcheck="false"><code class="language-mermaid">…</code></pre>`, with
the picked mode persisted on the `<code>` as `data-trilium-display-mode` — the same treatment
collapsed list items get with `data-trilium-collapsed`. The default (`split`) is left out, so a
diagram nobody switched keeps producing exactly the content it did before; a missing or unknown
value upcasts back to `split`.

## The mermaid library is not a dependency

The plugin never imports mermaid. The host passes it in through editor config:

```js
mermaid: {
    lazyLoad: () => import( 'mermaid' ).then( m => m.default ),
    config: { /* mermaid initialize() config */ },
    samples: [ /* diagram templates for the insert dropdown */ ]
}
```

`renderMermaid` calls `lazyLoad` once, memoises the promise, and calls `initialize()` on the
resolved instance. Renders are generation-stamped so a slow render that has been superseded cannot
overwrite a newer one, and a failed render shows the error message in place. It is public because
the widget is not the only diagram on screen: the AI assistant renders the `language-mermaid` blocks
of a finished response through it, so its review shows what committing will produce.

## Provenance

Derived from CKSource's `@ckeditor/ckeditor5-mermaid`, copyright CKSource Holding sp. z o.o., used
under the GPL-2.0-or-later arm of its license — see `LICENSE.md` next to this file, which combines
with this repository's AGPL-3.0-only.

Upstream describes itself as experimental and unsupported, and Trilium's copy has diverged
substantially: the split-button insert with diagram templates, the render generation guard, the
protection against double initialisation and stale renders, the lazy-load hook, and the flicker-free
re-render mechanism are all Trilium's.

It lived at `packages/ckeditor5-mermaid` until it was folded into this package — it had no consumers
outside `@triliumnext/ckeditor5`, declared no dependencies of its own, was never published, and
carried a `ckeditor5-package-generator` scaffold (sample pages, its own ESLint/Stylelint/vitest
configs) that nothing invoked.
