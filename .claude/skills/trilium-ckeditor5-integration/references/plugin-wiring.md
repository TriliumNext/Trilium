# Plugin wiring (arrays, toolbar, slash commands, translations)

All line numbers are against the repo at the time of writing; if one drifted, re-grep the symbol — the names are stable.

## The 5 plugin arrays and their exact reach

`packages/ckeditor5/src/plugins.ts` defines five arrays. `index.ts` maps each editor class to one of them.

| Array | Defined | Composition | Used by (`index.ts`) |
|---|---|---|---|
| `CORE_PLUGINS` | `plugins.ts:99` | `Clipboard, Enter, SelectAll, ShiftEnter, Typing, Undo, Paragraph, Mention, MentionCustomization, ReferenceLink` | `AttributeEditor.builtinPlugins` (`index.ts:39-41`) **and** spread into `COMMON_PLUGINS` |
| `TRILIUM_PLUGINS` | `plugins.ts:51` | Trilium-authored plugins (CutToNote, InternalLink, IncludeNote, CollapsibleListItems, TodoListMultistate, …) | spread into `COMMON_PLUGINS:183` |
| `EXTERNAL_PLUGINS` | `plugins.ts:86` | sub-package plugins: `Kbd, Mermaid, Admonition, Collapsible, Footnotes, Math, AutoformatMath` | spread into `COMMON_PLUGINS:184` |
| `COMMON_PLUGINS` | `plugins.ts:124` | `...CORE_PLUGINS` + built-ins (Bold, Image, List, Table, …) + `...TRILIUM_PLUGINS` + `...EXTERNAL_PLUGINS` | `ClassicEditor.builtinPlugins` (`index.ts:48-50`) |
| `POPUP_EDITOR_PLUGINS` | `plugins.ts:190` | `...COMMON_PLUGINS, BlockToolbar` | `PopupEditor.builtinPlugins` (`index.ts:57-59`) |

The editor classes (`index.ts`):

```ts
export class AttributeEditor extends BalloonEditor {        // inline label/relation editor
    static override get builtinPlugins() { return CORE_PLUGINS; }
}
export class ClassicEditor extends DecoupledEditor {        // fixed-toolbar text editor
    static override get builtinPlugins() { return COMMON_PLUGINS; }
}
export class PopupEditor extends BalloonEditor {            // floating-toolbar text editor
    static override get builtinPlugins() { return POPUP_EDITOR_PLUGINS; }
}
```

So a plugin in `CORE_PLUGINS` also loads into the tiny inline attribute editor. Keep it minimal — almost everything goes in `TRILIUM_PLUGINS` (your code) or `EXTERNAL_PLUGINS` (a sub-package).

### Premium plugins are dynamic, never in an array

`plugins.ts:114-119`:

```ts
export async function loadPremiumPlugins(): Promise<(typeof Plugin)[]> {
    const { SlashCommand, Template, FormatPainter } = await import("ckeditor5-premium-features");
    await import("ckeditor5-premium-features/ckeditor5-premium-features.css");
    return [SlashCommand, Template, FormatPainter];
}
```

Attached only when licensed (`config.ts:243-246`):

```ts
if (hasPremiumLicense) {
    config.extraPlugins = await loadPremiumPlugins();
}
```

`hasPremiumLicense` is `licenseKey !== "GPL"` (`config.ts:28-29`). Putting these in a static array costs ~6s startup and breaks the GPL build.

### Toggling built-ins off at runtime

`config.ts:181` sets `removePlugins: getDisabledPlugins()`. `getDisabledPlugins()` (`config.ts:286-298`) pushes plugin **names** (strings) based on user options:

```ts
function getDisabledPlugins() {
    const disabledPlugins: string[] = [];
    if (options.get("textNoteEmojiCompletionEnabled") !== "true") {
        disabledPlugins.push("EmojiMention");
    }
    if (options.get("textNoteSlashCommandsEnabled") !== "true") {
        disabledPlugins.push("SlashCommand");
    }
    return disabledPlugins;
}
```

That's how a plugin can be in the static array yet absent at runtime — a per-user toggle, distinct from premium gating.

## Importing symbols inside a plugin

- Editor + engine + **test helpers** all come from the single `"ckeditor5"` package: `import { Command, Plugin, ListEditing, type Editor, type ModelElement } from "ckeditor5"`; in specs `import { _setModelData as setModelData, _getModelData, ClassicEditor, keyCodes } from "ckeditor5"`.
- **Icons are the exception.** Generic icons: `@ckeditor/ckeditor5-icons` (`extra_slash_commands.ts:4` — `IconPageBreak, IconBulletedList, …`). Sub-package icons re-exported from their package: `import { icons as collapsibleIcons } from "@triliumnext/ckeditor5-collapsible"` (`extra_slash_commands.ts:15`), `import { icons as mathIcons } from "@triliumnext/ckeditor5-math"` (`:20`). Boxicons SVGs: `import bxBookmark from "boxicons/svg/regular/bx-bookmark.svg?raw"` (`:23`).

## Toolbar wiring (`apps/client/src/widgets/type_widgets/text/toolbar.ts`)

