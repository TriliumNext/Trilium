# Conversion: upcast & downcast

Conversion connects the **model** and the **view**. For the editor the **model is the source
of truth**; HTML/data is just I/O. That is why helper names look "reversed": converting the
`<mark>` element ↔ `highlight` model attribute uses `attributeToElement` (you name the
**model** side first).

> All helpers and writers here come from the **`ckeditor5` library** (`48.2.0`); import as
> `from 'ckeditor5'` with file extensions. Trilium's own plugins under `packages/ckeditor5-*`
> register converters via `editor.conversion`; real examples cited below are
> `ckeditor5-math` and `ckeditor5-mermaid` (external/async-rendered widgets built with
> `createUIElement` render callbacks plus a data-processor wrap) and Trilium's reference-link
> conversion.

## Pipelines

- **Upcast** (`upcast`) — view → model. Used when loading data **and** when pasting.
- **Downcast** has two flavors:
  - **dataDowncast** — model → output HTML (`getData()`, copy).
  - **editingDowncast** — model → editing view shown in the UI (continuous).

Use the **same** representation for both downcasts when possible; split them when the editing
view needs extras the data must not have (widget handles, UI elements, `contentEditable`,
nested-editable wiring). Editing-only enhancements (`toWidget`, `toWidgetEditable`, UI
elements) belong in `editingDowncast` so `getData()` stays clean.

## Two ways to register converters

**Two-way helpers** on `editor.conversion` — concise, for simple symmetric conversions.
They register both upcast and (data+editing) downcast at once:

```js
editor.conversion.attributeToElement( { model: 'highlight', view: 'mark' } );
editor.conversion.elementToElement( { model: 'simpleBox', view: { name: 'section', classes: 'simple-box' } } );
editor.conversion.attributeToAttribute( { model: 'secret', view: { name: 'section', key: 'class', value: 'secret' } } );
```

**Pipeline-scoped** via `editor.conversion.for( pipeline )` — for asymmetric/custom cases.
The same `attributeToElement` example expanded:

```js
editor.conversion.for( 'upcast' ).elementToAttribute( { model: 'highlight', view: 'mark' } );
editor.conversion.for( 'dataDowncast' ).attributeToElement( { model: 'highlight', view: 'mark' } );
editor.conversion.for( 'editingDowncast' ).attributeToElement( { model: 'highlight', view: 'mark' } );
```

Note the directionality: **upcast** uses `elementTo…` helpers (view→model), **downcast** uses
`…ToElement` helpers (model→view).

## Helper catalog

Upcast helpers (`for('upcast')`): `elementToElement`, `elementToAttribute`,
`attributeToAttribute`, `dataToMarker`.
Downcast helpers (`for('dataDowncast'|'editingDowncast'|'downcast')`): `elementToElement`,
`elementToStructure`, `attributeToElement`, `attributeToAttribute`, `markerToElement`,
`markerToHighlight`, `markerToData`.

## Callback (custom) converters

When the value isn't a fixed string, pass a `view`/`model` **callback**. The 2nd arg is the
conversion API with a `writer` (a `ViewDowncastWriter` downcast / `ModelWriter` upcast),
`consumable`, etc.

Downcast — model attribute value into a view element with an attribute:

```js
conversion.for( 'downcast' ).attributeToElement( {
	model: 'abbreviation',
	view: ( modelAttributeValue, { writer } ) =>
		writer.createAttributeElement( 'abbr', { title: modelAttributeValue } )
} );
```

Upcast — read a view attribute into the model attribute value:

```js
conversion.for( 'upcast' ).elementToAttribute( {
	view: { name: 'abbr', attributes: [ 'title' ] },
	model: { key: 'abbreviation', value: viewElement => viewElement.getAttribute( 'title' ) }
} );
```

Element callbacks build view structure with the view writer (`createContainerElement`,
`createEditableElement`, `createEmptyElement`, `createText`, `createPositionAt`, `insert`,
`setCustomProperty`):

```js
conversion.for( 'editingDowncast' ).elementToElement( {
	model: 'placeholder',
	view: ( modelItem, { writer } ) => {
		const span = writer.createContainerElement( 'span', { class: 'placeholder' } );
		writer.insert( writer.createPositionAt( span, 0 ), writer.createText( `{${ modelItem.getAttribute( 'name' ) }}` ) );
		return toWidget( span, writer ); // editing-only widget wrapping
	}
} );
```

## View matching patterns (upcast)

The `view` matcher accepts a tag string or an object: `{ name, classes, attributes, styles }`.
`attributes` can be an array of names to require or a map of name→value. Be specific so you
don't greedily match unrelated elements.

## Consumables

Each view/model item is "consumed" once during conversion so multiple converters don't
double-process it. The matcher form differs by pipeline:

