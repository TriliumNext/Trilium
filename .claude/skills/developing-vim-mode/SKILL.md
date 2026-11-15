---
name: developing-vim-mode
description: >-
  Use when changing, debugging or reviewing Vim mode in text notes: anything under `packages/ckeditor5/src/plugins/vim/` (the `TriliumVim` plugin, `VimSession`, `VimAdapter`, `LineIndex`, the Trilium commands on the `@replit/codemirror-vim-core` engine), its client side (`text/vim_mode.ts`, `layout/VimStatus.tsx`, `vim_key_reference.tsx`, the `textNoteVim*` and `vimModeHint*` options, the `#vimMode` label), or a key, motion, operator, text object, Ex command, `:ck` argument, mapping, register, macro, key hint or completion row to add or fix. Use it for reports such as "dd deleted the table", "the cursor jumped", "undo takes seconds", "the selection stays after Esc" or "the mode is stuck". Load it too before adding or changing a block, widget, container or collapsible structure in the text editor, because Vim mode reads every structure as lines and a new one needs a line rule and specs, and before upgrading the Vim engine or CKEditor. Use it as well to test Vim mode in the running app: a live probe, a regression hunt, or a full simulation round before a release ("run the Vim simulation", "sweep Vim mode", "fuzz it", "test Vim on a large note"). Covers the line model, how a key travels, the rules the engine imposes and its quirks that must stay worked around, undo steps and the cost of large changes, behavior that is decided and looks like a bug, checklists for each kind of addition, the spec kit and its traps, and the method and full plan of a live simulation. Includes live.mjs, which types Vim keys into a running instance with every write held, simulate.mjs, which sweeps every command over every kind of line, runs random sessions, reduces a failing one and times whole-note commands, and fixture.html, a note with every structure; don't write new ones.
---

# Developing Vim mode for text notes

Vim mode in a text note is the Vim engine of code notes driving CKEditor instead of CodeMirror.
`@replit/codemirror-vim-core` (`initVim(CM)`, pinned at 0.1.0 in `packages/ckeditor5/package.json`)
holds the modes, the keymap, the operators, the registers, the macros and the Ex commands.
`VimAdapter` gives it the editor it expects, the interface of CodeMirror 5, over the CKEditor
model: the note becomes a list of lines (`LineIndex`), a cursor is a line and a column, and every
edit is a model change. `VimSession` routes the keys, keeps the status that the status bar shows,
groups undo steps and opens the command line. `vim_commands.ts` replaces the engine commands that
would break a rich-text note and adds Trilium's own.

Three things follow from that shape, and most bugs come from forgetting one of them:

- **The engine thinks in lines of plain text; the note is a tree.** Every command passes through
  the line model, so a new block, widget or container in the editor needs a line rule. See _A new
  block, widget or container_ in [references/checklists.md](references/checklists.md).
- **The engine is third-party and pinned.** Its behavior changes by wrapping its commands, never
  by patching it. [references/engine-quirks.md](references/engine-quirks.md) lists each wrapper
  with the engine behavior it answers. Read it before removing code that looks redundant: most of
  it exists because a live test failed without it.
- **Insert mode is the editor as it is without Vim.** Only a few Ctrl keys are taken there. Normal
  and Visual mode take every key that types.

What users see is specified in the User Guide: `docs/User Guide/User Guide/Note Types/Text/Vim
mode.md` (enabling, settings, _How Vim reads a text note_, _The Esc key_, _Limitations_) and its
child page `Vim full reference.md` (every key and command, with the **Text notes only**, **Code
notes only** and **Trilium-exclusive** badges). When code and guide disagree, find out which one
is wrong before changing either.

Code notes have a Vim mode of their own (`packages/codemirror`, `@replit/codemirror-vim`, option
`vimKeymapEnabled`) on a separate engine instance. Nothing here applies to it, except that
`vim_hints.ts`, `vim_completion.ts` and `vim_key_reference.ts` hold no editor code so that code
notes can share them later.

## Where things are

Editor modules are in `packages/ckeditor5/src/plugins/vim/`.