`buildToolbarConfig(isClassicToolbar)` (`toolbar.ts:10`) dispatches to:
- `buildMobileToolbar()` (`:21`) — flattens the classic config (groups expanded into a flat item list).
- `buildClassicToolbar(multilineToolbar)` (`:44`) — fixed toolbar `items` array.
- `buildFloatingToolbar()` (`:96`) — floating `toolbar.items` + `blockToolbar` array.

A toolbar entry is the **id** your plugin registers via `editor.ui.componentFactory.add("<id>", …)`. Add it to the relevant builder(s). Real precedents:
- `"collapsible"` appears in all three surfaces: classic `Insert` group (`toolbar.ts:80`), floating top row (`:117`), floating block toolbar `Insert` group (`:140`).
- `"footnote"` top-level (`toolbar.ts:76`); `"bulletedList"/"numberedList"/"todoList"` at `:64-66`.
- Nested dropdowns are `{ label, icon, items: [...] }` objects (the `Insert` group, `TEXT_FORMATTING_GROUP` at `:5`). `buildMobileToolbar` flattens these.

`config.ts:248-251` merges the toolbar config in last via `...buildToolbarConfig(opts.isClassicEditor)`.

## Slash-command wiring

Config side (`config.ts:167-174`):

```ts
slashCommand: {
    removeCommands: ["insertMermaidCommand", "bulletedList", "numberedList", "todoList"],
    dropdownLimit: Number.MAX_SAFE_INTEGER,
    extraCommands: buildExtraCommands((key, params) => t(key, params), SAMPLE_DIAGRAMS)
},
```

`buildExtraCommands(t, mermaidSamples)` (`extra_slash_commands.ts:35`) returns `SlashCommandDefinition[]`. A definition is either `commandName`-based (runs an existing editor command) or `execute`-based:

```ts
// commandName form (extra_slash_commands.ts:44-51)
{
    id: "collapsible",
    title: "Collapsible block",                       // hardcoded English by design
    description: t("slash_commands.collapsible_description"),
    aliases: ["details", "fold", "toggle"],
    icon: collapsibleIcons.collapsibleIcon,
    commandName: "collapsible"
},
// execute form (extra_slash_commands.ts:173-181)
{
    id: "align-left",
    title: "Align left",
    description: t("slash_commands.align_left_description"),
    icon: IconAlignLeft,
    execute: (editor: Editor) => editor.execute("alignment", { value: "left" })
}
```

### Replacing a built-in slash command = two edits

CKEditor ships `bulletedList`/`numberedList`/`todoList`/`insertMermaidCommand` slash commands. Trilium replaces them to fix Title-Case titles / generic icons. To do that you need **both**:

1. The id listed in `removeCommands` (`config.ts:171`) — drops CKEditor's version.
2. A re-added entry in `buildExtraCommands` running the **same** `commandName`. The list ones live in `buildListExtraCommands` (`extra_slash_commands.ts:122-146`); the Mermaid one in `buildMermaidCommands` (`:148-171`).

Miss step 1 → duplicate command. Miss step 2 → command disappears entirely.

Adding a *new* (non-replacing) slash command is just one entry in `buildExtraCommands`; no `removeCommands` change.

## Two translation mechanisms (full code)

### A. Relabel a CKEditor built-in string

`translation_overrides.ts` (whole file) assigns the global CKEditor reads:

```ts
window.CKEDITOR_TRANSLATIONS = {
    en: {
        dictionary: {
            "Insert template": "Insert text snippet",
            "Bookmark": "Anchor",
            "Bookmark name": "Anchor name",
            // …
        }
    }
};
```

It's imported for side effect at `index.ts:7` (`import "./translation_overrides.js";`). Verified by `translation_overrides.spec.ts` — the Bookmark→Anchor relabel shows up on the toolbar button (`:27-31`), and the dictionary carries the premium Template relabel even when that feature isn't loaded (`:33-39`). Use this ONLY to rename CKEditor's own English strings, never your plugin's.

### B. Translate your own plugin's strings

The client injects its i18n `t` as `config.translate` (`config.ts:189-190`):

```ts
(config as Record<string, unknown>).translate =
    (key: string, params?: Record<string, unknown>) => t(key, params);
```

Your plugin reads it back (`copy_link_url.ts:33-36`):

```ts
private _translate(key: string) {
    const translate = this.editor.config.get("translate") as ((key: string) => string) | undefined;
    return translate ? translate(key) : key;
}
```

`todo_list_multistate_editing.ts:38` does the same with a fallback:

```ts
const translate = (editor.config.get("translate") as ((key, params?) => string) | undefined)
    ?? ((key: string) => key);
```

Keys live in `apps/client/src/translations/en/translation.json` (English only — other locales come from Weblate; see the **translating-locales** skill). Slash-command **descriptions** are translated via the `t` passed into `buildExtraCommands` (`extra_slash_commands.ts:33` `SlashTranslateFn`); slash-command **titles** and toolbar group labels are intentionally hardcoded English.

### C. Locale bundles (separate concern)

`i18n.ts` `getCkLocale(locale)` (`i18n.ts:106`) lazy-imports CKEditor's own `ckeditor5/translations/<lang>.js` + premium translations and returns `{ language, translations }`, merged at `config.ts:182` via `...await getCkLocale(opts.uiLanguage)`. You don't touch this for a new plugin — it only maps Trilium's `DISPLAYABLE_LOCALE_IDS` to CKEditor's bundled UI translations.
