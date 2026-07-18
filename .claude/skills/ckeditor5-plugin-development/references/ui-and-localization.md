# UI library & localization (Trilium)

In the Trilium monorepo every CKEditor plugin (`packages/ckeditor5-*`) builds its UI with the
library's UI layer, imported from `ckeditor5` (pinned 48.2.0). It is a small MVC: **Views**
render DOM via **Templates**, expose **observable** properties, and are organized into
**collections** that form the UI tree. Features talk to views through observables — never the
native DOM directly. Trilium's text editor runs as one of three classes — `AttributeEditor`
(Balloon), `ClassicEditor` (Decoupled), `PopupEditor` (Balloon + `BlockToolbar`) — but a
plugin's views are identical across all three; only the toolbar host differs.

## Views & templates

A `View` builds its DOM with `setTemplate()` and exposes observable state via `set()`:

```js
import { View } from 'ckeditor5';

class SimpleInputView extends View {
	constructor( locale ) {
		super( locale );
		const bind = this.bindTemplate;            // bind observables → DOM
		this.set( { isEnabled: false, placeholder: '' } );
		this.setTemplate( {
			tag: 'input',
			attributes: {
				class: [ 'foo', bind.if( 'isEnabled', 'ck-enabled' ) ],
				placeholder: bind.to( 'placeholder' ),
				type: 'text'
			},
			on: { keydown: bind.to( 'input' ) }     // DOM event → view 'input' event
		} );
	}
	setValue( v ) { this.element.value = v; }       // owned DOM access lives in the view
}
```

Rules & best practices:
- **Always pass `locale`** to view/component constructors.
- A standalone view must be `render()`ed before injecting `view.element` into the DOM; child
  views added to a collection are rendered/destroyed by the editor automatically.
- **Encapsulate the DOM**: features set view observables or `bind()` to them; never write
  `view.element.placeholder = …` directly (it collides with bindings).
- Template supports `tag`, `attributes` (incl. `class` arrays, `style` objects),
  `children` (views/strings/collections), and `on` event bindings. `bind.to(prop)` /
  `bind.if(prop, value, callback)` wire observables; templates also forward DOM events.
- Create child collections with `this.createCollection([...])`; the UI tree has no depth limit.

## View collections & the UI tree

Each editor UI has a root view at `editor.ui.view`. A `BoxedEditorUIView` exposes `top`
(toolbar), `main` (editable), and inherited `body` (floating elements in `<body>`). Plugins
add views into these collections so they're managed (initialized/destroyed) with the editor:

```js
class MyPlugin extends Plugin {
	init() { this.editor.ui.top.add( new MyPluginView() ); }
}
```

## Registering toolbar components

Register every toolbar/UI component in the **component factory** under a name; that name is
then listed in Trilium's toolbar config at
`apps/client/src/widgets/type_widgets/text/toolbar.ts` (not an end-user config):

```ts
editor.ui.componentFactory.add( 'admonition', locale => {
	const button = new ButtonView( locale );
	button.set( { label: editor.t( 'Admonition' ), icon: admonitionIcon, tooltip: true } );
	button.on( 'execute', () => { editor.execute( 'admonition' ); editor.editing.view.focus(); } );
	return button;
} );
// toolbar.ts then references: 'admonition'
```

A registered name only appears in the editor when it is added to `toolbar.ts`; registering the
component factory entry alone is not enough. Real examples: the admonition button/dropdown
(`packages/ckeditor5-admonition/src/admonitionui.ts`), the footnotes insert button + dynamic
"insert existing footnote" dropdown (`packages/ckeditor5-footnotes/src/footnote-ui.ts`).

**Best practice:** on any user action (button/dropdown execute), call
`editor.editing.view.focus()` so the editor keeps focus.

## Trilium toolbars (`toolbar.ts`)

*Which* names appear, and *where*, is decided in
`apps/client/src/widgets/type_widgets/text/toolbar.ts`. `buildToolbarConfig(isClassicToolbar)`
picks one of three layouts:

- **`buildClassicToolbar()`** — the fixed, multi-row toolbar above the editable (used by
  `ClassicEditor`). Returns `{ toolbar: { items: [ … ] } }`.
