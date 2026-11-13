# Checklists

Every place a kind of change must reach. Paths without a folder are in
`packages/ckeditor5/src/plugins/vim/`.

## Contents

- [A key: motion, action or operator](#a-key-motion-action-or-operator)
- [Changing an engine command](#changing-an-engine-command)
- [An Ex command](#an-ex-command)
- [An argument shape for `:ck`](#an-argument-shape-for-ck)
- [A message or any other text](#a-message-or-any-other-text)
- [A key hint](#a-key-hint)
- [An option](#an-option)
- [Something the app does for Vim](#something-the-app-does-for-vim)
- [Which keys Vim takes](#which-keys-vim-takes)
- [A new block, widget or container in the text editor](#a-new-block-widget-or-container-in-the-text-editor)

## A key: motion, action or operator

1. **Define the command** in `vim_commands.ts`: a motion in `defineMotions()`, an action in
   `defineActions()`. Name a command of Trilium's own with the `trilium` prefix
   (`triliumHeading`, `triliumFold`). A motion returns a `VimPosition`, a pair of them for a text
   object, or `null` when it cannot move; set `motionArgs.linewise` when it takes whole lines.
2. **Map the key in `TRILIUM_KEYS`**, not with a `_mapCommand()` call elsewhere: `:mapclear`
   removes every key that is not an engine default, and `addTriliumKeys()` puts back only that
   list.
3. **What the command needs from the app** goes through the host: see _Something the app does for
   Vim_. A command sees the adapter (`cm as unknown as VimAdapter`), never the session.
4. **A key that exists in Vim but not here** is mapped to an action that shows a message
   (`triliumNoBlockMode`), so that a mapping, a macro or `:normal` gets the message too.
5. **Key hints**: the prefix or operator table in `vim_hints.ts`, and the full list in
   `vim_key_reference.ts`. See _A key hint_.
6. **Specs**: the behavior in the spec of its area (see the spec map in
   [testing.md](testing.md)), the hint in `vim_hints.spec.ts`.
7. **User Guide**: a row in `Vim full reference.md`, with the **Trilium-exclusive** and **Text
   notes only** badges when Vim has no such key, and the cheat sheet in `Vim mode.md` if it is a
   key most users need.

A Ctrl key of Insert mode is different: add it to `INSERT_KEYS` or `OPTIONAL_INSERT_KEYS` in
`vim.ts`, and to `runInsertKey()` when the engine has no command for it. Check first what the key
does in the app without Vim, since Insert mode shadows it: the table _Shortcuts that change in the
editor_ in `Vim mode.md` lists every one.

## Changing an engine command

`captureBuiltIns()` hands `installTriliumCommands()` the engine's tables. `motions` is a copy;
`actions`, `operators` and `exCommands` are the live tables, so read the original into a constant
before defining over it:

```ts
const joinLines = actions.joinLines;
vim.defineAction("joinLines", function (this: Actions, cm, actionArgs, state) {
    const adapter = cm as unknown as VimAdapter;
    // What a note needs, then the engine's own command where it still applies.
    joinLines.call(this, cm, actionArgs, state);
});
```

- Keep the engine's name and signature, and pass `this` on: engine commands call one another
  through it (`this.enterInsertMode(…)`).
- A wrapper for every operator already exists (`defineColumnOperators()`), and `delete` and
  `change` have their own. A new operator-wide rule belongs there, not in a new loop.
- Add a row to [engine-quirks.md](engine-quirks.md) that says what the engine did. The next
  person to read the wrapper cannot recover that from the code.

## An Ex command

1. **Define it inside `defineExCommands()`** with `vim.defineEx(name, shortName, (cm, params) =>
   …)`. `checkExRanges()` runs after that function and wraps what the table holds then, so a
   command defined elsewhere gets no range check. After the check, `params.line` and
   `params.lineEnd` are in the order of the note and inside it, 0-based; `params.argString` is
   the text after the name and `params.args` its words.
2. **The completion row** in `getExCommands()` (`vim_completion.ts`): `command(name, shortName,
   t("summary"), { range, args })`. The short name must be the one given to `defineEx()`, because
   `findCommand()` mirrors how the engine matches a typed name. Add the name to `UNSUPPORTED` when
   the command is available but not guaranteed in text notes. A new form of arguments is a new
   member of `ExCommand["arguments"]` with its rows in `getArgumentRows()`.
3. **The full key list** reads `getExCommands()`, so the command appears there without more work.
4. **Messages** through `adapter.host.notify(adapter.editor.t("…"))`: see the next but one
   section.
5. **Specs**: the command in `vim.spec.ts` ("the command line") or the spec of its area, the row
   in `vim_completion.spec.ts`. Ranges that are backward, zero or outside the note are covered
   for every command at once in `vim_edges.spec.ts`.
6. **User Guide**: _Command line_ in `Vim full reference.md`; a command of Trilium's own goes
   under _Trilium commands_.

## An argument shape for `:ck`

`:ck <name> <value>` calls `editor.execute(name, { value })`. A command that takes something else
gets an entry in `COMMAND_ARGUMENTS` (`vim_commands.ts`) that turns the text after the name into
the argument list: `link: (href) => [ href ]`, `insertTable: (size) => [ { rows, columns } ]`.
Before adding one, read what the command's `execute()` takes; a wrong shape wrote
`href="[object Object]"` into notes. Some editor commands write to the server (`childNote`,
`insertLinkEmbed`): `:ck` runs whatever the editor registers, so a spec for a new entry asserts
the model, and a live probe of `:ck` runs with writes held.

## A message or any other text

Text that the plugin shows is `editor.t("English text")`, or `t("…")` in the modules that take a
`Translate` function (`vim_hints.ts`, `vim_completion.ts`, `vim_key_reference.ts`).

- The argument is a string literal and the function is named `t`: the catalogue check finds the
  calls by that shape. Values go in as `%0`, `%1` with an array: `t("Invalid regex: %0",
  [ pattern ])`.
- The English text is the message id. Add it to `apps/client/src/translations/en/translation.json`
  under `text-editor.ck`, keyed by its slug (`"invalid-range": "Invalid range"`).
- Slugs ignore letter case: `stop` collided with an existing `Stop`. Word the message differently
  rather than sharing an entry that means something else.
- `pnpm --filter client test i18n.spec` fails on a missing entry and on a stale one, so remove the
  entry when the text goes.
- A message of the engine itself, such as the one for a pattern that is not found, is English
  only. `translateMessage()` in `vim.ts` translates the yank messages; add a case there for
  another engine message worth translating.

The rules for `editor.t()` are in the `ckeditor5-plugin-development` skill, and
`working-with-translations` has the tool that adds a key without opening the catalogue.

## A key hint

Hints are data in `vim_hints.ts`, which has no editor code.

| The state | The function |
| --- | --- |
| Normal or Visual mode with nothing typed (the strip) | `getModeHints()` |
| After an operator (`d`, `c`, `>`, `gu`) | `getOperatorHints()` |
| After `i` or `a` under an operator or in Visual mode | `getTextObjectHints()` |
| After a prefix in Normal mode (`g`, `z`, `[`, `]`, `Z`) | `getPrefixHints()` |
| After a prefix under an operator or in Visual mode | `getPrefixMotionHints()` |
| After a key that waits for a character (`f`, `F`, `t`, `T`, `r`) | `getCharacterHints()` |
| After a key that waits for a name (`"`, `m`, `'`, `` ` ``, `q`, `@`) | `getNameHints()` |
| After a count, or after `"x` | `getCountHints()`, `getRegisterUseHints()` |
| A prompt | `getSearchHints()`, `getConfirmHints()`, and `getCommandLineHints()` in `vim_completion.ts` |

- The strip shows `HINT_LIMIT` hints and then `Esc cancel`, so order them most useful first. The
  full list in the Shortcut Hints panel shows all of them.
- Whatever a hint reads from the editor comes through `HintContext` (`isOnLink()`, `canFold()`,
  `getParagraphObjectKind()`, `isMapped()`). Add a method there and implement it in
  `VimSession.hintContext`; do not import editor code into the module.
- A hint whose key the user mapped is left out (`withoutMappedKeys()`), since the key then means
  something else.
- The full lists by topic are in `vim_key_reference.ts` (`getKeyReference()`).
- Specs: `vim_hints.spec.ts`, `vim_key_reference.spec.ts`; the rendering in
  `apps/client/src/widgets/layout/VimStatus.spec.tsx`.

## An option

The five steps of _Storing User Preferences_ in `CLAUDE.md` (type, default, `ALLOWED_OPTIONS`,
control, hook), and for Vim mode:

- A getter in `VimConfig` (`vim.ts`) that the plugin calls each time it needs the value. The
  plugin never keeps the value, so a change reaches open editors.
- The getter's body in `buildVimConfig()` (`text/vim_mode.ts`).
- When open editors must do something on a change, a method on `TriliumVim` (as
  `refreshHints()`) and an effect in `useVimMode()` that calls it.
- The control in `VimModeOption` (`options/text_notes.tsx`), under the main switch.
- Decide `isSynced`. Whether Vim mode is on is per device; how it behaves is synced.
- The _Settings_ table in `Vim mode.md`.

## Something the app does for Vim

Saving, closing the tab, following a link and the clipboard are the app's, and the plugin asks
for them.

1. An optional method on `VimHost` (`vim.ts`). The plugin must work without it: a fallback, or a
   message, as `closeTab()` shows "This tab cannot be closed".
2. When a command in `vim_commands.ts` needs it, a method on `VimAdapterHost`
   (`vim_adapter.ts`) too, wired in the `VimSession` constructor. Commands reach the host as
   `adapter.host`.
3. The implementation in `buildVimConfig()`, through `triggerHostCommand()` for a command of the
   component that hosts the editor.
4. Specs on both sides: `vim.spec.ts` with a fake host in the config, and
   `apps/client/src/widgets/type_widgets/text/vim_mode.spec.tsx`.

## Which keys Vim takes

The decision is in `onCommandKey()` and `onInsertKey()` (`vim.ts`). A key taken in Normal mode
shadows the app shortcut of that key while the focus is in the editor.

- macOS differs: the app's shortcuts are Cmd chords there and Vim's are Ctrl chords, and
  `Cmd+Z` and `Cmd+Shift+Z` are mapped to `u` and `Ctrl+R` by hand.
- In a browser, `Ctrl+W`, `Ctrl+T` and `Ctrl+N` never reach the page on Windows and Linux.
- Update _Shortcuts that change in the editor_ in `Vim mode.md`, and the specs "keys in Normal
  mode" and "keys in Insert mode" in `vim.spec.ts`.

## A new block, widget or container in the text editor

Vim mode has to read the new structure as lines, and every line command has to leave it valid.
`LineIndex` decides from the schema, so start by looking at what it already gives.

1. **Add the plugin to `VIM_PLUGINS`** in `packages/ckeditor5/test/vim-kit.ts`, and write the
   first spec in `vim_lines.spec.ts`: a note with the structure, and what `getLines()` returns.
   The three outcomes:
   - It takes text: one line per block, or per part between soft breaks.
   - It is an object that holds no block to write in: one line of `OBJECT_CHARACTER`.
   - It holds blocks: no line of its own, the lines of its blocks.
   If the outcome is wrong, fix the schema (`isObject`, `isLimit`, what it allows) before adding
   a special case to `collect()`. The only names there today are `details` and `summary`, for a
   closed collapsible block.
2. **It hides content** (a collapsed state): its hidden blocks must leave `index()`.
   `VimAdapter.getVisibility()` builds the `LineVisibility` from `HiddenBlocks`,
   `CollapsibleListItems` and the `OPEN_ATTRIBUTE` of `details`. Add the new source there, make
   the index rebuild when the state changes without a model change (as `revealVersion` does), and
   teach `fold()`, `canFold()` and `COLLAPSE_ATTRIBUTES` in `vim_structure.ts`, so that `za`
   works and `ap` expands what it takes. `canJoin()` in `vim_editing.ts` refuses `J` next to
   hidden content.
3. **It has a title** (a limit that is not an object, or a `summary`): `isTitle()` already says
   so. Check with specs that `dd` clears it, `o` and `O` open a line where `p` would put one
   (`openLine()`, `getBlockPosition()`), and `J` does not pull text out of it.
4. **It is a box with its own editable area** (a limit that holds blocks): add its element name
   to `BOX_CONTAINERS`. **It wraps blocks** and goes with its last one: `WRAPPING_CONTAINERS`.
   Then `getParagraphObjectKind()` and, for a new kind, `ParagraphObjectKind` and its words in
   `getParagraphObjectDescription()` (`vim_hints.ts`). If blocks put into it must be paragraphs,
   add it to `PARAGRAPH_CONTAINERS` in `vim_registers.ts`.
5. **It is a widget with something to edit** (a caption, an editor inside): `i` and `a` on it go
   through `enterWidget()` in `vim.ts`. An embed with its own editor needs nothing more when it
   is a content embed; the nested editor has its own Vim session.
6. **It lays blocks out in two dimensions**, like a table: `getVerticalNeighbor()` in the adapter
   for `j` and `k`, and `getColumnParts()` for linewise operators.
7. **It is an inline object**: it is one `OBJECT_CHARACTER` in its line. Check `x`, `r`, `~`, `w`
   and a search across it. If `gf` should follow it, `getLinkUnderCursor()`.
8. **`:sort`** reads units in `vim_sort.ts`; check a range that holds the structure.
9. **Sweep it.** Unit specs on the lines you thought of miss structural damage. Add the
   structure to `fixture.html` of this skill, check with `simulate.mjs lines` that it reads as
   intended, and run `simulate.mjs sweep --kind <its element name>` and a batch of `fuzz`; see
   [live-simulation.md](live-simulation.md).
10. **User Guide**: _How Vim reads a text note_ in `Vim mode.md`.
