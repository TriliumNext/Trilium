# UI library & localization (Trilium)

In the Trilium monorepo every CKEditor plugin (`packages/ckeditor5-*`) builds its UI with the
library's UI layer, imported from `ckeditor5` (48 or later). It is a small MVC: **Views**
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
(`packages/ckeditor5/src/plugins/admonition/admonition_ui.ts`), the footnotes insert button + dynamic
"insert existing footnote" dropdown (`packages/ckeditor5/src/plugins/footnotes/footnote_ui.ts`).

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

For a **custom** icon, Trilium plugins import the raw SVG XML string with the `?raw` suffix. The
file lives in the package-wide `packages/ckeditor5/src/icons/` folder — prefixed when the bare name
would be too generic (`mermaid-info.svg`) — and is imported directly by whichever plugin file needs
it. The folded-in plugins used to re-export an `icons` map from a barrel `index.ts`; those barrels
are gone, and nothing consumed the maps:

```ts
// src/plugins/admonition/admonition_ui.ts
import admonitionIcon from '../../icons/admonition.svg?raw';

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
(`packages/ckeditor5/src/plugins/admonition/admonition_ui.ts`), and footnotes builds its list
dynamically from the footnotes already present in the note
(`packages/ckeditor5/src/plugins/footnotes/footnote_ui.ts`) — re-reading the model each time the
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

Every user-facing string must pass through the editor's translation function. Trilium's mechanism is
**the English text is the message id** — there are no translation keys in plugin code, no `.po`
catalogs, and no host `translate` callback. (Both of those existed once; every trace has been
removed. Ignore any older doc that mentions `lang/en.po`, `contexts.json`, `translation_overrides.ts`
or `config.get('translate')`.)

```ts
const t = editor.t;              // or locale.t, or this.t inside a View
t( 'Insert a table.' );
t( 'Insert footnote %0', index );
```

With no dictionary configured — a test, a standalone editor — `t()` returns the message id, so the
UI renders correct English instead of a raw key. That property is what makes the whole scheme safe.

### The two steps

1. **Call `t()` with the English text** at the point of use.
2. **Add the English entry** under `text-editor.ck` in
   `apps/client/src/translations/en/translation.json`, keyed by the *slug* of that text — lowercase,
   with every run of non-alphanumeric characters collapsed to `-` (`slugify()` in
   `packages/ckeditor5/src/messages.ts`):

   ```jsonc
   "text-editor": { "ck": { "insert-a-table": "Insert a table." } }
   ```

English only. Other locales come from Weblate.

Nothing else is maintained: there is no list of messages, because the English catalog **is** the
registry. `getCkLocale()` turns it into the dictionary CKEditor wants (`buildMessageDictionary()`),
keyed by English text and appended after the core translations.

`apps/client/src/services/i18n.spec.ts` enforces both directions by scanning this package's source —
a message with no entry fails, and an entry no message asks for fails too. Run it with
`pnpm --filter client exec vitest run src/services/i18n.spec.ts`.

### Two traps that fail silently

The scan matches `\bt\(` followed by a **quoted literal**. Both halves matter, and getting either
wrong produces a string that looks localized, passes typecheck, renders fine in English, and is
never translated in any locale:

- **The function has to be named `t`.** `translate('Save')` does not match `\bt\(`; neither does
  `_t('Save')`. `.t(` does, so `editor.t(…)` / `this.t(…)` are fine. If you inject a translator into
  a view or helper, name the parameter `t`.
- **The first argument has to be a literal.** `t( definition.title )` is invisible. This is the
  common failure when labels live in a table:

  ```ts
  // ✗ invisible to the registry — the label reaches t() as a variable
  const MODES = [ { value: 'card', label: 'Card' } ];
  label: t( mode.label )

  // ✓ a switch puts a literal at each call site
  export const MODES = [ 'card', 'embed' ] as const;
  export function getModeLabel( t: ( message: string ) => string, mode: Mode ): string {
      switch ( mode ) {
          case 'card': return t( 'Card' );
          case 'embed': return t( 'Embed' );
          default: return mode;   // unrecognized value renders as-is
      }
  }
  ```

  Existing examples: `getAdmonitionTitle()`, `getLinkDisplayModeLabel()`, `getBoxSizeLabel()`.
  Where a helper takes the label ready-made instead (`_createToolbarButton` in mermaid,
  `_registerButton` in image actions), translate at the **call site** and document that the
  parameter arrives translated.

### Upstream messages: call `t()`, add no entry

If CKEditor already ships the string, our dictionary merges **after** the core one, so an entry
would override the upstream translation in every locale. Call `t()` anyway — CKEditor's own catalog
resolves it — but do not add it to `text-editor.ck`. `i18n.spec.ts` recognizes upstream messages and
exempts them from the missing check, so this is only a hazard when adding entries by hand.

Check before adding:

```bash
node --input-type=module -e "const c=(await import('ckeditor5/translations/de.js')).default;
  console.log(new Set(Object.keys(c.de.dictionary)).has('Save'))"
```

Strings found this way so far: `Save`, `Cancel`, `Insert`, `Small`, `Page break`,
`Align left/center/right`, `Justify`, `Block quote`, `Code block`, `Table`, `Horizontal line`,
`Please try a different phrase or check the spelling.`

### Renaming an upstream string

Trilium calls CKEditor's bookmarks "anchors". That is the one case where a message id and its
English text differ, so the pairs are declared in `MESSAGE_OVERRIDES` (`messages.ts`) rather than
discovered — the dictionary must be keyed by the *upstream* id for CKEditor to find it, while the
text comes from our catalog entry for the replacement:

```ts
export const MESSAGE_OVERRIDES: Record<string, string> = {
    "Bookmark": "Anchor",
    "Edit bookmark": "Edit anchor"
};
```

The replacement needs its own English entry like any other message — that is what makes the rename
translatable per locale instead of English-only. A rename also applies when the locale has nothing,
since the English replacement is itself the point. **A plugin Trilium owns never belongs here:**
rename its message id at the call site.

### Interpolation

`%0`, `%1`, … — CKEditor's convention, not i18next's `{{name}}` and not a template literal:

```ts
t( 'Insert footnote %0', index );
t( 'No templates were found matching "%0".', query );
```

A placeholder lets a translator move the value; `` `Insert footnote ${index}` `` does not, and is
invisible to the scan besides. Nothing escapes the substituted value, so markup passes through — the
caller is responsible for the sanitizer settings of wherever it lands.

### Code that runs before an editor exists

The slash-command definitions are built by the host, with no editor to ask. They use
`translateMessage( hostTranslate, message, values )` from `messages.ts` — the same key derivation and
the same `%0` substitution, minus the editor:

```ts
const t: MessageTranslateFn = ( message, ...values ) => translateMessage( translate, message, values );
```

Note the local is still named `t`, so the literals at the call sites stay visible to the scan.

### Keystrokes inside a message

Don't resolve key names in this package. Key labels ("Ctrl" is "Strg" in German) live in the
app-wide `keyboard_shortcut_keys` catalog that the command palette and help dialog also read;
duplicating them here would fork fifteen strings and collide with upstream's `Insert`. The host
renders the whole shortcut and the plugin interpolates the markup:

```ts
import { renderShortcut } from '../../shortcut.js';

const title = editor.t( 'Click on the arrow or press %0 to collapse/expand.',
    renderShortcut( editor, TOGGLE_SHORTCUT ) );
```

`renderShortcut` reads the host's `renderShortcut` editor-config entry and falls back to the stored
form (`"Ctrl+Enter"`) when none is configured. The result is `<kbd>` markup, so the surface showing
it must not sanitize (both current callers set `sanitize: false` on their tooltip).

### What the checks cannot see

`i18n.spec.ts` only knows about strings the scan finds, so a string that reaches **no** translation
function at all is invisible to it — a bare `label: 'Copy to clipboard'` passes every test. A grep
for `label:`/`tooltip:`/`title:`/`placeholder:`/`aria-label` catches most, but not text built by
concatenation or assembled in a `setTemplate` children array. When reviewing a plugin, read its
strings rather than trusting a green suite.