- **Upcast** (view items) uses an **object matcher**: `consumable.test( viewItem, { name: true } )`,
  `consume( viewItem, { name: true, classes: 'image' } )`, `consume( viewItem, { attributes: 'data-x' } )`.
- **Downcast** (model items) uses the **event name / string** form: `consumable.consume( data.item, evt.name )`,
  or `'insert'` / `'attribute:foo'`.

Example: a `dataDowncast` that flattens nested model elements into one view element consumes the
children itself (see `recipes.md` "single view element / multiple model elements").

### Always `test()` before `consume()` in custom upcast converters

`consume()` returns `false` (and does nothing) if the item was already consumed by another
converter — and `false` is easy to ignore. In a manual upcast converter, **test first, bail if
unavailable, then consume**:

```js
conversion.for( 'upcast' ).add( dispatcher => {
	dispatcher.on( 'element:a', ( evt, data, conversionApi ) => {
		const { consumable, writer } = conversionApi;
		// Bail if another converter already claimed this element.
		if ( !consumable.test( data.viewItem, { name: true } ) ) {
			return;
		}
		// … build the model, then claim the item so others skip it:
		consumable.consume( data.viewItem, { name: true } );
	} );
} );
```

Why it matters: **unconsumed elements survive.** If your converter returns early without
consuming (e.g. `<a>` wrapping an `<img>` where the `<img>` didn't match), a catch-all converter
like General HTML Support (GHS) re-processes the leftover and you get **duplicated elements**
(`<a><a>…</a></a>`). The rule of thumb: every element your converter is responsible for must be
consumed on **every** code path that handles it, including early returns. Add a test that feeds a
**pre-consumed** element and asserts your converter produces nothing.

## View elements are not DOM elements

Inside upcast/downcast converter callbacks, the element you receive is a **CKEditor view
element**, not a DOM node. Its API only *mirrors the DOM by name*:

- Reading: `viewElement.getAttribute( key )` (string|undefined), `hasAttribute( key )`,
  `hasClass( name )`, `getClassNames()` (iterator), `getStyle( prop )`, `getChildren()`.
- There is **no `.dataset`, no `.classList`, no `.getAttributeNS`** — those are DOM-only.
- Writing (downcast) goes through the **view writer**, not the element:
  `writer.setAttribute( 'data-x', v, el )`, `writer.addClass( 'foo', el )`, `writer.setStyle(...)`.

```js
// Upcast: read data-* with getAttribute, NOT viewElement.dataset (undefined → drops the value).
model: ( viewElement, { writer } ) => writer.createElement( 'box', {
	type: viewElement.getAttribute( 'data-type' ) || 'default'
} )
```

Reaching for `.dataset`/`.classList` here silently returns `undefined` and drops the value —
and tests that mock the view tree won't catch it. Tell-tale signs you're on a *view* element
(keep `getAttribute`): nearby `consumable.consume(...)`, `el.is( 'element', … )`,
`el.getChild(...)`, an `editor.conversion.for( 'upcast' )` registration, or a view `writer`. The
DOM API (`.dataset`, `.classList`) only applies to a genuine DOM element (e.g. from
`document.createElement(...)` or `domConverter.mapViewToDom(...)`).

## Position mapping (inline widgets / structural mismatch)

When the view has "more" content than the model (e.g. a `<placeholder>` model element renders
as `<span>{name}</span>`), some view positions can't auto-map to the model and you get
`model-nodelist-offset-out-of-bounds`. Fix with the ready-made utility:

```js
import { viewToModelPositionOutsideModelElement } from 'ckeditor5';

editor.editing.mapper.on( 'viewToModelPosition',
	viewToModelPositionOutsideModelElement( editor.model, v => v.hasClass( 'placeholder' ) ) );
```

This maps any position inside the view `<span>` to a position **outside** the model element.

## Preprocessing input data (data processor)

Upcast operates on the view the **data processor** produced from the input string. To massage the
raw HTML *before* it becomes a view (e.g. protect content the HTML parser would mangle), wrap the
processor's `toView`:

```js
const processor = editor.data.processor;
const toView = processor.toView.bind( processor );
processor.toView = data => toView( preprocess( data ) );   // and mirror toData for output if needed
```

Use sparingly — prefer real converters. It's for cases the converter layer can't reach, such as
preserving newlines inside a formula or shielding a fragment from generic HTML normalization.
This is the pattern Trilium's `ckeditor5-math` / `ckeditor5-mermaid` use: a data-processor wrap
guards the raw formula/diagram source while a `createUIElement` render callback (see the element
callbacks above) renders the external/async output into the editing view.

## Where to go deeper

The official CKEditor 5 "Conversion deep dive" docs (ckeditor.com/docs → Framework › Deep dive ›
Conversion) cover
`elementToStructure`, reconversion/triggers, marker conversion, and data processors. For
widget-specific conversion patterns see `widgets.md`.