| What | File | Identifiers |
| --- | --- | --- |
| Plugin, session, key routing, Escape, command line, status | `vim.ts` | `TriliumVim` (`status`, `setEnabled()`, `refreshStartupCommands()`, `refreshHints()`, `getKeyReference()`), `VimSession`, `VimHost`, `VimConfig`, `VimStatus`, `getLinkUnderCursor()` |
| Engine loading, startup commands | `vim_engine.ts` | `loadVimEngine()`, `getLoadedVimEngine()`, `runStartupCommands()` |
| The editor that the engine drives | `vim_adapter.ts` | `VimAdapter`, `VimAdapterHost`, `VimPosition`, `getActiveAdapter()` |
| The note as lines | `vim_lines.ts` | `LineIndex`, `LineVisibility`, `OBJECT_CHARACTER`, `toCharacterEdge()` |
| Line edits on the model | `vim_editing.ts` | `removeLines()`, `replaceText()`, `rewriteLines()`, `openLine()`, `joinLine()`, `indentLines()`, `getBlockPosition()`, `isTitle()` |
| `{` `}`, `ap` `ip`, headings, folds, table columns | `vim_structure.ts` | `findStructuralBlock()`, `findParagraphObject()`, `findHeading()`, `fold()`, `getColumnParts()`, `WRAPPING_CONTAINERS`, `BOX_CONTAINERS` |
| Engine overrides, Trilium keys and Ex commands | `vim_commands.ts` | `installTriliumCommands()`, `TRILIUM_KEYS`, `COMMAND_ARGUMENTS`, `isUserMapped()`, `addTriliumKeys()` |
| Registers that keep formatting, putting | `vim_registers.ts` | `RichContent`, `rememberRichContent()`, `readBlocks()`, `putLines()` |
| Search and its highlights | `vim_search.ts` | `SearchCursor`, `SearchHighlights`, `SEARCH_MARKER` |
| `:sort` | `vim_sort.ts` | `sortLines()`, `sortUnits()`, `parseSortOptions()` |
| Undo steps | `vim_undo.ts` | `VimUndo` |
| Jump list, digraphs, the engine's stream class | `vim_jumps.ts`, `vim_digraphs.ts`, `vim_string_stream.ts` | `createJumpList()`, `getDigraph()`, `StringStream` |
| Key hints | `vim_hints.ts`, `vim_key_reference.ts` | `getModeHints()`, `getCommandHints()`, `HintContext`, `getKeyReference()` |
| Command line completion | `vim_completion.ts`, `vim_command_line.ts` | `getExCommands()`, `findCommand()`, `PromptAssistant` |
| Styles | `packages/ckeditor5/src/theme/vim.css` | `.ck-vim-command-mode`, `.ck-vim-cursor`, `.ck-vim-command-line`, `.ck-vim-completion` |
| Registration and exports | `packages/ckeditor5/src/plugins.ts`, `src/index.ts` | `TRILIUM_PLUGINS`; the types that the client imports |
| Spec kit | `packages/ckeditor5/test/vim-kit.ts` | `createVimEditor()`, `setVimData()`, `press()`, `typeText()`, `getLines()`, `getCursor()`, `getContent()` |
| Client host, enabling | `apps/client/src/widgets/type_widgets/text/vim_mode.ts` | `buildVimConfig()`, `useVimMode()`, `isVimModeWanted()`, `setCommandLineSlot()` |
| Status bar | `apps/client/src/widgets/layout/VimStatus.tsx`, `StatusBar.tsx`, `TitleRow.tsx` | `useVimStatus()`, `VimStatusLine`, `VimHintStrip`, `VimCommandLineSlot`, `VimModeBadge`, `VimTitleStatus` |
| Full key list panel | `apps/client/src/widgets/type_widgets/text/vim_key_reference.tsx` | `getVimHintSection()`, `VimKeyReference` |
| Options page | `apps/client/src/widgets/type_widgets/options/text_notes.tsx` | `VimModeOption` |
| Options and label | `packages/commons/src/lib/options_interface.ts`, `builtin_attributes.ts` | `textNoteVim*`, `vimModeHint*`, `vimMode` |

## The line model

`LineIndex.collect()` walks the model and decides per element. The rule reads the schema, not a
list of names, so most new structures get lines without code:

