# Engine quirks and the code that answers them

The engine is `@replit/codemirror-vim-core` 0.1.0: one closure in
`node_modules/@replit/codemirror-vim-core/vim.js` (about 7,200 lines), with its own test file
beside it. It was written for a plain-text editor, and a text note is neither plain nor flat. Each
row below is something the engine, or CKEditor, does that broke a note, and the code that answers
it. The code often looks like it could go. Before removing any of it, find the spec that covers
the row, see it fail without the code, and check the case in a running instance when the row says
"live only".

## Contents

- [The engine surface that Trilium depends on](#the-engine-surface-that-trilium-depends-on)
- [Session and keys](#session-and-keys)
- [Mappings](#mappings)
- [Macros](#macros)
- [Lines, ranges and operators](#lines-ranges-and-operators)
- [Ex commands](#ex-commands)
- [Characters of two units](#characters-of-two-units)
- [Registers](#registers)
- [CKEditor behavior that Vim mode answers](#ckeditor-behavior-that-vim-mode-answers)
- [Known problems](#known-problems)
- [Upgrading the engine or CKEditor](#upgrading-the-engine-or-ckeditor)

## The engine surface that Trilium depends on

None of this is documented API, so an engine upgrade can change any of it:

- **On the engine object:** `_mapCommand()`, `getVimGlobalState_()` (`jumpList`, `query`,
  `isReversed`, `macroModeState`, `lastCharacterSearch`), `maybeInitVimState_()`,
  `multiSelectHandleKey()`, `vimKeyFromEvent()`, `handleEx()`, `exitVisualMode()`,
  `exitInsertMode()`, and two methods that Trilium replaces: `handleKey` (in
  `stopMacrosAtFailures()`) and `mapclear` (in `recordMappings()`).
- **On the register controller:** `pushText` (replaced in `wrapRegisters()`), `registers`,
  `unnamedRegister`, and per register `keyBuffer`, `insertModeChanges`, `setText()`, `linewise`.
- **On `cm.state.vim`:** `inputState` (`keyBuffer`, `operator`, `operatorShortcut`,
  `operatorArgs`, `registerName`, `prefixRepeat`, `motionRepeat`), `insertMode`, `visualMode`,
  `visualLine`, `visualBlock`, `insertModeReturn`, `sel`, `lastSelection` (`anchorMark`,
  `headMark`), `onPasteFn`. Also `cm.state.overwrite` and `cm.state.closeVimNotification`.
- **Events** that the engine signals on the adapter: `vim-mode-change`, `vim-command-done`,
  `change`, `cursorActivity`.
- **`this` inside a command** is the engine's table of that kind (actions, motions, operators, Ex
  commands). `captureBuiltIns()` relies on it to read the built-ins, and `vim.defineEx()` stores
  into the same Ex table.

## Session and keys

| The engine | The answer | Where |
| --- | --- | --- |
| Adds a `paste` listener in `enterVimMode()` that enters Insert mode. `leaveVimMode()` removes it through `getOnPasteFn()`, which makes a new function once the engine replaced `cm.state.vim` after a command threw, so the old listener stayed on the root and threw on every later paste | The session removes the listener right after `enterVimMode()`. `onPaste()` listens to `contentInsertion` of `ClipboardPipeline` at `lowest` and moves the cursor instead | `VimSession` constructor, `onPaste()` |
| Keeps one jump list for every editor | Each session has its own, swapped into the global state before every key | `createJumpList()`, `runKeys()` |
| Signals `vim-mode-change` from `enterVimMode()` before it creates `cm.state.vim` | The session adds its `vim-mode-change` and `vim-command-done` handlers after `enterVimMode()`, since `onModeChange()` reads the state | `VimSession` constructor |
| Marks the one-command state after `Ctrl+O` with `insertModeReturn`, while `insertMode` is false | `escape()`, `getHints()` and `onOperationEnd()` test `insertModeReturn` as well | `vim.ts` |
| Records `nohlsearch` in the `:` register when `handleEx()` runs it | `escape()` puts the last command back after clearing the highlights | `escape()` |
| Does not collapse the selection after a redo, as it does after an undo | `redo()` sets the cursor to the start of what changed. Without it `Ctrl+R` ended in Visual mode | `VimSession.redo()` |
| Runs the callback of a prompt outside an operation. The search prompt's close handler scrolls back to where the view was | The Enter of a prompt runs inside `asVimOperation()`. Without it `d/x<CR>` threw in `wrapRegisters()` and `/pat<CR>` did not scroll to the match | `openDialog()` |
| Passes a template without an input field to `openDialog()` for "recording @a" | The session sets `status.recording` and returns a function that clears it | `openDialog()` |
| Keeps its keymap (`defaultKeymap`) private | The key hints are a curated table. A new key gets its hint by hand | `vim_hints.ts`, `vim_key_reference.ts` |
| Gives an operator of one key no `operatorShortcut`, only its name | `getOperatorKeys()` maps `delete`, `yank`, `change` and `indent` back to keys | `vim.ts` |
| Has no notion of a balloon: `Ctrl+[` and `Ctrl+C` typed in a link balloon never reach it | `onBalloonKey()` closes the balloon as Escape does and focuses the editor, which the balloon's own Escape does not | `vim.ts` |

## Mappings

| The engine | The answer | Where |
| --- | --- | --- |
| Runs a full match at once, with no timeout: with `,d` mapped, `,` runs before `,d` can match | Keys that start a user mapping wait in `inputState.keyBuffer` for up to `MAPPING_TIMEOUT` (1 s, Vim's 'timeoutlen'), then run as typed | `holdForMapping()`, `releaseHeldKeys()`, `startsUserMapping()` |
| Keeps user mappings in a list of its own | `userMappings` mirrors them per mode, for the holding above and so that key hints leave out a remapped key | `recordMappings()`, `isUserMapped()` |
| Splits the arguments of `:map` at spaces, so `:nmap gb :ck bold<CR>` kept `:ck` only | The wrapper passes the rest of the line as the target | `recordMappings()` |
| `mapclear` removes every mapping that is not a default, Trilium's keys included | Trilium defines the five `*mapclear` Ex commands again and re-adds its keys after each | `defineExCommands()`, `addTriliumKeys()` |
| Has no `:nunmap`, and `:unmap` removes only mappings made without a mode | Nothing in the code. A spec undoes `:nmap` with `:nmapclear` | spec trap |

## Macros

| The engine | The answer | Where |
| --- | --- | --- |
| Goes on with a macro after a motion failed | `stopMacro()` in the motion wrappers sets a flag, and the replaced `handleKey` skips the rest of the macro's keys until the next key of the user | `stopMacrosAtFailures()`, `moveByCharacters`, `moveByLines` |
| Plays a macro that calls a macro as a nested call. A macro that calls itself overflows the stack and can take the tab with it | A call in the last keys of a macro continues in a loop. The limits are `MAX_MACRO_CALLS` and `MAX_NESTED_MACROS`, with a message | `defineMacroReplay()` |
| Writes keys into the register being recorded as they come, so `@a` inside `qa…q` replayed the half-made recording | `@` of the register being recorded plays nothing, as in Vim | `defineMacroReplay()` |
| Reads `insertModeChanges` for each key of a macro that enters Insert mode. A register filled with text has none | `playRegister()` pads the list for the run. The typed text of such a register cannot be replayed | `playRegister()` |
| Threw on `@@` before any macro ran | The action returns when no register is named | `defineMacroReplay()` |

## Lines, ranges and operators

| The engine | The answer | Where |
| --- | --- | --- |
| Deletes the last line by removing from the end of the line before it, which in a note takes that block too | The `delete` operator removes the last line by itself and returns the cursor on the line before | `defineEditingCommands()` |
| Passes whole lines as a range from `(line, 0)` to `(line + 1, 0)` | `getWholeLines()` turns such a range, or one to past the end of the note, into lines for `removeLines()` | `replaceRange()` |
| Writes a case change (`gUU`, `g~~`, `g??`) as a replacement of that range by new text | Text with as many lines as it replaces is written over in place, line by line, keeping formatting and marks. Before, these commands deleted tables and left stray paragraphs | `rewriteLines()`, `keepBookmarks()` |
| Lets a line motion with a count run past the note | `moveByLines` clamps to the note, and with an operator on the edge returns `null`. `expandToLine` returns `null` for a count above 1 on the last line. An unclamped line reached `getColumnParts()` and threw after the selection was set, which left the selection expanded | `defineMotions()` |
| Has no `{count}%` | `triliumPercent` with `explicitRepeat: true` in its key | `TRILIUM_KEYS`, `defineMotions()` |
| Names the linewise flag of `:put` `lineWise` | `put()` reads that spelling and the register's own flag | `put()` |
| Reads the text to yank with `getSelection()` | The adapter answers from the selection the engine made, not the widened range of the editor | `VimAdapter.getSelection()`, `getEngineSelection()` |
| Reads a number with a leading zero as octal: `Ctrl+A` on `08` gave `NaN` or threw | `incrementNumberToken` is defined again on decimal numbers | `findNumber()`, `addToNumber()` |
| Moves `)` in the last sentence short of its last character under an operator | `moveBySentence` extends to the end of the line there | `defineMotions()` |

## Ex commands

| The engine | The answer | Where |
| --- | --- | --- |
| Does not check ranges: `:5,3d` deleted line 4 and `:0d` raised a raw error | `checkExRanges()` wraps every Ex command: a backward range is swapped, line 0 is the first line, a line outside the note is "Invalid range". It runs last in `installTriliumCommands()` so that it wraps Trilium's commands too | `checkExRanges()`, `getExRange()` |
| `:join` did not join the lines of its range as Vim does | `exCommands.join` is written again on `joinLines`: `:1,3j` joins three lines, `:2,2j` nothing | `defineExCommands()` |
| `:s` with an invalid pattern, no previous pattern or trailing characters threw | The wrapper checks the three and shows a message | `defineExCommands()` |
| Takes `&` for the whole match in a `:s` replacement | `toEngineReplacement()` escapes `&`, so the replacement is JavaScript's: `$&` is the match | `toEngineReplacement()` |
| `:g/` and `:normal` without their argument threw | Checked, with a message | `defineExCommands()` |

`:ck <command> [value]` passes `{ value }` to the editor command unless `COMMAND_ARGUMENTS` gives
its name another shape. A command that throws or rejects shows "The editor command X failed".

## Characters of two units

The engine counts UTF-16 units. A column inside a surrogate pair or a combining sequence makes
CKEditor throw `document-selection-wrong-position`.

| The engine | The answer | Where |
| --- | --- | --- |
| Moves `h` and `l` by one unit, and loops over the whole count (a count such as `2147483647l` freezes the page) | `moveByCharacters` steps by characters and stops one past the edge of the line | `defineMotions()` |
| Starts Visual mode on the second half of an emoji | `toggleVisualMode` moves the head to the start of the character | `defineEditingCommands()` |
| Keeps only the low surrogate of the character typed after `f`, `t`, `F`, `T` (`lastChar()`) | The three character searches look for that half and return the start of the character | `CHARACTER_SEARCHES` |
| Selects and replaces by units | `select()` and `replaceRange()` widen both ends with `toCharacterEdge()` | `vim_adapter.ts` |

## Registers

| The engine | The answer | Where |
| --- | --- | --- |
| Keeps text only | The model content read with the text is kept in a `WeakMap` keyed by the register's `keyBuffer` array, with the text. The engine gives a register a new buffer on every `setText()` and pushes into the same buffer on an append, so `wrapRegisters()` snapshots the buffers before a push and attaches the content to the registers whose buffer changed | `wrapRegisters()`, `rememberRichContent()`, `getRichContent()` |
| Reads text and stores it in two steps | The adapter remembers what the engine read last and the document version (`lastRead`), and hands over the rich content only when the text and the version still match | `getRange()`, `readLines()`, `takeReadContent()` |
| Has no `"*` | `defineRegister("*")`. `"+` and `"*` go to the system clipboard through the host | `wrapRegisters()` |
| Puts synchronously, while the clipboard is read asynchronously | `"+p` puts only if Vim mode, the note version, the mode and the selection are what they were (`getPutPlace()`). `readClipboard()` skips `setText()` when the clipboard holds the register's text, which keeps the formatting of a `"+y` then `"+p` | `paste` action, `readClipboard()` |

## CKEditor behavior that Vim mode answers

| CKEditor | The answer | Where |
| --- | --- | --- |
| Undo of a `MergeOperation` misplaces the merged block when a block was put back in its place since | Vim commands never merge (rule 6 in `SKILL.md`) | `replaceRange()`, `joinLine()`, `canMoveInto()` |
| Undo transforms each operation against every later one | One operation per run of blocks (rule 7) | `removeBlocks()`, `putLines()`, `rewriteText()` |
| `ChangeBuffer` batches typed text in chunks of about 20 characters | `VimUndo` groups batches into steps by when they were made, not by batch | `vim_undo.ts` |
| Widens a selection that crosses a cell, and moves the end of a range before a widget | The adapter keeps the selection of the engine beside the model range | `select()`, `getEngineSelection()` |
| The renderer updates the focus before the selection. After a key moved the DOM focus to another editable, as `Vj` out of a tab panel does, Chromium reported its own caret at the start of the note, and the cursor went to `0:0`. **Live only**: Vitest does not reproduce it | The session swallows one view `selectionChange` after keys that moved `document.activeElement`, then forces a render. A key or a pointer press resets the flag | `isFocusMoved`, `listen()`, `runKeys()` |
| Two-step caret movement: text typed at the end of a link or of inline code continues it | `a` and `A` call `leaveTwoStepBoundary()`, which overrides the selection gravity and keeps the uid. `restoreGravity()` gives it back when the caret moves. Dropping the uid left the gravity overridden for the life of the page, and typed text lost its formatting from then on | `vim_adapter.ts`, `isAtTwoStepBoundary()` |
| `enter` and `delete` are bubbling view events | `o`, `O` and `J` fire them with a `BubblingEventInfo`, so lists, code blocks and widgets handle them as for a real key | `fireViewEvent()` |
| `Widget` takes Escape to select the widget around a caption or a cell | The Escape listener is in the `$capture` context | `listen()` |
| Enter in an empty heading leaves a heading | `openLine()` renames an empty heading it opened to a paragraph | `openLine()` |
| The renderer can unbind a reused view element and then throw in `_updateDomSelection()`, after which the editor is dead until reload (a search highlight plus a counted `l` did it) | A core plugin outside `vim/` keeps the binding | `plugins/keep_view_mappings.ts` |
| A renamed block keeps attributes that its new name does not allow: a code block made a heading with `:ck heading` kept `language` | A core plugin drops them | `plugins/drop_disallowed_attributes.ts` |
| A `footnoteContent` that was not a limit lost its container to `dd` | The footnote schema marks it `isLimit` | `plugins/footnotes/schema.ts` |

## Known problems

Checked on 2026-11-13. No spec pins the first two, so a fix starts with a red spec.

- **`gqq` and `gww` change nothing and leave the line selected in Visual mode.** The engine's
  `hardWrap` operator returns `undefined` when the adapter has no `hardWrap()`, so the engine
  skips the `setCursor()` that would collapse the selection.
- **`C` in Visual mode removes the line with its line break**, so the typed text joins the next
  line (`vCx` on the first of two lines gives one line). Vim leaves an empty line. `S` is right.
  The engine does the same in code notes.
- **Slow on several hundred lines**: case operators over many lines, `:%j`, Visual `J`, `:s`,
  `:g`, `:v`, `:normal`. Each makes one operation or one change per line.
- **Every cursor move forces two layouts**, and the mode class on the editing root restyles the
  note when the mode changes. Both were measured, neither is fixed.

## Upgrading the engine or CKEditor

The engine version is exact in `packages/ckeditor5/package.json`. `@replit/codemirror-vim`, which
code notes use (`packages/codemirror/package.json`), builds on the same core package, so check
both when one moves.

1. Read the engine's diff for every name in _The engine surface that Trilium depends on_.
2. Run the Vim specs. A wrapper whose original changed its arguments fails at type check or in
   its spec; a quirk that the engine fixed leaves its wrapper passing, so look for those by hand
   and remove what is no longer needed, one row at a time.
3. Run a full simulation round ([live-simulation.md](live-simulation.md)), with the three-way
   comparison of its _Oracles_ section against a plain-text CodeMirror buffer on the new engine.
4. After a CKEditor upgrade, check what Vim mode reads outside the public API: `_stack` and
   `createdBatches` of the undo commands (`VimUndo`), `_getAllListItemBlocks`, `TableWalker`
   slots, `BubblingEventInfo`, `ViewDocumentDomEventData`, `overrideSelectionGravity()`. Then
   check the rows of the CKEditor table above in a running instance: an upstream fix of the merge
   undo or of the renderer order makes a workaround removable, and nothing will say so.
