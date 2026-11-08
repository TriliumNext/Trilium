# Test patterns (Trilium, Vitest)

Idiomatic recipes per concern. All examples assume a real `ClassicEditor` created in `beforeEach`
(see `test-utilities.md`). Mirror the structure of the feature: an `*editing` test for
schema/conversion/command, a `*ui` test for buttons/dropdowns. Assertions may be **Jest-style**
(`toBe`/`toEqual`) or **Chai-style** (`to.equal`/`to.be.false`) — both work in Vitest; the examples
use Jest-style.

## Setup / teardown

In the aggregate (`packages/ckeditor5`), use the shared editor kit — `createTestEditor()` from
`test/editor-kit.ts` builds the editor (`licenseKey: 'GPL'`, auto-tracked) and the global
`afterEach` in `test/setup.ts` destroys it, so a spec needs **no** editor-teardown `afterEach`:

```ts
import { ClassicEditor, Paragraph } from 'ckeditor5';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createTestEditor } from '../../test/editor-kit.js';
import MyFeature from './myfeature.js';

let editor: ClassicEditor, model;

beforeEach( async () => {
	editor = await createTestEditor( [ Paragraph, MyFeature ] );
	model = editor.model;
} );
```

Return the Promise (or use `async`/`await`) so Vitest waits. Default `testTimeout` is 5000 ms. Need
the host element? It's `editor.sourceElement` (or `getEditorElement( editor )` from the kit). The
standalone packages (and legacy specs mid-migration) still hand-roll the scaffold —
`document.createElement('div')` + `ClassicEditor.create(...)` + an `afterEach` that calls
`editor.destroy()` and `editorElement.remove()`.

## Stubbing the host and browser globals

Everything the plugins need from Trilium comes through the editor config, so a spec passes it to
`createTestEditor( plugins, { … } )`: `formatDateTime` (date/time),
`referenceLink: { getTitle, getTitleSync, renderTitle, fixLink }` (reference links), `linkEmbed` (link previews —
`createLinkEmbedHost()` in `test/link-embed-kit.ts` builds the mocked entry), and `getNoteId` plus
`attachmentUpload: { getHeaders, getLocalUpload, getEmbedBoxSize }` (uploads), and the dialogs a
button hands over to the host: `internalLink: { openDialog }`, `markdownImport: { open }`,
`contentEmbed` (`pickNote`, the `load…` renderers, `getTools`, `enter` and the rest of
`ContentEmbedHost`), `cutToNote: { cut, saveNow }`, `inlineIcon: { showPicker }`,
`blockReference: { openHandleMenu, copyReference }`, `tabs: { copyReference }` and
`imageToDrawing: { convert }`. Each falls back to a placeholder or a no-op when left out (an
upload without `getNoteId` is rejected), so a spec that does not assert on it can omit it. A
spec sharing one editor across tests can swap an entry with `editor.config.set()`, which the
plugins read at call time.

The editor package reads no Trilium global and calls no jQuery. A spec that has to swap a browser
global (`navigator.clipboard`, a `window` method) queues its restore with `registerTestCleanup()`
from `test/globals-test-kit.ts`, which the global `afterEach` in `test/setup.ts` runs:

```ts
import { registerTestCleanup } from '../../test/globals-test-kit.js';

const original = navigator.clipboard;
Object.defineProperty( navigator, 'clipboard', { value: clipboard, configurable: true } );
registerTestCleanup( () => {
	Object.defineProperty( navigator, 'clipboard', { value: original, configurable: true } );
} );
```

Browser mode runs every spec in **one shared page**, so a global left swapped leaks into later specs
and causes test-order-dependent failures.

## Schema

```ts
it( 'allows the highlight attribute on $text', () => {
	expect( model.schema.checkAttribute( [ '$root', '$text' ], 'highlight' ) ).toBe( true );
} );

it( 'registers placeholder as an inline object', () => {
	expect( model.schema.isRegistered( 'placeholder' ) ).toBe( true );
	expect( model.schema.isInline( 'placeholder' ) ).toBe( true );
	expect( model.schema.checkChild( [ '$root', '$block' ], 'placeholder' ) ).toBe( true );
} );
```

