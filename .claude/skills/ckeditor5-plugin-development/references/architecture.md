# Architecture: core, model, view, schema, events

The conceptual foundation. Read this before working on editing behavior.

> **Scope.** Everything here is engine mechanics from the **`ckeditor5` library** (the npm
> aggregate, pinned to `48.2.0` in the Trilium monorepo). The APIs (`editor.model`,
> `editor.editing`, `Plugin`, the writer, schema, conversion) are the library's, imported as
> `import { Plugin } from 'ckeditor5'` (with file extensions). Paths under
> `packages/ckeditor5-*` (admonition, collapsible, footnotes, keyboard-marker, math, mermaid)
> are **Trilium's own** plugins that consume these APIs; the editor build/aggregator lives in
> `packages/ckeditor5`. Trilium examples are cited throughout — they exercise the same library
> mechanics described below.

## Editor classes

`Editor` (the `Editor` base from `ckeditor5`) is the entry point that glues everything.
Editors are created with the **static async** `create()` (constructors are protected).
Built-in library types: `ClassicEditor`, `InlineEditor`, `BalloonEditor`, `DecoupledEditor`;
integrators may subclass their own (see `tooling-and-packaging.md` → custom editor creators).

Trilium defines **three editor classes** in `packages/ckeditor5/src/index.ts`, each subclassing
a built-in:
- `AttributeEditor extends BalloonEditor` — inline/balloon editing.
- `ClassicEditor extends DecoupledEditor` — toolbar + editable placed by the app (note the
  name: Trilium's `ClassicEditor` is decoupled, not the library's boxed `ClassicEditor`).
- `PopupEditor extends BalloonEditor` — balloon variant for popups.

The plugin registry lives in `packages/ckeditor5/src/plugins.ts`. Whichever class is used,
`editor.model` / `editor.editing` / `editor.conversion` etc. are the same library APIs below.

Key properties:

- `editor.config` — configuration object (`config.define()`, `config.get('feature.key')`).
- `editor.plugins` / `editor.commands` — collections of loaded plugins / commands.
- `editor.model` — the data model (entry point to the engine).
- `editor.data` — the **data controller** (data pipeline: `getData`/`setData`, processors).
- `editor.editing` — the **editing controller** (editing pipeline; `editor.editing.view`).
- `editor.keystrokes` — `EditingKeystrokeHandler`; bind keystrokes to commands.
- `editor.ui` — UI controller (`editor.ui.componentFactory`, `editor.ui.view`).
- `editor.accessibility` — register keystroke info for the a11y help dialog.

Key methods: `create()`, `destroy()` (returns a Promise — `await` it), `execute( 'cmd', …args )`,
`setData()`/`getData()` (format controlled by the data processor — not necessarily HTML; e.g.
Markdown via a custom `DataProcessor`).

## The model

A DOM-like tree of **elements** and **text nodes** living in a `document` with `roots`,
`selection`, and change `history`. Unlike the DOM, **both elements and text nodes can have
attributes**. Access:

```js
editor.model;                    // Model
editor.model.document;           // ModelDocument
editor.model.document.getRoot(); // root element
editor.model.document.selection; // ModelDocumentSelection
editor.model.schema;             // ModelSchema
```

### Changing the model — always via the writer

Structure, selection, and node creation happen **only** through the `ModelWriter`, available
inside `model.change()` / `model.enqueueChange()`:

```js
editor.model.change( writer => {
	writer.insertText( 'foo', editor.model.document.selection.getFirstPosition() );
} );

editor.model.change( writer => {
	for ( const range of editor.model.document.selection.getRanges() ) {
		writer.setAttribute( 'bold', true, range );
	}
} );
```

- All changes in one `change()` block = **one undo step** (one `Batch`). Nested `change()`
  blocks fold into the **outermost** block's batch.
- Prefer high-level `model.insertContent()`, `model.insertObject()`, `model.deleteContent()`,
  `model.getSelectedContent()` — they respect the schema. Use the writer's low-level methods
  (`createElement`, `createText`, `insert`, `append`, `remove`, `setAttribute`,
  `setSelection`, `setSelectionAttribute`, `removeSelectionAttribute`) for precise edits.
- All structural changes are **operations** (Operational Transformation, for collaboration);
  batches are the unit of undo.

### Text vs. selection attributes

Inline styles (bold, italic, links, highlight) are stored as **text-node attributes**, not
nested elements:

```text
<p>Foo <strong>bar</strong></p>   (DOM/view)
<paragraph>"Foo " "bar"(bold=true)</paragraph>   (model)
```

