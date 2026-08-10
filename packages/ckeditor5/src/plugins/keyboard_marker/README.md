# Keyboard marker

Adds support for the keyboard input element (`<kbd>`) to CKEditor 5: a `kbd` text attribute, a
`kbd` command, the <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd> keystroke and a toolbar button.

## Provenance

Derived from [mlewand/ckeditor5-keyboard-marker](https://github.com/mlewand/ckeditor5-keyboard-marker)
by Marek Lewandowski, licensed **GPL-3.0** — see [`LICENSE`](./LICENSE) next to this file.

The source was ported to TypeScript and to current CKEditor 5 APIs, and has since diverged from
upstream (two-step caret movement, `spellcheck="false"` on the downcast element, and
`copyOnEnter: false` so the formatting does not carry onto the next paragraph). Upstream targets a
long-obsolete CKEditor 5 version and is not tracked; treat this as Trilium-maintained code.

It lived at `packages/ckeditor5-keyboard-marker` until it was folded into this package — it had no
consumers outside `@triliumnext/ckeditor5`, was never published, and carried a full
`ckeditor5-package-generator` scaffold (sample pages, its own ESLint/Stylelint/vitest configs) that
nothing invoked. GPL-3.0 combines with this repository's AGPL-3.0-only license, so the split bought
no license isolation either.
