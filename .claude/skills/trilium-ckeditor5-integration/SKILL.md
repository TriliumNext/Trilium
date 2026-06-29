---
name: trilium-ckeditor5-integration
description: Use when adding, wiring, or reviewing a CKEditor 5 plugin inside Trilium's OWN bundle (packages/ckeditor5) — registering it in the right plugin array in plugins.ts, exposing it through the toolbar/slash-command menu, relabelling or translating its strings, persisting a data-trilium-* attribute through the model→view→data→markdown→share pipeline, or writing its browser test. Covers the 5 plugin arrays and the CORE_PLUGINS=AttributeEditor trap, premium lazy-loading, removeCommands+extraCommands slash wiring, the two distinct translation mechanisms, and Trilium's real test harness (webdriverio+Chrome, licenseKey 'GPL', co-located src/**/*.spec.ts, test:sequential). Corrects the upstream ckeditor5-* skills, which stop at generic CKEditor APIs and never touch Trilium's bundle.
---

# Trilium ↔ CKEditor 5 integration

This skill is about Trilium's **own** editor bundle (`packages/ckeditor5/`), not generic CKEditor. For generic model/view/schema/conversion/command/widget/UI questions, delegate to the upstream **ckeditor5-plugin-development**, **ckeditor5-reviewing**, and **ckeditor5-testing** skills (they currently live in an unmerged worktree — reference them by name; don't depend on their files). But **OVERRIDE them on two points** where Trilium does the opposite of what they assume: the **test harness** (below) and **bundle wiring** (this whole skill).

## #1 trap: which plugin array? (`packages/ckeditor5/src/plugins.ts`)

A plugin only loads if it's in an array — and the arrays have **different reach**. Pick wrong and you either don't load (text editor) or you bloat the tiny inline attribute/relation editor.

| Your plugin is… | Add it to | line | Reaches |
|---|---|---|---|
| Trilium-authored, text editors only | `TRILIUM_PLUGINS` | `plugins.ts:51` | Classic + Popup (spread into `COMMON_PLUGINS:124`) |
| From a `@triliumnext/ckeditor5-*` sub-package (Mermaid, Math, Admonition, Kbd, Footnotes, Collapsible) | `EXTERNAL_PLUGINS` | `plugins.ts:86` | Classic + Popup |
| Floating-toolbar-only (e.g. `BlockToolbar`) | `POPUP_EDITOR_PLUGINS` | `plugins.ts:190` | Popup only (already spreads `COMMON_PLUGINS`) |
| **Genuinely** needed by the relation/attribute editor too | `CORE_PLUGINS` | `plugins.ts:99` | AttributeEditor + both text editors |
| Premium (SlashCommand/Template/FormatPainter) | `loadPremiumPlugins()` | `plugins.ts:114` | dynamic `config.extraPlugins`, only when licensed |

**The trap:** `CORE_PLUGINS` is also `AttributeEditor.builtinPlugins` (`index.ts:39-41`) — the inline editor for editing labels/relations. Anything you add there loads into that minimal editor. `CORE_PLUGINS` is deliberately tiny (`Clipboard, Enter, SelectAll, ShiftEnter, Typing, Undo, Paragraph, Mention` + `MentionCustomization`, `ReferenceLink`). Almost every new feature belongs in `TRILIUM_PLUGINS` or `EXTERNAL_PLUGINS`, **never** `CORE`. `COMMON_PLUGINS` = `CORE_PLUGINS` + built-ins + `...TRILIUM_PLUGINS` + `...EXTERNAL_PLUGINS`; the three editors map at `index.ts`: `AttributeEditor`=`CORE`, `ClassicEditor`(DecoupledEditor, fixed toolbar)=`COMMON`, `PopupEditor`(BalloonEditor, floating)=`POPUP`.

**Premium trap:** never put `SlashCommand`/`Template`/`FormatPainter` in a static array. They're dynamically imported by `loadPremiumPlugins()` (`plugins.ts:114-119`) and attached only when `hasPremiumLicense` (`config.ts:244-246`). Eager-loading them costs ~6s at startup and breaks the GPL build.

## Recipe: add a plugin end-to-end