- **`buildFloatingToolbar()`** — used by `PopupEditor`. Returns **two** floating toolbars:
  `{ toolbar: { items: [ … ] }, blockToolbar: [ … ] }` — a **selection toolbar** (a balloon over
  the selected text) and a **block toolbar** (the `BlockToolbar` plugin, present only in
  `POPUP_EDITOR_PLUGINS`, shown at the start of the current block).
- **`buildMobileToolbar()`** — a single flattened `items` array for touch (checked first).

Each `items` / `blockToolbar` entry is one of:

```ts
"bold"                                    // a component-factory name (string)
"|"                                       // a visual separator
{ label: "Insert", icon, items: [         // a grouped dropdown (nestable)
	"link", "internallink", "includeNote", "|", "collapsible", "math", "mermaid"
] }
```

So adding a custom toolbar item is a **two-step** wire-up: register the component in your plugin's
`*ui.ts` (above), **and** add its name to the right array(s) in `toolbar.ts` — classic, the floating
`toolbar`, the floating `blockToolbar`, and/or mobile, as appropriate. Registering the component
alone makes it available but invisible. (`AttributeEditor`'s minimal toolbar isn't built here.)

> A **widget contextual toolbar** — buttons that appear when a widget is *selected* — is different:
> it's registered inside the plugin via `WidgetToolbarRepository`, **not** listed in `toolbar.ts`.
> See `widgets.md`.

## Component catalog

| Component | Purpose / key props |
|-----------|---------------------|
| `ButtonView` | `label`, `withText`, `icon`, `tooltip`, `tooltipPosition`, `isOn`, `isEnabled`, `isToggleable`, `keystroke`, `withKeystroke`, `class`; fires `execute`. |
| `SwitchButtonView` | Toggle button; flips `isOn`; bind to a toggle command's `value`/`isEnabled`. |
| `DropdownButtonView` / `SplitButtonView` | Dropdown trigger buttons; `SplitButtonView` exposes `actionView` (main region). |
| `DropdownView` | Created via `createDropdown(locale[, SplitButtonView])`; has `buttonView` + `panelView`. |
| `ToolbarView` | `items` collection; `isCompact`; `ToolbarSeparatorView`, `ToolbarLineBreakView` for layout. |
| `LabeledFieldView` | Input + label: `new LabeledFieldView(locale, createLabeledInputText | createLabeledInputNumber)`; `fieldView.element.value`. |
| `InputTextView` / `TextareaView` | Raw inputs; `TextareaView` has `minRows`, `maxRows`, `resize`. |
| `SearchTextView` / `AutocompleteView` | Search/filter UIs (filtered view must implement `.filter()`/`.focus()`). |
| `IconView` | SVG display; `iconView.content = IconBold`. |
| `SpinnerView` | Loading spinner; `isVisible`. |
| `BalloonPanelView` | Low-level floating panel (`.pin({target, positions})`). Usually use `ContextualBalloon`. |
| `View` + `setTemplate` | Arbitrary custom UI / dialog content. |

## Icons

Built-in icons come from the bundle and assign to a view's `icon`/`content`:

```ts
import { IconBold, IconCheck, IconCancel, IconQuote } from 'ckeditor5';
button.set( { icon: IconBold } );
```

For a **custom** icon, Trilium plugins import the raw SVG XML string with the `?raw` suffix,
keep the file under `theme/icons/`, and re-export an `icons` map from `index.ts` (so the
aggregator can collect them):

```ts
// index.ts
import admonitionIcon from '../theme/icons/admonition.svg?raw';
export const icons = { admonitionIcon };

// admonitionui.ts
button.set( { icon: admonitionIcon } );      // the raw SVG string
```

`icon` accepts the full SVG XML string. For a recolorable icon, strip `fill`/`stroke`
attributes from the SVG so it inherits `currentColor`.

## Dropdowns

Use `createDropdown` + the appropriate `add…ToDropdown` helper; don't compose from scratch
unless necessary. Default dropdowns auto-close on blur and on `execute`, and focus their panel
content for keyboard nav.