| Model | Lines |
| --- | --- |
| A block that takes text (`schema.checkChild(block, "$text")`): paragraph, heading, list item block, code block, caption, `summary` | One line, or one per part between `softBreak` elements. A code block is one block with a line per code line |
| An object with no block to write in (`schema.isObject()` and not `isContainerObject()`): image with its caption, horizontal line, embed | One line of one character, `OBJECT_CHARACTER` |
| Anything else: quote, admonition, table, row, cell, column layout, tabs, collapsible block, aside | No line of its own. Its blocks add theirs in document order |
| An inline object in a text line: note reference, inline image | One `OBJECT_CHARACTER` in the text, so `ch` equals the model offset |
| Hidden content: the section of a collapsed heading, the nested items of a collapsed list item, the body of a closed collapsible block | No lines in `index()`. A closed `details` shows its `summary` |

- **Two indexes.** `adapter.index()` holds the lines that show, which the engine moves through.
  `adapter.getFullIndex()` holds every line, which search reads; a match in hidden content shows
  for the moment through `FindReveal` (`toShownPosition()`, `endReveal()`).
- **An index dies with the next structural change.** `updateIndexes()` refreshes one block after a
  change of its text and drops both indexes after anything else. Ask the adapter again after every
  model change instead of keeping an index in a variable; `openLine()` takes `getIndex` for that.
- **An object line has two columns**: 0 is before the widget and 1 after it. A selected widget is
  the cursor on its line (`getSelectedObjectLine()`). A selected widget that holds lines, such as
  an aside or a table selected by its handle, is the cursor at the start of its first line
  (`getSelectedContainerLine()`). The selection, and with it the toolbar of the widget, stays until
  a key moves the cursor.
- **Characters of two units.** `toCharacterEdge()` keeps a column off the inside of an emoji or of
  a letter with a combining mark. CKEditor throws `document-selection-wrong-position` for a
  position there, so every column that becomes a model position goes through it.
- **Titles and limits.** `isTitle()` is a `summary` or a limit that is not an object, such as a
  table caption or a tab title. A title is cleared, never removed; a line break in it is a soft
  break; nothing is put beside it (`getBlockPosition()` sends blocks to the start of the content
  under it). A limit that loses all its blocks keeps one empty paragraph. A container goes with
  its last line, except that a cell or a column goes only with its whole table or layout, and a
  table, a layout or an aside only with lines outside it (`getRemovalUnit()`).
- **Tables.** `j` and `k` move down and up a column (`getVerticalNeighbor()`). A linewise operator
  after them, or in Visual Line mode, takes only the cells in the columns of its two ends
  (`takeColumnParts()`, `getColumnParts()`). Ex ranges such as `:2,4d` stay in reading order.
- **`ap` and `ip`** go by the innermost container: `WRAPPING_CONTAINERS` (`blockQuote`, the
  `aside` of an admonition, `details`), `BOX_CONTAINERS` (`tableCell`, `multicolumnColumn`,
  `tabPanel`, `asideContent`), list items, headings with their sections. `ParagraphObjectKind`
  names the cases for the key hints.

## How a key travels

1. `VimSession.listen()` registers a capture-phase `keydown` listener on `document`, which runs
   before every editor plugin. A key from outside the editables of this editor is ignored
   (`isFromEditable()`), except `Ctrl+[` and `Ctrl+C` in a balloon (`onBalloonKey()`).
2. `engine.vimKeyFromEvent()` names the key as Vim writes it: `x`, `<Esc>`, `<C-r>`.
3. **Insert mode** (`onInsertKey()`): the key stays with CKEditor unless it is in `INSERT_KEYS`
   (always Vim), in `SWALLOWED_INSERT_KEYS`, or, with _Vim keys in Insert mode_ on, in
   `OPTIONAL_INSERT_KEYS`. **Normal and Visual mode** (`onCommandKey()`): Alt chords, function
   keys, Meta chords other than the macOS undo keys, `Ctrl+C` with a selection, and `Ctrl+V` and
   `Ctrl+Q` (paste) stay with the app. Every other key goes to the engine, and a key that would
   type is consumed even when the engine has no use for it.