## Conversion (round-trips)

Test each direction with the data helpers. Upcast = `setData` then read the model; data downcast =
`setModelData` then `getData`; editing downcast = read `_getViewData`.

```ts
it( 'upcasts <mark> to the highlight attribute', () => {
	editor.setData( '<p>foo <mark>bar</mark></p>' );
	expect( _getModelData( model, { withoutSelection: true } ) )
		.toEqual( '<paragraph>foo <$text highlight="true">bar</$text></paragraph>' );
} );

it( 'data-downcasts the highlight attribute to <mark>', () => {
	_setModelData( model, '<paragraph>foo <$text highlight="true">bar</$text></paragraph>' );
	expect( editor.getData() ).toEqual( '<p>foo <mark>bar</mark></p>' );
} );

it( 'editing-downcasts to <mark> in the editing view', () => {
	_setModelData( model, '<paragraph>foo <$text highlight="true">bar</$text></paragraph>' );
	expect( _getViewData( editor.editing.view, { withoutSelection: true } ) )
		.toEqual( '<p>foo <mark>bar</mark></p>' );
} );
```

For widgets, assert the editing view contains the widget classes/attributes (`ck-widget`,
`contenteditable`) while `getData()` stays clean. Widget rendering needs real layout, which the
browser-mode runner provides.

## Commands

Cover `value`, `isEnabled`, and `execute()` — for **collapsed and ranged** selections and for
**schema-disallowed** contexts (where `isEnabled` must be `false`). Instantiate the command
directly when convenient.

```ts
const command = new InsertMermaidCommand( editor );

describe( 'isEnabled', () => {
	it( 'is false when a mermaid element is selected', () => {
		_setModelData( model,
			'<paragraph>foo</paragraph>[<mermaid source="flowchart TB"></mermaid>]' );
		expect( command.isEnabled ).toBe( false );
	} );
} );

describe( 'execute()', () => {
	it( 'applies the attribute to a ranged selection', () => {
		_setModelData( model, '<paragraph>[foobar]</paragraph>' );
		command.execute();
		expect( _getModelData( model ) )
			.toEqual( '<paragraph>[<$text highlight="true">foobar</$text>]</paragraph>' );
	} );
} );
```

## UI (component factory, button binding, execute)

`editor.ui` exists on the real editor. Verify the factory produces the right view, the button
reflects command state, and clicking it runs the command. UI/balloon positioning needs real
layout — keep these in a **browser-mode** package.

```ts
it( 'registers a ButtonView', () => {
	expect( editor.ui.componentFactory.create( 'highlight' ) ).toBeInstanceOf( ButtonView );
} );

it( 'executes the command on click and refocuses the editor', () => {
	const button = editor.ui.componentFactory.create( 'highlight' );
	const executeSpy = vi.spyOn( editor, 'execute' );
	const focusSpy = vi.spyOn( editor.editing.view, 'focus' );
	button.fire( 'execute' );
	expect( executeSpy ).toHaveBeenCalledWith( 'highlight' );
	expect( focusSpy ).toHaveBeenCalledOnce();
} );
```

For dropdowns, `create()` the component, inspect `dropdownView.listView`/`buttonView`, fire
`execute` on items, and assert the command ran with the expected `value`/`commandParam`.

## Keystrokes

```ts
it( 'executes the command on Ctrl+Alt+H', () => {
	const spy = vi.spyOn( editor, 'execute' );
	const wasHandled = editor.keystrokes.press( {
		keyCode: keyCodes.h, ctrlKey: true, altKey: true,
		preventDefault: () => {}, stopPropagation: () => {}
	} );
	expect( spy ).toHaveBeenCalledWith( 'highlight' );
	expect( wasHandled ).toBe( true );
} );
```