The **selection** also has attributes (`selection.getAttribute('bold')`); a collapsed
selection with `bold=true` means newly typed text will be bold. Manage with
`writer.setSelectionAttribute()` / `removeSelectionAttribute()`.

### Indexes, offsets, positions, ranges, selections

- **Index** addresses a node within its parent; **offset** addresses a position.
- `ModelPosition` = a `path` (array of offsets). `ModelRange` = start + end positions.
- `ModelSelection` = one or more ranges + direction + attributes (you can create many).
- `ModelDocumentSelection` = the user's actual selection (one per document); changeable only
  via the writer; auto-updates as the structure changes.
- Useful selection APIs: `selection.isCollapsed`, `getFirstPosition()`, `getFirstRange()`,
  `getRanges()`, `getSelectedElement()`, `getSelectedBlocks()`, `hasAttribute()`,
  `getAttributes()`. Position helpers: `writer.createPositionAt(node, 0|'end'|offset)`,
  `findAncestor('name')`. Range helpers: `createRangeIn(element)`, `createRange(start, end)`,
  `getItems()`, `getWalker()`, `containsRange(range, loose)`, `isCollapsed`.

### Markers

A special, persistent kind of range managed by `MarkerCollection`, changed only via the
writer. Markers: sync over the network for collaboration; auto-update on structure changes;
can be downcast to the editing view (`markerToHighlight`, `markerToElement`) or to data
(`markerToData`) and upcast (`dataToMarker`). Ideal for comments, selections of other users,
and metadata attached to document ranges.

## The schema

`editor.model.schema` defines what the model may contain. It governs paste filtering,
where the selection may go, which features apply where, etc. **Plugins should pre-configure
the schema** so the feature works without the user reconfiguring anything.

Core operations:

```js
// Allow an attribute on existing items (inline features):
schema.extend( '$text', { allowAttributes: 'highlight' } );

// Register a new element:
schema.register( 'simpleBox', { inheritAllFrom: '$blockObject' } );
schema.register( 'placeholder', { inheritAllFrom: '$inlineObject', allowAttributes: [ 'name' ] } );
schema.register( 'simpleBoxTitle', { isLimit: true, allowIn: 'simpleBox', allowContentOf: '$block' } );
schema.register( 'simpleBoxDescription', { isLimit: true, allowIn: 'simpleBox', allowContentOf: '$root' } );
```

Definition properties: `inheritAllFrom`, `allowIn`, `allowChildren`, `allowContentOf`,
`allowAttributes`, `allowAttributesOf`, plus semantic flags `isObject`, `isInline`,
`isBlock`, `isLimit`, `isSelectable`, `isContent`. Common generic items: `$root`, `$block`,
`$text`, `$blockObject`, `$inlineObject`, `$documentFragment`.

Behavior that flags produce (observable in the block-widget feature):
- `isLimit` — element can't be split (Enter) or emptied/left by Backspace; good for titles.
- `isObject` / `$blockObject` / `$inlineObject` — selected/deleted/copied as a unit.

Trilium's block features lean on exactly these: `ckeditor5-admonition` and
`ckeditor5-collapsible` register block elements inheriting from `$blockObject` and mark inner
title/content regions with `isLimit`, then guard structure with one or more
`registerPostFixer` invariants (see `core-plugin-patterns.md` → post-fixers). `ckeditor5-footnotes`
splits its schema across `schema.ts` / `converters.ts` with shared `constants.ts`.

Custom checks for disallowing in specific contexts:

```js
schema.addChildCheck( ( context, childDefinition ) => {
	if ( context.endsWith( 'simpleBoxDescription' ) && childDefinition.name == 'simpleBox' ) {
		return false; // no nested boxes
	}
} );
schema.addAttributeCheck( context => {
	if ( context.endsWith( 'formName $text' ) ) return false; // no inline styles inside
} );
```

Query APIs used by features/commands: `schema.checkChild( context, child )`,
`checkAttribute( context, attr )`, `checkAttributeInSelection( selection, attr )`,
`getValidRanges( ranges, attr )`, `findAllowedParent( position, name )`,
`findOptimalInsertionRange()`. There is **no clean way to override** a feature's schema after
the fact short of replacing `editor.model.schema`; prefer composing features.

## The view

An abstract, DOM-like **virtual DOM** with two pipelines: the **editing view**
(`editor.editing.view`, a persistent `ViewDocument` rendered to `contentEditable`) and the
**data view** (detached structures used by the data pipeline; no document/controller). The
`ViewRenderer` tames `contentEditable`.