```js
import { createDropdown, addListToDropdown, addToolbarToDropdown, addMenuToDropdown,
         SplitButtonView, ViewModel, Collection } from 'ckeditor5';

const dropdown = createDropdown( locale );
dropdown.buttonView.set( { label: 'Label', withText: true, tooltip: true, icon } );

// List dropdown
const items = new Collection();
items.add( { type: 'button', model: new ViewModel( { label: 'Foo', withText: true, commandParam: 'foo' } ) } );
addListToDropdown( dropdown, items );
dropdown.on( 'execute', evt => editor.execute( 'cmd', { value: evt.source.commandParam } ) );

// Toolbar dropdown (split button)
const dd2 = createDropdown( locale, SplitButtonView );
addToolbarToDropdown( dd2, [ buttonA, buttonB ] );
dd2.bind( 'isEnabled' ).toMany( [ buttonA, buttonB ], 'isEnabled', ( ...e ) => e.some( Boolean ) );

// Menu dropdown
addMenuToDropdown( dropdown, editor.body.ui.view, [
	{ id: 'menu_1', menu: 'Menu 1', children: [ { id: 'a', label: 'Item A' } ] },
	{ id: 'top_a', label: 'Top Item A' }
] );
```

Even when `withText` is false, set `label` for screen readers.

In Trilium, the admonition type picker is a list dropdown built from `ADMONITION_TYPES`
(`packages/ckeditor5-admonition/src/admonitionui.ts`), and footnotes builds its list
dynamically from the footnotes already present in the note
(`packages/ckeditor5-footnotes/src/footnote-ui.ts`) — re-reading the model each time the
dropdown opens.

## Contextual balloon

For floating forms/toolbars pinned to the selection, use the `ContextualBalloon` plugin
(only one visible view at a time). Pattern from the abbreviation feature:

```js
import { ContextualBalloon, clickOutsideHandler } from 'ckeditor5';

static get requires() { return [ ContextualBalloon ]; }

init() {
	this._balloon = this.editor.plugins.get( ContextualBalloon );
	this.formView = this._createFormView();
}
_showUI() {
	this._balloon.add( { view: this.formView, position: this._getBalloonPositionData() } );
	this.formView.focus();
}
_getBalloonPositionData() {
	const view = this.editor.editing.view;
	return { target: () => view.domConverter.viewRangeToDom( view.document.selection.getFirstRange() ) };
}
_hideUI() { this._balloon.remove( this.formView ); this.editor.editing.view.focus(); }

// Hide on outside click:
clickOutsideHandler( {
	emitter: formView,
	activator: () => this._balloon.visibleView === formView,
	contextElements: [ this._balloon.view.element ],
	callback: () => this._hideUI()
} );
```

A custom form view extends `View`, builds inputs via `LabeledFieldView`, groups children in a
collection, uses `submitHandler({ view: this })` in `render()` to turn native submit into a
`submit` event, delegates button events (`cancelButtonView.delegate('execute').to(this,'cancel')`),
and exposes a `focus()` method. Add `tabindex: '-1'` and the `ck` class to UI roots.

## Dialogs & modals

The `Dialog` plugin shows views in a dialog (`isModal: false`) or modal (`isModal: true`,
blocks page interaction). Only one open at a time.

```js
const dialog = editor.plugins.get( 'Dialog' );
dialog.show( {
	id: 'myDialog',
	isModal: true,
	title: 'My dialog',
	icon: IconPencil,          // header icon (optional)
	hasCloseButton: true,      // default true when icon/title present
	content: someView,         // a View or collection of Views
	position: DialogViewPosition.EDITOR_BOTTOM_CENTER, // optional
	actionButtons: [
		{ label: 'OK', class: 'ck-button-action', withText: true, onExecute: () => dialog.hide() },
		{ label: 'Cancel', withText: true, onExecute: () => dialog.hide() }
	],
	onShow: dlg => { /* set listeners/initial values */ },
	onHide: dlg => { /* reset state */ }
} );
dialog.hide();
```

- Lifecycle events: `show` / `show:[id]`, `hide` / `hide:[id]` (on the plugin), and the
  view's `close` event (`data.source === 'escKeyPress'`). Listen to customize position or
  block Esc — but **always leave a way to close**; never trap users.
- Action buttons support `onCreate(buttonView)` and `onExecute()`; bind button `isEnabled` to
  content state to require user actions.