4. `runKeys()` swaps in the jump list of this session, opens an undo step, holds keys that start a
   user mapping (`holdForMapping()`), and calls `engine.multiSelectHandleKey()`.
5. The engine calls the adapter inside `adapter.operation()`. The adapter changes the model, and
   `onDocumentChange()` updates the indexes and reports the change to the engine, which records
   typed text for `.` and for macros.
6. When the outermost operation ends, `onBeforeEndOperation()` runs the handlers of the engine,
   scrolls the cursor into view after an operation of Vim, and calls `host.onOperationEnd()`. The
   session then sets `TriliumVim#status`, an observable that the status bar follows through
   `change:status`, and moves the cursor markers.

**Escape** is not a key of step 3. A plain `Esc` is handled on the view document's `keydown` in the
`$capture` context, before `Widget`, by `escape()`. It does one thing per press, in this order:
close the key list panel, the mention list or a balloon; close a long message; cancel pending
keys or leave Visual or Insert mode; clear the search highlights; leave the editor of an embed;
else switch the hint strip with the breadcrumb. `Ctrl+[` and `Ctrl+C` run the same function.

**Other inputs.** Text from an input method outside Insert mode is a key (`insertText` listener).
A paste outside Insert mode keeps the mode and puts the cursor on the last pasted character
(`onPaste()`). A copy in Visual mode leaves Visual mode.

**The cursor** outside Insert mode is a marker, `vimCursor` or `vimCursorEmpty`, with
`affectsData: false`, drawn by `updateCursor()`. The class `ck-vim-command-mode` on the editing
root hides the caret of the browser.

**Embeds.** The editor inside an included note has a session of its own. `i` and `a` on an embed
enter it (`enterWidget()`), `j` and `k` leave it at its edges (`leaveEmbedAtEdge()`), `Esc` leaves
it as the last step before the hint strip, and the status bar follows the focus
(`useFocusedVim()`).

## Rules that bind

1. **One engine, many editors.** `loadVimEngine()` creates one engine for every text editor on the
   page. Registers, mappings, options, macros, the last search, `userMappings`, `isColumnMotion`
   and `macroRuns` are shared. Per editor are `adapter.state.vim`, the marks, and the jump list,
   which `runKeys()` swaps in before each key. A mapping or register set anywhere is set
   everywhere, in specs too.
2. **Wrap, never patch.** `captureBuiltIns()` reads the built-in actions, motions, operators and Ex
   commands of the engine through probe commands. To change one, define it again under its engine
   name and call the captured original with `.call(this, …)`. The repository carries no patch of
   the engine or of CKEditor, because each release broke the patches it had.
3. **`:mapclear` removes Trilium's keys too.** Every path that clears mappings calls
   `addTriliumKeys()` afterwards: the five `*mapclear` Ex commands and `runStartupCommands()`.
4. **Code of the engine runs inside an operation.** `getActiveAdapter()` is set only inside
   `adapter.operation()`, and the register commands read it. A callback that runs later, such as
   the Enter of a prompt, a clipboard promise or a timer, goes through `adapter.asVimOperation()`.
   Without it an operator that ends in a search (`d/x<CR>`) throws and the cursor is not scrolled
   into view.
5. **The selection of the engine is not the selection of the editor.** CKEditor widens a range
   that crosses a cell to the whole table and moves the end of a range before a widget.
   `select()` remembers what the engine asked for, and `getCursor()` and `getSelection()` answer
   from that while the model range and the index are unchanged. To learn where the Vim cursor is,
   call `adapter.getCursor()`, not `model.document.selection`.
6. **No merges.** CKEditor's undo of a `MergeOperation` puts the merged block in the wrong place
   when a block was put back there since: from `A B C D`, merging B into A, removing C and undoing
   twice gives `A C B D`. It happens without Vim too, but Vim commands produce the sequence all
   the time. So
   `replaceRange("")` up to the end of a later line removes the later lines whole and then the
   rest of the first, and `joinLine()` moves the content of the next block in and removes it
   (`canMoveInto()`), with Backspace as the fallback.
