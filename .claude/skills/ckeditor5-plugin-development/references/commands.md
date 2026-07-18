# Commands

A **command** = an **action** (`execute()`) + a **state** (observable properties, kept fresh
by `refresh()`). Commands encapsulate feature logic so UI, keystrokes, other plugins, and
`editor.execute()` can all trigger and observe it. Most editor features expose their behavior
as commands.

> `Command` and `AttributeCommand` come from the **`ckeditor5` library** (`48.2.0`), imported
> as `from 'ckeditor5'` (with file extensions). In Trilium you don't always write a command
> class: simple `$text`-attribute features reuse the built-in `AttributeCommand` —
> `ckeditor5-keyboard-marker` registers `new AttributeCommand( editor, '<attr>' )` and lets the
> library handle toggle/refresh (see `core-plugin-patterns.md` → Reusable AttributeCommand).
> Features with bespoke model mutations (e.g. `ckeditor5-admonition`, `ckeditor5-footnotes`)
> write a custom `Command` subclass as below.

## Defining and registering

Extend `Command`; register in the editing plugin's `init()`:

```js
import { Command } from 'ckeditor5';

class MyCommand extends Command {
	refresh() { /* set this.isEnabled / this.value */ }
	execute( ...args ) { /* mutate the model */ }
}

// In the plugin:
editor.commands.add( 'myCommand', new MyCommand( editor ) );
editor.execute( 'myCommand', arg ); // run it
editor.commands.get( 'myCommand' ); // get it
```

By convention command names are **action + feature**: `insertTable`, `uploadImage`,
`addAbbreviation`, `toggleSimpleBoxSecret` — not `tableInsert`.

## `refresh()` — state

Called automatically on **every** model document change, so state is always current. Set the
observable properties here:

- `this.isEnabled` — whether the command can run **now** (commonly a schema check).
- `this.value` — feature-specific state (e.g. is the selection already highlighted; the
  current attribute object; `undefined`/`null` when not applicable).

```js
refresh() {
	const { document, schema } = this.editor.model;
	this.value = document.selection.getAttribute( 'highlight' );
	this.isEnabled = schema.checkAttributeInSelection( document.selection, 'highlight' );
}
```

Other typical enablement checks: `schema.checkChild( selection.focus.parent, 'placeholder' )`
for insertion, or `schema.findAllowedParent( selection.getFirstPosition(), 'simpleBox' ) !== null`.

## `execute()` — action

Always mutate inside `model.change( writer => … )`. Handle collapsed vs. ranged selection.
Conventions seen across official features:

- Accept an options object: `execute( { value } )`, `execute( { title, abbr } )`,
  `execute( options = {} )` for toggles.
- **Boolean attributes:** set `true` to enable, **remove** the attribute to disable (yields
  `undefined`) — don't store `false`. Toggle = `options.value === undefined ? !this.value : options.value`.
- Inserting objects: prefer `model.insertObject( element, null, null, { setSelection: 'on' } )`
  or `model.insertContent()` — they split/validate per schema. `insertContent()`/`insertObject()`
  return a range; grab `.end` to place the selection after the insert.
- Ranged attribute application: iterate `schema.getValidRanges( selection.getRanges(), attr )`
  and `writer.setAttribute()` each; then manage selection attributes.
- Preserve existing inline attributes when inserting text: collect with
  `toMap( selection.getAttributes() )`, add yours, pass to `writer.createText( text, attrs )`.

Inline-attribute toggle example (collapsed handling shown):

```js
execute() {
	const model = this.editor.model;
	const selection = model.document.selection;
	const newValue = !this.value;
	model.change( writer => {
		if ( !selection.isCollapsed ) {
			for ( const range of model.schema.getValidRanges( selection.getRanges(), 'highlight' ) ) {
				newValue ? writer.setAttribute( 'highlight', true, range )
				         : writer.removeAttribute( 'highlight', range );
			}
		}
		newValue ? writer.setSelectionAttribute( 'highlight', true )
		         : writer.removeSelectionAttribute( 'highlight' );
	} );
}
```

## Command events

`Command#execute` is **decorated** into an event, and `value`/`isEnabled` are observable.
Listen to react before/after or to block:

```js
this.listenTo( someCommand, 'execute', () => {} );                       // after default action
this.listenTo( other, 'execute', evt => evt.stop(), { priority: 'high' } ); // block before it runs
command.on( 'change:value', ( evt, name, newVal, oldVal ) => {} );
```

## Disabling a command externally

Don't fight `refresh()`. Use the helper, which survives refreshes and stacks per-feature:

```js
const cmd = editor.commands.get( 'bold' );
cmd.forceDisabled( 'MyFeature' );    // stays disabled until cleared AND no one else holds it
cmd.clearForceDisabled( 'MyFeature' );
```

## Read-only mode and `affectsData`

Editor commands are blocked in read-only mode by default. If a command does **not** change
data and should stay enabled (and in other write-restricting modes), set `this.affectsData =
false` (default `true`, immutable for the editor's lifetime):

```js
class MyAlwaysEnabledCommand extends Command {
	constructor( editor ) { super( editor ); this.affectsData = false; }
}
```