1. **Author** under `packages/ckeditor5/src/plugins/`. Import editor symbols **and** test helpers (`_setModelData`) from the single `"ckeditor5"` package. The one exception is **icons**: `@ckeditor/ckeditor5-icons` (e.g. `IconBulletedList`), or `import { icons } from "@triliumnext/ckeditor5-*"` for sub-package icons (`extra_slash_commands.ts:3-4,15,20`).
2. **Register** in exactly one array per the table above.
3. **Toolbar** button → add the item id in `apps/client/src/widgets/type_widgets/text/toolbar.ts` (`buildClassicToolbar:44`, `buildFloatingToolbar:96`; mobile is derived from classic at `buildMobileToolbar:21`). Real precedent: `"collapsible"` appears at `toolbar.ts:80,117,140`, `"footnote"` at `:76`.
4. **Slash command** → add an entry in `buildExtraCommands()` (`extra_slash_commands.ts:35`). If you're **replacing** a built-in command, you ALSO need its id in `slashCommand.removeCommands` (`config.ts:171`). Need BOTH — see the two-step rule below.
5. **Translations** → pick the right mechanism (below).
6. **Test** → co-locate `<name>.spec.ts` next to the source; `pnpm --filter ckeditor5 test`.

## Slash commands: replacing a built-in needs TWO edits

`config.ts:167-174` wires `slashCommand` with `removeCommands` + `extraCommands: buildExtraCommands(...)`. To replace a built-in slash command with your own label/icon you must do **both**:

- Add (or keep) the id in `removeCommands` at `config.ts:171` — currently `["insertMermaidCommand", "bulletedList", "numberedList", "todoList"]`.
- Re-add it in `buildExtraCommands` running the **same** `commandName` (`extra_slash_commands.ts:122-146` re-adds the three list commands sentence-cased; `buildMermaidCommands:148` replaces the generic-icon Mermaid one). Omit either half and you get a duplicate or a missing command.

Adding a brand-new slash command (not replacing) is just one entry in `buildExtraCommands` with `commandName` or an `execute(editor)` (`extra_slash_commands.ts:44-115`). Command **titles are intentionally hardcoded English**; only `description` is translated via the injected `t`.

## Two translation mechanisms — do not conflate

| You want to… | Mechanism | Where |
|---|---|---|
| Relabel a CKEditor **built-in** English string (Bookmark→Anchor, "Insert template"→"Insert text snippet") | `window.CKEDITOR_TRANSLATIONS.en.dictionary` | `translation_overrides.ts` (side-effect import via `index.ts:7`) |
| Translate **your own** plugin's label/tooltip/slash-description | `editor.config.get("translate")` → Trilium i18n key | wired at `config.ts:190` as `config.translate = t` |

`translation_overrides.ts` is a flat `original → replacement` dictionary; covered by `translation_overrides.spec.ts`. Your plugin resolves keys via the injected `translate` fn — see `copy_link_url.ts:33-36` (`_translate` helper) and `todo_list_multistate_editing.ts:38`. Keys live in client `apps/client/src/translations/en/translation.json`. Slash-command descriptions get `t` passed into `buildExtraCommands` (`extra_slash_commands.ts:33`). Full snippets in [references/plugin-wiring.md](references/plugin-wiring.md).

## Persisting a `data-trilium-*` attribute

If your plugin stores state in the note content, it must survive **model → view → data → markdown → share**. This is **explicit conversion**, NOT GeneralHtmlSupport (GHS / `htmlSupport.allow` at `config.ts:178-179` is the separate path for arbitrary *user* HTML). The minimum:

- `editor.model.schema.extend("$block", {allowAttributes: MODEL_KEY})` (`collapsible_list_items.ts:25`).
- **Both** directions of conversion — asymmetric is the classic bug. List-item-scoped state uses `ListEditing.registerDowncastStrategy({scope:"item",...})` + an upcast `attributeToAttribute` (`collapsible_list_items.ts:29-47`); block-level attrs use `attributeToAttribute` both ways (`todo_list_multistate_editing.ts:59-94`).
- **Markdown is a decision, not automatic.** `data-trilium-collapsed` is deliberately **dropped** on export (no markdown syntax; the nested items still round-trip as bullets — `export/markdown.spec.ts:448`); `data-trilium-task-state` is **kept** (`export/markdown.ts:259`, `export/markdown.spec.ts:357`). Whichever you pick, add an export AND an import test.
- **Hiding/visual behaviour must be CSS scoped to the editing view** (`theme/*.css` imported at the top of the plugin — `collapsible_list_items.ts:1`), so read-only and **share-theme** rendering stay fully expanded. That's why share-theme needs no change.