7. **One operation per run of blocks.** Undo transforms each operation against every later one,
   so n removals cost about n² on undo. `removeBlocks()` removes a run of siblings as one range,
   `putLines()` inserts one fragment, and `rewriteText()` takes one removal and one insertion.
   Keep to that in any command that can touch many lines, and check a new one with the `timing`
   suite of `simulate.mjs`.
8. **Every write path checks `editor.isReadOnly`.** `replaceRange()` and
   `newLineAndEnterInsertMode` do. A new path that changes the model outside them must too.
9. **A message is `adapter.host.notify(editor.t("English text"))`.** The English text is the
   message id, so it needs an entry under `text-editor.ck` in the client catalogue, and its slug
   must differ from every other entry whatever the letter case. See the checklist.

## Undo

`VimUndo` groups the batches of CKEditor's undo history into the steps that Vim undoes. A step is
open while `runKeys()` runs a batch of keys, during an Insert session (opened and closed in
`onModeChange()`), and while a command line is open, so `:s///c` with its confirmations is one
step. `u` and `Ctrl+R` run `VimUndo.undo()` and `redo()`, which execute the editor command until
the top batch belongs to another step. A batch made outside a step, such as with the toolbar, is
a step of its own. The class reads `_stack` and `createdBatches` of the undo commands, which are
not public API: check both after a CKEditor upgrade.

Still slow on notes of several hundred lines, because they make one operation or one change per
line: `gU`/`gu`/`g~` over many lines, `:%j` and Visual `J`, `:s`, `:g` and `:v`, `:normal`.
Measure before promising an improvement (`simulate.mjs timing`), on a machine that runs nothing
else: other browsers distort the numbers.

## The client side

- **`buildVimConfig()`** builds `config.vim` for `CKEditor.tsx`: the `VimHost` (save, close the
  split, follow the link, clipboard, hint strip, key list) and four getters that read the options
  on each call, so a change applies to open editors without a rebuild.
- **`useVimMode()`** turns the plugin on or off in place with `TriliumVim#setEnabled()`.
  `isVimModeWanted()` decides: the `#vimMode` label of the note wins, else the option
  `textNoteVimModeEnabled`, and never in the mobile layout. Editors that are open when the option
  is turned on start in Insert mode; a note opened later starts in Normal mode. Another note in
  the same editor restarts the session, with its own marks.
- **The status bar reads the `vimMode` context data**, which `usePublishedVim()` sets to the
  plugin of the focused editor. A note switch clears all context data, so the hook publishes
  again, keyed on the note ID. Only a displayed type widget publishes (`isVisible`).
- **The command line** is an element that the plugin builds and the host mounts.
  `mountCommandLine()` appends it to `VimCommandLineSlot` when the status bar shows this editor,
  and returns `false` otherwise; the plugin then shows it in a panel under the editor
  (`mountCommandLineUnderEditor()`).
- **A note without a status bar**, such as in the quick edit popup, shows the badge and the mode
  in the title row (`VimTitleStatus`).
- **Zen mode** keeps the status bar while the body has the class `vim-status-shown`
  (`StatusBar.tsx`, `stylesheets/zen.css`).

| Option | Synced | Meaning |
| --- | --- | --- |
| `textNoteVimModeEnabled` | no | Vim mode in text notes, per device |
| `textNoteVimModeNoticeShown` | no | The first-use notice was shown |
| `textNoteVimInsertKeysEnabled` | yes | Six more Ctrl keys follow Vim in Insert mode |
| `textNoteVimStartupCommands` | yes | Ex commands run when Vim mode starts, one per line |
| `vimModeHintsEnabled` | yes | Key hints; `:set hints` and `:set nohints` write it |
| `vimModeHintStripShown` | yes | The hint strip shows in place of the breadcrumb |

## Decided behavior that looks like a bug

Each of these reads as a bug and is by design. Change one only with the User Guide.

- `dd` on a title clears it, and on the only line of a cell, column, tab panel or aside leaves an
  empty line. `dd` on a heading removes the heading line, not its section.
- A put next to a title lands at the start of the content under it, and around a closed
  collapsible block.
