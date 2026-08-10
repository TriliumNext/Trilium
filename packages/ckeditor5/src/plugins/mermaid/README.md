# Mermaid diagrams

A `<mermaid>` block widget holding diagram source, shown as a source textarea, a rendered preview,
or both side by side. Load the `Mermaid` glue plugin; it pulls in `MermaidEditing`,
`MermaidToolbar` and `MermaidUI`.

| File | Role |
|---|---|
| `mermaid.ts` | Glue plugin; also declares the `ckeditor5` module augmentation and the global mermaid types |
| `mermaid_editing.ts` | Schema, conversion, and the renderer (`_renderMermaid`) |
| `mermaid_ui.ts` | The insert split button with its template dropdown, the mode buttons, the info button |
| `mermaid_toolbar.ts` | Registers the balloon toolbar shown when a diagram is selected |
| `insert_mermaid_command.ts` | `insertMermaid` — inserts a blank or pre-filled diagram |
| `mermaid_{preview,source_view,split_view}_command.ts` | Switch the widget's `displayMode` |
| `utils.ts` | `debounce` for the source textarea, `checkIsOn` for button state |

## The mermaid library is not a dependency

The plugin never imports mermaid. The host passes it in through editor config:

```js
mermaid: {
    lazyLoad: () => import( 'mermaid' ).then( m => m.default ),
    config: { /* mermaid initialize() config */ },
    samples: [ /* diagram templates for the insert dropdown */ ]
}
```

`_renderMermaid` calls `lazyLoad` once, memoises the promise, and calls `initialize()` on the
resolved instance. Renders are generation-stamped so a slow render that has been superseded cannot
overwrite a newer one, and a failed render shows the error message in place.

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