- `dialog.view.updatePosition()` re-applies the configured default position.
- Full keyboard a11y: Ctrl+F6 moves focus editor↔dialog; Esc closes; Tab/Shift+Tab navigate.

## Focus & keystroke management

Build accessible UI with these utility classes (see the abbreviation level-3 feature):

- `FocusTracker` — observes elements and exposes observable `isFocused` / `focusedElement`.
  `focusTracker.add( view.element )`.
- `KeystrokeHandler` — runs actions for keystrokes within a scope. `keystrokes.listenTo(el)`;
  `keystrokes.set( 'Tab', ( data, cancel ) => { …; cancel(); }, { priority } )`. Each view
  typically owns one.
- `FocusCycler` — cycles focus across a collection of focusables (Tab/Shift+Tab):
  `new FocusCycler( { focusables, focusTracker, keystrokeHandler, actions: { focusPrevious: 'shift + tab', focusNext: 'tab' } } )`.
- **Destroy** `focusTracker` and `keystrokes` in the view's `destroy()` to avoid leaks.

Editor-level keystrokes bind to commands directly via `EditingKeystrokeHandler`:

```js
editor.keystrokes.set( 'Ctrl+Alt+H', 'highlight' );        // command name
editor.keystrokes.set( 'Ctrl+Alt+H', ( evt, cancel ) => { editor.execute( 'highlight' ); cancel(); } );
```

Register shortcuts in the a11y help dialog and the button tooltip:

```js
const t = editor.t;
editor.accessibility.addKeystrokeInfos( {
	keystrokes: [ { label: t( 'Highlight text' ), keystroke: 'Ctrl+Alt+H' } ]
} );
button.set( { /* … */ keystroke: 'Ctrl+Alt+H' } );          // shows in tooltip
```

Keys map to platform conventions automatically (e.g. `Ctrl` → `Cmd` on macOS).

## Localization with `editor.t()`

Every user-facing string must pass through the editor's translation function so it can be
localized. Trilium ships translations as **gettext PO files per package** — not the upstream
`window.CKEDITOR_TRANSLATIONS` / `add()` / webpack-bundled-language flow.

- Get the function from the editor/locale: `const t = editor.t;`, `const { t } = editor.locale;`,
  or in a view `const t = this.t;` (`editor.locale.t` is the same function as `editor.t`).
- **First arg must be a string or object literal**, never a variable — the build scans source
  for these literals to extract message ids.

```ts
const t = editor.t;
t( 'Admonition' );                                     // simple
t( 'Insert %0', label );                               // placeholder; array also ok
t( { string: '%0 footnote', plural: '%0 footnotes', id: 'N_FOOTNOTES' }, quantity ); // plural
t( { string: '%0', id: 'ACTION_INSERT' }, 'insert' );  // disambiguating id
```

### Where translations live

Each Trilium plugin keeps two files under `lang/`:

- **`lang/en.po`** — the gettext catalog. Each entry is `msgctxt` (translator context) +
  `msgid` (the source string passed to `t()`) + `msgstr` (the translation):

  ```po
  msgctxt "Toolbar button tooltip for the Admonition feature."
  msgid "Admonition"
  msgstr "Admonition"
  ```

- **`lang/contexts.json`** — maps each message id to a short context string for translators
  (mirrors the `msgctxt`):

  ```json
  { "Admonition": "Toolbar button tooltip for the Admonition feature." }
  ```

When you add a new `t( '…' )` string, add a matching `msgid`/`msgctxt`/`msgstr` block to
`en.po` and an entry to `contexts.json`. See `packages/ckeditor5-admonition/lang/` for the
canonical pair.

### Custom `translate` config fallback

Some Trilium plugins (e.g. collapsible) also accept a `translate` function via editor config,
falling back to the identity function so the string is used verbatim when none is supplied:

```ts
const translate = ( editor.config.get( 'translate' ) as
	( ( key: string, params?: Record<string, unknown> ) => string ) | undefined )
	?? ( ( key: string ) => key );
```

See `packages/ckeditor5-collapsible/src/collapsible-ui.ts` and `collapsible-editing.ts`. This
is independent of `editor.t()`/PO catalogs — it lets the host (Trilium) inject its own
translator for plugin-specific labels.
