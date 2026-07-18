# Test utilities & data helpers (Trilium)

Trilium plugin tests run against a **real editor** and assert with the model/view stringify-parse
helpers. There are no upstream test-editor factories in Trilium — but the aggregate ships a thin
shared kit that wraps the real `ClassicEditor`.

## Test against a real `ClassicEditor`

In the aggregate (`packages/ckeditor5`), use `createTestEditor()` from `test/editor-kit.ts`: it
creates a real editor (`licenseKey: 'GPL'`, only the plugins you pass) over a fresh host element and
**tracks** it, and the global `afterEach` in `test/setup.ts` destroys every tracked editor — so no
per-spec editor teardown:

```ts
import { ClassicEditor, Paragraph } from 'ckeditor5';
import { describe, beforeEach, it, expect } from 'vitest';

import { createTestEditor } from '../../test/editor-kit.js';
import MyEditing from './myediting.js';

describe( 'MyEditing', () => {
	let editor: ClassicEditor, model;

	beforeEach( async () => {
		editor = await createTestEditor( [ Paragraph, MyEditing ] );
		model = editor.model;
	} );
	// no afterEach: setup.ts destroys tracked editors
} );
```

Pass extra editor config (toolbar, balloon, etc.) as the second arg:
`createTestEditor( [ Paragraph, MyEditing ], { toolbar: [ 'myButton' ] } )`. Need the host element?
`editor.sourceElement`, or `getEditorElement( editor )` from the kit.

Notes:
- `editor.model`, `editor.editing.view`, `editor.ui`, `editor.commands`, `editor.plugins` are all
  available — it's a real editor, not a stripped-down test editor.
- Commands can be instantiated directly for focused tests:
  `command = new InsertMermaidCommand( editor )` after the editor is created.
- **Standalone packages and legacy specs** (mid-migration to the kit) still hand-roll the scaffold:
  `document.createElement('div')` + `ClassicEditor.create(...)` + an `afterEach` that calls
  `editor.destroy()` **and** `editorElement.remove()`. There, forgetting either leaks editor
  DOM/body wrappers between tests.

> The upstream ckeditor5 monorepo ships `ModelTestEditor` / `VirtualTestEditor` /
> `ClassicTestEditor` in `@ckeditor/ckeditor5-core/tests/_utils`, but those are monorepo-internal
> and are **not** available in Trilium. Use a real `ClassicEditor` (or the kit) as above.

## Model & view data helpers

Imported from the `ckeditor5` package. They stringify/parse engine structures and are the backbone
of assertions. **Test/debug only — never in `src/`.**

Model:
- `_setModelData( model, string )` — replace the document content + selection from a string.
- `_getModelData( model[, options] )` — serialize current model + selection to a string.

View:
- `_getViewData( view[, options] )` — serialize a view document (e.g. `editor.editing.view`).

```ts
import { _setModelData, _getModelData, _getViewData } from 'ckeditor5';

_setModelData( model, '<paragraph>foo[]bar</paragraph>' );
expect( _getModelData( model ) ).toEqual( '<paragraph>foo[]bar</paragraph>' );
expect( _getViewData( editor.editing.view ) ).toEqual( '<p>foo{}bar</p>' );
```

Existing Trilium tests sometimes alias on import, e.g.
`import { _setModelData as setModelData, _getModelData as getModelData } from 'ckeditor5'`.

### Selection / range string syntax

- `[` … `]` — a position/range **anchored in an element** (also a collapsed `[]` caret).
- `{` … `}` — a position/range **anchored inside a text node**.
- A mixed range can use both ends, e.g. `<p>{Foo]<b>Bar</b></p>` starts in the `Foo` text node
  and ends in `<p>` at offset 1.
- Text attributes serialize as `<$text key="value">text</$text>`; selection attributes appear on
  the collapsed selection.
- Element ranges wrap the node, e.g. `[<mermaid source="..."></mermaid>]` selects the element.

`_getModelData`/`_getViewData` options of note: `withoutSelection: true` to omit selection
markers; `rootName` to target a non-default root.
