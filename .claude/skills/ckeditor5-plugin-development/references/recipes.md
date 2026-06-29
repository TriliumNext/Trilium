# Recipes (task-oriented how-tos)

Task-oriented snippets for Trilium's CKEditor plugins (`packages/ckeditor5-*`). All library
symbols import from `ckeditor5` (48.2.0); local imports carry file extensions. All model
mutations run inside `editor.model.change( writer => … )`. In Trilium the "document" is the
content of a single text note, so these recipes operate over that note's model root.

## Get the editor instance

Inside plugin code you already have it: `this.editor` (in a `Plugin`/`Command` subclass) or the
`editor` argument of a function plugin / converter / `componentFactory` callback. You don't fetch
it from the DOM — in Trilium the editor is created and owned by the React watchdog component
(`apps/client/src/widgets/type_widgets/text/CKEditorWithWatchdog.tsx`), not by plugin code.

```js
class MyPlugin extends Plugin {
	init() { const editor = this.editor; /* … */ }
}
```

## Insert content

```js
// Text with an attribute (e.g. a link) at the selection:
editor.model.change( writer => {
	const pos = editor.model.document.selection.getFirstPosition();
	editor.model.insertContent( writer.createText( 'CKEditor 5 rocks!', { linkHref: 'https://ckeditor.com/' } ), pos );
} );

// Plain text:
editor.model.insertContent( writer.createText( 'Plain text' ), pos );

// A chunk of HTML → model fragment → insert:
const viewFragment = editor.data.processor.toView( '<p>A <a href="...">link</a>.</p>' );
const modelFragment = editor.data.toModel( viewFragment );
editor.model.insertContent( modelFragment );
```

`insertContent()` respects the schema; unconverted elements/attributes are dropped.

## Focus the editor / editing view

```js
editor.focus();
editor.editing.view.focus();
```

## Place the caret at start / end

```js
editor.model.change( writer => {
	writer.setSelection( writer.createPositionAt( editor.model.document.getRoot(), 0 ) );      // start
	writer.setSelection( writer.createPositionAt( editor.model.document.getRoot(), 'end' ) );   // end
} );
```

## Delete selected blocks

```js
const blocks = Array.from( editor.model.document.selection.getSelectedBlocks() );
editor.model.change( writer => {
	const range = writer.createRange(
		writer.createPositionAt( blocks[ 0 ], 0 ),
		writer.createPositionAt( blocks[ blocks.length - 1 ], 'end' )
	);
	editor.model.deleteContent( writer.createSelection( range ) );
} );
```

## Find / iterate specific elements

```js
// Remove all block images:
editor.model.change( writer => {
	const range = writer.createRangeIn( editor.model.document.getRoot() );
	const toRemove = [];
	for ( const { item } of range.getWalker() ) {
		if ( item.is( 'element', 'imageBlock' ) ) toRemove.push( item );
	}
	toRemove.forEach( item => writer.remove( item ) );
} );

// Collect unique link targets:
const links = new Set();
for ( const { type, item } of editor.model.createRangeIn( editor.model.document.getRoot() ).getWalker() ) {
	if ( type === 'text' && item.hasAttribute( 'linkHref' ) ) links.add( item.getAttribute( 'linkHref' ) );
}

// Trilium: count every admonition in the current note's content:
let count = 0;
for ( const { item } of editor.model.createRangeIn( editor.model.document.getRoot() ).getWalker() ) {
	if ( item.is( 'element', 'admonition' ) ) count++;
}
```

`item.is(...)` is the canonical type check: `is('element', 'name')`, `is('$text')`,
`is('rootElement')`, `is('element')`, etc. This same walk powers footnotes' dynamic dropdown,
which scans the note for existing `footnote` elements each time it opens.

## Set an attribute on the editable DOM root

```js
editor.editing.view.change( writer => {
	writer.setAttribute( 'myAttribute', 'value', editor.editing.view.document.getRoot() );
} );
```

## Custom DOM-event observer (e.g. double-click)

```js
import { DomEventObserver } from 'ckeditor5';

class DoubleClickObserver extends DomEventObserver {
	constructor( view ) { super( view ); this.domEventType = 'dblclick'; }
	onDomEvent( domEvent ) { this.fire( domEvent.type, domEvent ); }
}

const view = editor.editing.view;
view.addObserver( DoubleClickObserver );
editor.listenTo( view.document, 'dblclick', ( evt, data ) => { /* … */ }, { context: 'a' } );
```

Check for an existing observer that already fires the DOM event before adding your own.

## Extend another plugin's UI (e.g. add a button to the link form)

```js
import { ButtonView, Plugin, LinkUI } from 'ckeditor5';

class InternalLink extends Plugin {
	init() {
		const linkUI = this.editor.plugins.get( LinkUI );
		const balloon = this.editor.plugins.get( 'ContextualBalloon' );
		this.listenTo( balloon, 'change:visibleView', ( evt, name, visibleView ) => {
			if ( visibleView === linkUI.formView ) {
				const button = new ButtonView( this.editor.locale );
				button.set( { label: 'Internal link', withText: true, tooltip: true } );
				button.bind( 'isEnabled' ).to( this.editor.commands.get( 'link' ) );
				button.render();
				linkUI.formView.registerChild( button );
				linkUI.formView.element.insertBefore( button.element, linkUI.formView.saveButtonView.element );
			}
		} );
	}
}
```

## Widget: one view element ↔ multiple/nested model elements

Upcast builds a model sub-structure from a single view element; `editingDowncast` converts
each model element separately (outer → `toWidget`, inner → `toWidgetEditable`); `dataDowncast`
collapses the structure back into one (or a few) view elements, consuming the inner items so
other converters skip them. Trilium's admonition and collapsible plugins are exactly this
shape (a container widget wrapping nested editable content) — see their `*editing.ts` and
`widgets.md` for the full treatment.

## Extend another Trilium plugin's UI

The same `linkUI.formView` pattern above works in Trilium to add an "internal link" button to
the link balloon — Trilium uses it to inject note-link affordances into CKEditor's link form.
Get the upstream plugin via `editor.plugins.get( LinkUI )` and the shared balloon via
`editor.plugins.get( 'ContextualBalloon' )`; both come from `ckeditor5`.

## Build-time gotcha

A large client build can hit `JavaScript heap out of memory`; raise Node's heap for the build
command: `NODE_OPTIONS="--max-old-space-size=4096"`.