Both worked examples (collapsed = DROP, task-state = KEEP), the exact spec files to extend, and the CSS-scoping rule are in [references/persisted-attributes.md](references/persisted-attributes.md).

## Test harness — CORRECTS the upstream ckeditor5-testing skill

The upstream skill assumes Playwright, no license key, and a `tests/` dir. Trilium does the **opposite**:

- **`licenseKey: "GPL"` is mandatory** in every `*Editor.create(...)` — omitting it throws (`collapsible_list_items.spec.ts:25`, `translation_overrides.spec.ts:16`; the constant is `OPEN_SOURCE_LICENSE_KEY = "GPL"` at `config.ts:17`).
- Runner is **`@vitest/browser-webdriverio` + headless Chrome**, not Playwright (`vitest.config.ts:1,6-11`).
- Specs are **co-located**: `include: ["src/**/*.spec.ts"]` (`vitest.config.ts:13`) — not a `tests/` dir. (These specs were recently moved out of `tests/` into `src/`.)
- The package runs in **`test:sequential`**: root `package.json:43` filters `ckeditor5` OUT of `test:parallel`; `:44` runs it sequentially with `ckeditor5-math`/`-mermaid`. Its own script is just `"test": "vitest"` (`ckeditor5/package.json:9`).
- Single file: `pnpm --filter ckeditor5 test src/plugins/<x>.spec.ts`.
- Import `_setModelData as setModelData`, `_getModelData`, `ClassicEditor`, plugins, `keyCodes` all from `"ckeditor5"`. Drive keystrokes via `editor.editing.view.document.fire("keydown", {...})` (`collapsible_list_items.spec.ts:308-324`); assert persisted HTML via `editor.getData()`.

> Lists are **flat** in the model — sibling blocks related by `listIndent`/`listItemId`, not nested `<li>` (`collapsible_list_items.spec.ts:6-12`). Don't write nested-element model fixtures for lists.

## Footgun quick-reference

| File | Watch out for |
|---|---|
| `packages/ckeditor5/src/plugins.ts` | 5 arrays, different reach; `CORE_PLUGINS:99` also builds the AttributeEditor; premium stays in `loadPremiumPlugins:114` |
| `apps/client/.../text/config.ts` | premium gating `:244`, `removeCommands:171`, `config.translate:190`, `htmlSupport.allow:178`, `removePlugins`/`getDisabledPlugins:286` (EmojiMention/SlashCommand toggles) |
| `packages/ckeditor5/src/extra_slash_commands.ts` | replacing a built-in needs the new entry here + the id in `config.ts removeCommands` |
| `packages/ckeditor5/src/translation_overrides.ts` | built-in relabels only — NOT your plugin's strings |
| `packages/trilium-core/.../export\|import/markdown.*` | decide + TEST your attribute's markdown behaviour (collapsed dropped, task-state kept) |

## Reference map

| File | Read it for |
|---|---|
| [references/plugin-wiring.md](references/plugin-wiring.md) | the 5-array decision with exact reach, the add-a-plugin checklist, toolbar / `extra_slash_commands` / `removeCommands` wiring with real ids, and the two translation mechanisms with code |
| [references/persisted-attributes.md](references/persisted-attributes.md) | the model→view→data→markdown→share pipeline through the two real examples (collapsible DROP vs task-state KEEP), schema.extend, CSS-scoping to the editing view, and exactly which markdown/import specs to extend |

Cross-links: **ckeditor5-plugin-development** / **ckeditor5-reviewing** / **ckeditor5-testing** (generic CKEditor — overridden here on harness + wiring); **writing-unit-tests** and **analyzing-coverage** for the broader monorepo Vitest setup and coverage of the `markdown.*` core specs; **translating-locales** for the client `translation.json` keys your plugin's `translate` calls resolve.