(`keyCodes` from `'ckeditor5'`.) For view-document keydown handlers, fire on
`editor.editing.view.document`.

## Events & observables

```ts
it( 'fires change:value', () => {
	const spy = vi.fn();
	command.on( 'change:value', spy );
	_setModelData( model, '<paragraph><$text highlight="true">[]x</$text></paragraph>' );
	expect( spy ).toHaveBeenCalled();
} );
```

## Spies, mocks, timers

- `vi.spyOn( obj, 'method' )` — wrap and observe (optionally `.mockImplementation(...)`).
- `vi.fn()` — standalone mock callback.
- `vi.useFakeTimers()` / `vi.advanceTimersByTime()` / `vi.useRealTimers()` — for debounced or
  timeout-based code; restore in `afterEach`.

## Errors / warnings

```ts
it( 'throws on invalid config', () => {
	expect( () => editor.something() ).toThrow( /my-feature-error/ );
} );
```

For `CKEditorError`, match the error id substring.

### Errors that escape the editor (`onEditorError()`)

CKEditor 49 reports an escaped error from `window`'s `error` and `unhandledrejection` events, and
only a `CKEditorError` whose `context` resolves to a ready editor. Native errors arrive wrapped by
`CKEditorError.rethrowUnexpectedError(error, context)` (`unexpected-error … Original error: …`).
Test a listener by dispatching the event a thrown error would raise (`src/editor_errors.spec.ts`):

```ts
function escape( error: Error ) {
	const listener = () => {};
	window.addEventListener( 'error', listener );
	window.dispatchEvent( new ErrorEvent( 'error', { error } ) );
	window.removeEventListener( 'error', listener );
}
```

The extra listener is the point: Vitest's browser runner reports an `error` event as an
**unhandled error** (failing the run) whenever no user listener is registered on `window`, and
`preventDefault()` does not change that. Once the code under test unregisters its own listener, an
event dispatched without one fails the file even though every test passed.

## Measuring real CSS

Specs that assert layout load a stylesheet and read `getComputedStyle()` /
`getBoundingClientRect()` (`tile_row_view.spec.ts`, `multicolumn_layout.spec.ts`):

- `import url from "ckeditor5/ckeditor5.css?url"` plus a `<link>` loads CKEditor's sheet as the app
  does. `?inline` returns the CSS text with `@import`s resolved — use it to load a client
  stylesheet chain (`apps/client/src/stylesheets/style.css?inline`) into a `<style>`. `?raw` keeps
  `@import` lines as text, which the browser then cannot resolve.
- Disable transitions (`* { transition: none !important; }`) before reading `box-shadow` or
  colors of a state you just entered; otherwise you read the transition's first frame.
- `element.focus()` from a test counts as `:focus-visible`.
- To compare a stylesheet between two CKEditor versions, don't write a spec: use `ck_css.mjs` from
  the `ckeditor5-plugin-development` skill (`references/upgrading-ckeditor.md`).

## Reaching 100% coverage

`ckeditor5` gates `src/**` at 100%
(lines/functions/branches/statements, provider `v8`). Every branch needs a test: both states of
each boolean, each schema-allowed/disallowed path, collapsed vs. ranged selection, and error/guard
branches. Run the package's `test` script and read the coverage text report to find uncovered
lines before pushing.

When a branch resists covering, first ask whether it is reachable at all — Trilium's plugins have
repeatedly turned out to carry guards that nothing can trigger (an `if` over a non-empty array
literal, a selection fallback on an `isObject` element, a post-fixer branch the model writer
normalises away). The fix is to delete or simplify the dead code, not to invent a test for it. If
the guard genuinely earns its keep, keep it and mark it `/* v8 ignore next N -- why */` with the
reason spelled out. Two traps worth knowing: a disabled CKEditor `Command` silently skips
`execute()`, so a guard inside it needs `command.isEnabled = true` first; and CKEditor's own
plugins may call `preventDefault()` on an event, so use a spy on `editor.execute` (or assert the
model) rather than `preventDefault` to prove your handler ran.