Six **semantic element types** convey meaning to converters/renderer:
- **ContainerElement** — block structure (`<p>`, `<h1>`, `<li>`, `<section>`).
- **AttributeElement** — inline styling (`<strong>`, `<a>`, `<code>`); similar ones auto-flatten.
- **EmptyElement** — must have no children (`<img>`).
- **UIElement** — non-data UI inlined in content; selection jumps over it; its events/content
  are filtered out.
- **RawElement** — opaque data container; children transparent to the editor.
- **EditableElement** — a nested editable region inside non-editable content (e.g. image caption).

Plus **custom properties** (`element.getCustomProperty(name)` / `writer.setCustomProperty()`),
non-rendered markers used e.g. by `toWidget()` and to tag elements as belonging to a feature.

**Non-semantic views** are produced directly from input data (paste/`setData`) and consist of
plain `ViewElement`s before upcasting.

### Changing the view

Don't change the view manually unless the model genuinely can't represent the cause (e.g.
focus, which is a view property). When you must, use the view's `change()` block:

```js
editor.editing.view.change( writer => {
	writer.insert( position, writer.createText( 'foo' ) );
} );
```

Two view writers: `ViewDowncastWriter` (in `change()` blocks, semantic view, used while
downcasting) and `ViewUpcastWriter` (for pre-processing input/pasted non-semantic views).

View positions are `{ parent, offset }` and behave more like model **indexes**; conversion of
DOM↔view positions is fiddly — prefer working with model positions.

### Observers

Observers turn native DOM events into safe, testable custom events fired on the
`ViewDocument`. Defaults include mutation, selection, focus, key, composition, arrow-keys.
Add your own with `view.addObserver( MyObserver )` (subclass `Observer`, or `DomEventObserver`
for a single DOM event — see `recipes.md` double-click example). Third-party packages should
**prefix custom view events** (e.g. `myApp:keydown`) to avoid collisions.

## Conversion (overview)

Three processes connect model and view (deep dive in `conversion.md`):
- **Data upcasting** — data view → model (load/paste). Data processor → view fragment → model.
- **Data downcasting** — model → data view → output (`getData`).
- **Editing downcasting** — model → editing view → DOM, continuously as the model changes.
  There is **no** "editing upcasting": features listen to view events and apply model changes.

## Event system & observables

The editor is event-based; most classes are `Emitter`s and/or `Observable`s (an Observable is
an Emitter). This decouples and extends code.

- Listen with `this.listenTo( emitter, 'event', cb, { priority } )`; `this.stopListening()`
  (auto-called in `Plugin#destroy()`). Priorities (`'highest'`…`'lowest'`, default `'normal'`)
  order listeners; `evt.stop()` halts propagation, `evt.return` sets the result.
- Many methods are **decorated** into events (e.g. `Command#execute` fires `execute`), so you
  can run code before/after or block by listening with high/low priority and `evt.stop()`.
- Observables expose **observable properties** via `set()`, firing `change:prop` and
  `set:prop` events:

```js
this.set( 'value', undefined );
command.on( 'change:value', ( evt, name, newVal, oldVal ) => {} );
```

- **Footgun (TypeScript) — declare observable fields with `declare x: T`, never `x!: T`.** A field
  you back with `this.set({ x })` must be typed with the **type-only `declare`** modifier (emits no
  code). The definite-assignment form `x!: T` looks equivalent but, under `useDefineForClassFields`
  (the default at our `target: es2022`, and the Vite/esbuild default), it emits a real field
  initializer that pre-sets the property to `undefined`; CKEditor's `this.set({ x })` then throws
  `observable-set-cannot-override` (it refuses to convert an own data property into an observable
  accessor). `declare` is the correct CKEditor 5 pattern — see
  `packages/ckeditor5/src/plugins/file_upload/progressbarview.ts` (`declare width: number;` +
  `this.set( 'width', 100 )`).

- **Binding** mirrors one observable's properties to another (heavily used in UI):

```js
target.bind( 'foo' ).to( source );              // foo <- source.foo
target.bind( 'foo' ).to( source, 'bar' );        // foo <- source.bar
button.bind( 'isOn', 'isEnabled' ).to( command, 'value', 'isEnabled' );
dropdown.bind( 'isEnabled' ).toMany( buttons, 'isEnabled', ( ...vals ) => vals.some( Boolean ) );
```

- **Event delegation** re-fires one emitter's events from another:
  `childButton.delegate( 'execute' ).to( parentView, 'cancel' )`.

This decorate/observe/bind/delegate quartet is the backbone of how commands, UI, and features
stay in sync without tight coupling.
