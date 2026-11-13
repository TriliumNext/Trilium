# Testing Vim mode

## Contents

- [Running the specs](#running-the-specs)
- [The kit](#the-kit)
- [Spec map](#spec-map)
- [Spec traps](#spec-traps)
- [What Vitest cannot reproduce](#what-vitest-cannot-reproduce)
- [A running instance to test against](#a-running-instance-to-test-against)
- [live.mjs](#livemjs)
- [Pointing it at someone's own instance](#pointing-it-at-someones-own-instance)

Finding problems that no spec looks for, with sweeps, random sessions and timing, is in
[live-simulation.md](live-simulation.md).

## Running the specs

```bash
pnpm --filter @triliumnext/ckeditor5 test src/plugins/vim/vim_registers   # one file
pnpm --filter @triliumnext/ckeditor5 test src/plugins/vim                 # every Vim spec
pnpm --filter @triliumnext/ckeditor5 test src/plugins/vim/vim_edges -t "macros"
pnpm --filter client test vim_mode VimStatus vim_key_reference StatusBar  # the client side
pnpm --filter client test i18n.spec                                       # editor.t() entries
```

- The editor specs run in headless Chromium (browser mode), so layout, scrolling, the focus and
  `gj` are real. Setup and troubleshooting are in the `ckeditor5-testing` skill. The client specs
  run in happy-dom, which has no layout.
- **`-t` takes a regular expression.** A name with `+`, such as `Ctrl+O`, matches nothing: every
  test is skipped and the run exits 0. Read the count on the `Tests` line before believing a
  green run.
- **The coverage gate of the package is 100%** on lines, functions, branches and statements
  (`packages/ckeditor5/vitest.config.ts`), and CI enforces it. Every branch needs a spec, and a
  branch that no spec can reach has to be removed. The `analyzing-coverage` skill lists what a
  change left uncovered without a whole-package run by hand.
- **See the spec fail first.** A bug found in a running instance becomes a spec before the fix:
  reproduce it with the kit, run it red, fix, run it green. When the kit cannot reproduce it, say
  so in the commit body and give the live check there.
- **Mutate in a worktree.** To prove that specs pin a behavior by breaking the source, use
  `git worktree add` on a temporary directory. The main tree can be committed from while a
  mutation is still in it.

## The kit

`packages/ckeditor5/test/vim-kit.ts`. The editors it creates are destroyed by the global
`afterEach` of `test/setup.ts`.

| Helper | What it does |
| --- | --- |
| `createVimEditor(data?, config?, plugins?, editorConfig?)` | An editor with `VIM_PLUGINS` and Vim mode on. `config` is a `VimConfig`: a fake `host`, `getStartupCommands`, `areHintsEnabled` |
| `setVimData(editor, data)` | Sets the content in the model data format, with the selection marked `[]`. A `·` is a space that the parser would collapse. Clears the undo stack and tells the engine |
| `press(editor, keys)` | Presses keys in Vim notation (`dd`, `<Esc>`, `<C-r>`, `<CR>`, `<lt>`) as `keydown` events in the focused editable, or types them into the open command line as a browser does: keydown, edit, `input`, keyup. Returns whether the last key was taken |
| `typeText(editor, text)` | Types in Insert mode: each character is a key, and what no listener takes is inserted |
| `getLines(editor)` | The lines as the engine reads them, joined with `\|` |
| `getCursor(editor)` | The cursor of the engine as `line:ch` |
| `getContent(editor)` | The model data without the selection, with list item IDs renamed `a`, `b`, `c` in the order they first appear, since new items get random IDs |
| `getVimData(editor)` | The model data with the selection |
| `getStatus(editor)`, `getAdapter(editor)` | `TriliumVim#status`; the `VimAdapter` of the session |
| `item(text, id, indent?, type?)`, `paragraphs(...texts)` | Model data for a list item block and for paragraphs |

```ts
import { createVimEditor, getCursor, getLines, paragraphs, press } from "../../../test/vim-kit.js";

it("removes a line with dd and puts it back with u", async () => {
    const editor = await createVimEditor(paragraphs("[]one", "two", "three"));
    press(editor, "jdd");
    expect(getLines(editor)).toBe("one|three");
    expect(getCursor(editor)).toBe("1:0");
    press(editor, "u");
    expect(getLines(editor)).toBe("one|two|three");
});
```

Assert the lines **and** the cursor, and after a change the whole content (`getContent()`), not
only the line that was edited: a command can leave its own line right and damage the block next
to it.

## Spec map

All in `packages/ckeditor5/src/plugins/vim/`.

| Spec | Covers |
| --- | --- |
| `vim.spec.ts` | Keys in Normal and Insert mode, the status, the command line, startup commands, turning Vim on and off, undo steps, focus, links, widgets |
| `vim_adapter.spec.ts` | The screen (scrolling, display lines, coordinates), tables, positions |
| `vim_lines.spec.ts` | `LineIndex`: what each structure gives as lines, visibility, positions |
| `vim_editing.spec.ts` | `dd`, operators down a table column, `cc` and `S`, `r` and Replace mode, case operators, `o` and `O`, `J` and `gJ`, `>>` and `<<`, Insert mode at a link, `replaceText()`, `getWholeLines()` |
| `vim_structure.spec.ts` | `{count}%`, `{` and `}`, `ap` and `ip`, heading motions, folds, what the key hints read |
| `vim_registers.spec.ts` | Putting lines and text, the clipboard registers, rich contents |
| `vim_search.spec.ts` | `/`, `?`, `n`, highlights, `:s` |
| `vim_sort.spec.ts` | `:sort` |
| `vim_edges.spec.ts` | Edge cases by area: the session, embeds, the adapter, commands, macros, characters of two units, the edges of the note, bad input |
| `vim_hints.spec.ts`, `vim_key_reference.spec.ts` | The hint tables, the strip, the breadcrumb view, the full key list |
| `vim_command_line.spec.ts`, `vim_completion.spec.ts` | The prompt assistant, the completion rows |
| `vim_jumps.spec.ts`, `vim_string_stream.spec.ts` | The jump list, `StringStream`, digraphs |

Client: `apps/client/src/widgets/type_widgets/text/vim_mode.spec.tsx`,
`vim_key_reference.spec.tsx`, `apps/client/src/widgets/layout/VimStatus.spec.tsx`, and the Vim
cases in `StatusBar.spec.tsx`, `CKEditor.spec.tsx` and `options/text_notes.spec.tsx`.

## Spec traps

- **The engine is shared by every editor of a spec file.** Registers, mappings, the last search,
  options and the startup commands that ran last outlive a test. Seed a register before asserting
  a put, clear a mapping the test made, and call `forgetRichContents()` where rich content of an
  earlier test could match.
- **Undo `:nmap` with `:nmapclear`.** The engine has no `:nunmap`, and `:unmap` answers "No such
  mapping" for a mapping made with a mode.
- **The model data parser reads `[`, `]`, `{`, `}` as selection markers and `<` as a tag.** A note
  that needs those characters as text gets them from a model writer after the editor is created.
- **The headings of the kit are `heading2` to `heading6`.** There is no `heading1`.
- **Timers.** Command hints wait `HINT_PAUSE` (400 ms), held mapping keys `MAPPING_TIMEOUT` (1 s),
  messages 1.5 to 5 s. The specs that test them use `vi.useFakeTimers()`.
- **The Enter of a prompt.** The kit sends the `keyup` of a key to the element that has the focus
  by then, as a browser does. A `keyup` sent to the closed input would run the incremental
  search again and scroll back, which no browser does.
- **A completion list and a history recall can give the same text.** A recalled complete name
  lists itself first, so order the history so that the two differ.
- **`document.activeElement` matters.** `press()` dispatches in the editable that holds the
  selection, such as a caption. A spec about focus moving between editables checks the element
  itself.

## What Vitest cannot reproduce

Check these in a running instance:

- The order of focus and selection updates when a key moves the focus between two editables,
  as `Vj` out of a tab panel does.
- Anything of the client: the status bar, the hint strip, the command line slot, the quick edit
  popup, Zen mode, the options page, the `#vimMode` label.
- The system clipboard, an input method, and app shortcuts that compete for a key.
- An included note with its own editor and Vim session.
- Time on a large note: latency of a key, undo of a large change.
- State that builds up over many commands in one page.

## A running instance to test against

The in-memory fixture of `building-client-ui/references/inspecting-the-running-app.md` is the
default target of the scripts, and that file says how to stop it and what else to know. With a
data directory outside the repository:

```bash
cd apps/server && NODE_ENV=development TRILIUM_ENV=dev TRILIUM_PORT=37999 \
  TRILIUM_DATA_DIR=<an empty scratch directory> \
  TRILIUM_DOCUMENT_PATH=../../packages/trilium-core/src/test/fixtures/document.db \
  TRILIUM_INTEGRATION_TEST=memory TRILIUM_RESOURCE_DIR=src \
  TRILIUM_GENERAL_NOAUTHENTICATION=true npx tsx ./src/main.ts
```

- `TRILIUM_GENERAL_NOAUTHENTICATION=true` removes the login page.
- Vite's hot-reload socket binds `TRILIUM_PORT + 10`, so both ports must be free. On Windows a
  free port can still be reserved (`EACCES`); take another port and pass `--url`.
- The first page load waits for Vite to optimize the dependencies, for which the scripts allow
  five minutes.
- The server limits how often the root page loads: about 50 page loads in 15 minutes for each
  address. A script that loads the page for every case runs into it and then waits forever on a
  page that answers 429. Restarting the instance clears the counter.

## live.mjs

`live.mjs` opens the instance in Chromium, opens a text note in a tab of its own with Vim mode
on, types real keys, and prints the state after each step.

```bash
SKILL=.claude/skills/developing-vim-mode
node $SKILL/live.mjs --create-note "ione<CR>two<Esc>" "ggdd" "u"
node $SKILL/live.mjs --create-note --content $SKILL/fixture.html "3G" "dap" "u"
node $SKILL/live.mjs --create-note --content note.html --json "ggVGJ" > steps.jsonl
node $SKILL/live.mjs --create-note --script scenario.mjs
```

```
> ione<CR>two<Esc>
  mode: normal   cursor: 1:2   lines: 2
  one|two
> ggdd
  mode: normal   cursor: 0:0   lines: 1
  two
> u
  mode: normal   cursor: 0:0   lines: 2
  one|two
held writes: 1
page errors: 0
```

Each argument is one step. The line of a step also shows pending keys, a recording, the text of
an open command line, and `selection: expanded` when the model selection is not collapsed.
`--json` adds the HTML of the note. `--headed` shows the browser; a visible Chromium uses the real
system clipboard, so keep clipboard checks headless.

**What keeps it safe.**

- Every request to `/api/` that is not a read is answered `200 {}` in the page and listed as a
  held write. Reads are GET requests, `tree/load` and `search`. Nothing reaches the server: not
  the note, not the options, not the open tabs.
- The options of the page are the server's plus `textNoteVimModeEnabled=true` and each
  `--option name=value`.
- The note opens in a tab of its own, and every lookup is scoped to that tab's `.note-split`.
  The same note can be open in a hidden tab, whose editor has no focus.
- Before each key the script checks that the focus is in a note, the command line or a balloon of
  the editor, and stops otherwise. A key sent to `<body>` is an app shortcut: `Ctrl+O` there
  creates a note.
- A note above the automatic read-only size never builds an editor; the script lifts that for
  its own tab.
- `--create-note` lets exactly one write through, the creation of a scratch note. Use it only on
  an in-memory instance.

**A scenario** is a module whose default export gets the session:

```js
export default async ({ keys, state, setContent, check, evaluate, reload }) => {
    await setContent("<p>one</p><p>two</p><p>three</p>");
    await keys("jdd");
    const { lines, isSelectionCollapsed } = await state();
    check("dd removes the second line", lines, [ "one", "three" ]);
    check("the selection stays collapsed", isSelectionCollapsed, true);
    check("the model is valid", await evaluate(() => window.__vim.validate()), []);
};
```

- `setContent(html)` loads HTML and restarts Vim mode: Normal mode at the start of the note, an
  empty undo history. Registers, mappings and the last search stay, since the engine belongs to
  the page. `reload()` loads the page again for a new engine.
- `state()` returns the mode, the cursor, pending keys, the message, the command line, whether
  the selection is collapsed, the lines and the HTML; `state(true)` leaves out the last two.
- `check(name, actual, expected)` compares as JSON, or calls `expected(actual)`. A failed check
  makes the exit code 1.
- In the page, `window.__vimEditor()` is the editor of the test tab, and `window.__vim` has the
  helpers that [live-simulation.md](live-simulation.md) lists: `lines()`, `kinds()`, `goto()`,
  `validate()`, `hash()` and the rest.
- To restore a baseline, call `setContent()` again. Do not count on `u`: one press too many
  undoes the fixture itself.
- A slash command typed in Insert mode needs `--delay 40`: at 20 ms per key the slash menu does
  not open.

## Pointing it at someone's own instance

When a developer offers their running server and a throwaway note, pass `--url`, `--note <noteId>`
and the password in `TRILIUM_PASSWORD`. Never pass `--create-note` there. The script holds writes
and keeps to its own tab, but the instance is still shared:

- The limit on page loads is counted together with the developer's own browser on localhost. Put
  many steps in one run instead of starting many runs.
- The port may not be the repository build at all, as the reference above warns.
- Read `held writes` at the end. A write that a test did not expect, such as a `POST` that would
  have created a note, is a finding: some key reached the app, or a command wrote.