- `yy` and `y{motion}` leave the cursor where it was. A count that passes the edge of the note
  takes the lines up to the edge; with the cursor on the edge it takes nothing (`2dd` on the last
  line does nothing).
- `Ctrl+V` pastes in Normal and Visual mode. Visual Block mode does not exist in text notes; a
  mapping or macro that asks for it gets a message (`triliumNoBlockMode`).
- `:q!` and `ZQ` only show a message: notes save as they are typed, so there is nothing to
  discard. `:wq`, `:x` and `ZZ` are `:q`.
- A mapping whose target starts with `:` needs `<CR>` to run (`:nmap gs :sort<CR>`). Without it
  the command line opens with the command typed.
- `:s` takes JavaScript regular expressions and replacements: `$1`, `$&` for the whole match, and
  `&` is a literal `&` (`toEngineReplacement()`).
- `J` does what Backspace at the start of the next line does, and nothing next to a widget, across
  a limit, or into or out of a collapsible block.
- Read-only text notes are static HTML without an editor, so they have no Vim mode.

Problems that are known and open are listed at the end of
[references/engine-quirks.md](references/engine-quirks.md), so a report of one is not a new
finding.

## Testing

Read [references/testing.md](references/testing.md) before writing a spec or a live probe. In short:

```bash
pnpm --filter @triliumnext/ckeditor5 test src/plugins/vim/vim_editing   # one spec file
pnpm --filter client test vim_mode VimStatus vim_key_reference           # the client side
pnpm --filter client test i18n.spec                                      # editor.t() entries
```

- The specs run in headless Chromium, so layout, scrolling, `gj` and the focus exist. The package
  gate is 100% on all four coverage metrics: every branch needs a spec, and a branch that no spec
  can reach has to go.
- Registers, mappings and startup commands are shared by every editor in a spec file. Clear what a
  spec sets, and seed a register before asserting a put.
- **Vitest cannot reproduce everything.** The order of focus and selection updates across two
  editables, the status bar, the real clipboard, scroll position in the app and timing on a large
  note need a running instance. `live.mjs` types real keys into one, with every write held. Boot
  the in-memory fixture first, as [references/testing.md](references/testing.md) says, then:

```bash
node .claude/skills/developing-vim-mode/live.mjs --create-note "ihello<Esc>" "yyp" ":s/h/j/<CR>"
```

- **A spec checks what someone thought of.** To find what nobody did, run a simulation:
  `simulate.mjs` takes `fixture.html`, a note with every structure, and checks after every
  command that the page has no error, the model is valid, nothing is left pending or selected,
  and undo gives the note back. [references/live-simulation.md](references/live-simulation.md)
  has the method, the suites, which of them a change needs, and the plan of a full round.

```bash
node .claude/skills/developing-vim-mode/simulate.mjs sweep --create-note   # each command, each kind
node .claude/skills/developing-vim-mode/simulate.mjs fuzz --create-note    # random sessions
```

## Documentation and changelog

A change to what a key or command does is user-facing: update the row in `Vim full reference.md`,
and `Vim mode.md` when a setting, the Escape order or a limitation changes, then regenerate the
help (the `writing-documentation` skill). The beginner guide stays simple; it does not list
everything. The feature's own changelog entry is `.changelog/20261112095055_vim-mode-text-notes.md`.
While that file exists Vim mode is unreleased: a fix needs no entry of its own, and a visible
addition is added to that entry. After the release, a fix or addition gets its own entry as usual.

## Reference files

| File | Read it when |
| --- | --- |
| [references/engine-quirks.md](references/engine-quirks.md) | Touching how the session, the adapter or `vim_commands.ts` talk to the engine; removing a wrapper; upgrading the engine or CKEditor |
| [references/checklists.md](references/checklists.md) | Adding a key, an Ex command, a `:ck` argument shape, a message, a key hint, an option, a host method, or a new block, widget or container to the text editor |
| [references/testing.md](references/testing.md) | Writing or debugging a spec, booting an instance to test against, running `live.mjs` |
| [references/live-simulation.md](references/live-simulation.md) | Hunting for anomalies in the running app: the invariants, `simulate.mjs` and its suites, oracles, the plan of a round, triage, the report |
