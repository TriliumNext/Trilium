# Live simulation

A spec checks what someone thought of. A simulation runs many commands on a note that holds
every structure, in the real app, and reports whatever breaks a rule that must always hold. It
is how to find the anomalies that nobody wrote a spec for: a command that damages a block two
lines away, a selection left behind after an error, an undo that gives back a different note,
state that one command leaks into the next.

Run one:

- before a release that changes Vim mode;
- after a change to `vim_adapter.ts`, `vim_lines.ts`, `vim_editing.ts`, `vim_structure.ts` or an
  engine wrapper in `vim_commands.ts`;
- after an upgrade of the Vim engine or of CKEditor;
- after a new block, widget or container reaches the text editor;
- when a report from a user does not reproduce in a spec.

## Contents

- [The tools](#the-tools)
- [The note under test](#the-note-under-test)
- [The invariants](#the-invariants)
- [The suites](#the-suites)
- [Oracles: is the result right?](#oracles-is-the-result-right)
- [The plan of a round](#the-plan-of-a-round)
- [Which suites a change needs](#which-suites-a-change-needs)
- [Triage of an anomaly](#triage-of-an-anomaly)
- [The report](#the-report)
- [Rules that keep a round honest](#rules-that-keep-a-round-honest)

## The tools

All in `.claude/skills/developing-vim-mode/`. Don't write new ones; extend these.

| File | Use |
| --- | --- |
| `simulate.mjs` | The suites that check invariants: `lines`, `sweep`, `fuzz`, `reduce`, `timing` |
| `live.mjs` | A few keys from the command line, or a scenario module, for everything a suite of `simulate.mjs` does not cover and for reproducing a finding |
| `fixture.html` | The note under test: one of each structure, every line with an ID |
| `session.mjs` | The browser session both scripts share, and the helpers they put in the page. It is not run by itself |

They need a running instance. Boot the in-memory fixture as [testing.md](testing.md) describes,
or use an instance and a throwaway note that a developer offers. Either way every write to the
server is held in the page, and the note opens in a tab of its own.

```bash
SIM="node .claude/skills/developing-vim-mode/simulate.mjs"
$SIM lines  --create-note                      # the fixture as the engine reads it
$SIM sweep  --create-note                      # every command on lines of every kind
$SIM fuzz   --create-note --sessions 20        # sessions of random commands
$SIM reduce --create-note --seed 7 --needle "model:"   # shorten a failing session
$SIM timing --create-note --sizes 100,200,400  # whole-note commands, with undo and redo
```

`--create-note` is for the in-memory fixture. On someone's own instance, pass `--url`, `--note
<noteId>` and `TRILIUM_PASSWORD` instead. Failure records go to a folder in the temp directory,
or to `--out <dir>`; the script prints the path.

In the page, both scripts provide:

| Helper | What it gives |
| --- | --- |
| `window.__vimEditor()` | The CKEditor instance of the test tab |
| `window.__vim.plugin()`, `session()`, `adapter()` | `TriliumVim`, its `VimSession` (with `engine` and `vim`), the `VimAdapter` |
| `window.__vim.state(isBrief)` | Mode, cursor, pending keys, message, command line, whether the selection is collapsed, whether a widget is selected; and unless brief, the lines and the HTML |
| `window.__vim.lines()`, `kinds()` | The text and the kind of each line. A kind is the chain of element names, such as `table>tableRow>tableCell>paragraph` or `paragraph(bulleted1)` |
| `window.__vim.goto(line, ch)` | Puts the cursor on a line, as a motion does |
| `window.__vim.validate()` | What is wrong with the model; an empty list when nothing is |
| `window.__vim.hash()` | A hash of the content that ignores fold states and the random IDs of list items |
| `window.__vim.clearState()`, `clearHistory()` | Empty registers and no last search; an empty undo and redo history |
| `window.__vim.startTiming()`, `stopTiming()` | The milliseconds that the keys in between cost: their handlers and the layout they leave behind |

## The note under test

`fixture.html` holds plain and formatted text, a soft break, emoji and a combining mark, an
inline object, numbers, brackets, headings with a collapsed section, bulleted, numbered and to-do
lists with nesting and a collapsed item, a quote, an admonition, a code block, a table with a
header, a cell of two paragraphs and a caption, a horizontal line, a page break, an open and a
closed collapsible block, tabs, columns, an aside in the flow and one beside the text, and a
footnote. Every line starts with an ID such as
`C03`, so that a line can be found again after an edit and named in a report.

- **Check it with `simulate.mjs lines`** after any change. Each structure must show with the kind
  you expect, and hidden content must be missing from the list.
- **A new structure gets a line in the fixture** in the same change that adds it to the editor.
  Give it the next free ID of its group and include its hidden or empty state if it has one.
- **The content is made up.** Never paste a real note into a fixture or into a report.
- **Embeds with an editor of their own stay out of the fixture.** `i` on one moves the focus into
  its editor, and the keys of the next cases go there. Test them in a note of their own, with a
  scenario that reloads the note after each case.
- **For another note**, pass `--content <file>` to any suite. The `timing` suite generates its
  own notes, since it needs sizes.

## The invariants

A command can do many things, but whatever it does, these hold afterwards. `simulate.mjs` checks
them after every case:

1. **No error.** Neither an uncaught one nor one that the page logged. Vim mode catches errors of
   the engine and logs them, so a logged error is a command that threw halfway.
2. **No write but the note's own.** Every write is held and listed. A held write other than the
   save of the note, the options or the tab state means that a key reached the app, or that a
   command wrote to the server.
3. **A valid model** (`validate()`): every node and attribute allowed where it is, list indents
   that do not jump, a collapsible block with its title first, no cell, column or tab panel left
   empty, the selection inside the note, no block cursor in Insert mode.
4. **A finished command leaves nothing behind**: Normal mode, no pending keys, no open command
   line, a collapsed selection unless a widget is selected, the cursor on a character of a line
   that exists.
5. **Undo gives the note back, and redo the change.** Undoing until nothing is left must restore
   the content exactly; redoing everything must give the result again. Fold states are outside
   this rule.
6. **Bounded time.** A command slower than `--slow` is reported. A command that takes more than
   two minutes is recorded and ends the run, since the page cannot be read while it is stuck.

An invariant says that the note survived, not that the result is right. For that, see _Oracles_.

## The suites

### `lines`: read the fixture

Prints every line with its kind. Run it first: a suite on a note that did not load as intended
tests nothing.

### `sweep`: every command on every kind of line

For each kind of line the sweep takes the first line, the last, and random others up to
`--per-kind`. On each it runs every command of the list, checks the invariants, undoes
everything, redoes it, and undoes again. The built-in list covers character edits, line edits,
puts, Visual operators, case operators, opening and joining lines, indenting, text objects,
folds, the number keys and Ex commands on the line.

```bash
$SIM sweep --create-note                          # the full matrix
$SIM sweep --create-note --kind table --only dd   # narrow: lines in a table, commands with dd
$SIM sweep --create-note --commands new.txt       # your own commands, one per line
```

- A command in the list must end in Normal mode by itself, so end one that types with `<Esc>`.
  A literal `<` is `<lt>`.
- For a new key or command, put its variants in a file (with counts, on a selection, at both
  edges) and pass it with `--commands`.
- A failure line names the line, its kind, the command and the broken rule. The same data is in
  `sweep-<seed>.jsonl`.

### `fuzz` and `reduce`: sequences nobody would write

A session is a number of random commands built from motions, operators with motions or text
objects, edits, typed text with Insert-mode keys, Visual selections, Ex commands, searches, folds
and macros. After each command the suite checks rules 1 to 3 and the cursor; at the end it
undoes everything and redoes everything. The seed decides the session, so a failing seed is a
reproduction.

```bash
$SIM fuzz --create-note --seed 100 --sessions 50 --steps 40
$SIM reduce --create-note --seed 123 --needle "undo"      # the part of the problem to keep
$SIM reduce --create-note --seed 123 --needle UNDO        # "undo did not restore the note"
```

`reduce` replays parts of a failing session and keeps the shortest list of commands that still
shows the problem. Give it a part of the problem text as `--needle`, or `UNDO` or `REDO` for the
two checks at the end of a session. When the problem does not show on replay, it depended on
what ran before in the page: that is a leak of state and a finding of its own.

The pools of commands are the `FUZZ` table at the top of `simulate.mjs`. Add a new key or
command there, or a round will never press it.

### `timing`: whole-note commands at growing sizes

Times each command that changes every line (delete, put, case, indent, join, `:s`, `:normal`,
`:g`), its undo and its redo, on generated notes of the sizes in `--sizes`. Read how a time grows
from one size to the next: one that doubles with the note is linear, one that quadruples is
quadratic and will not survive a long note. Run this suite alone on a quiet machine, and start
with small sizes, since a quadratic command at a large size can take minutes.

### Suites written as scenarios

The rest of a round has no fixed list of cases, because the cases come from what changed. Write
each as a scenario for `live.mjs --script`, using the page helpers above:

| Suite | What to check |
| --- | --- |
| Scenario matrix | One scenario per group of rows in `Vim full reference.md`: start content, keys, expected lines, cursor and mode. This is the suite that says a documented key does what the guide says |
| Formatting | Lines built for the purpose, with one distinct letter per formatted run, so that the formatting of every surviving letter is known. Every command at several positions; then the same text as plain paragraphs. What fails in both is the engine's; what fails only with formatting is Trilium's |
| Bad input | Counts past the edges, huge counts, ranges that are backward, zero or outside the note, patterns that do not compile, empty patterns, missing arguments, unknown registers and marks, macros that call themselves, an empty note, a note of one widget, a read-only editor |
| `:ck` | Every name in `editor.commands.names()`, with no value and with values, at the caret, on a selection, on a range, in a cell, on a widget. Watch the held writes: an editor command can write to the server |
| Keys and shortcuts | Which keys Vim takes in each mode and which stay with the app: the Insert-mode Ctrl keys with the setting on and off, the Escape order one press at a time, arrow keys, mappings with and without `<CR>`, a mapping that starts another one |
| Client | The status bar: mode, pending keys, messages, the hint strip, the command line in its slot and under the editor; the quick edit popup; Zen mode; the `#vimMode` label; the options page; a split with two editors; an included note with its own session |
| Clipboard and paste | `"+y`, `"+p`, `Ctrl+V` in each mode, large pastes, pastes with tabs and line breaks only. Headless only: a visible Chromium uses the real system clipboard |

A scenario has this shape. It finds a line by its ID, not by its number, since a change to the
fixture moves the numbers. Run it from the repository root with `live.mjs --create-note --script
<file>`:

```js
import { readFileSync } from "node:fs";

const FIXTURE = ".claude/skills/developing-vim-mode/fixture.html";

const CASES = [
    { name: "dd clears a table caption", id: "E08", keys: "dd",
        expect: (lines, at) => lines[at] === "" },
    { name: "dd removes a list item", id: "C09", keys: "dd",
        expect: (lines) => !lines.some((text) => text.startsWith("C09")) }
];

export default async ({ keys, setContent, check, evaluate }) => {
    const html = readFileSync(FIXTURE, "utf8");
    for (const { name, id, keys: typed, expect } of CASES) {
        await setContent(html);
        const at = await evaluate((prefix) => {
            const line = window.__vim.lines().findIndex((text) => text.startsWith(prefix));
            window.__vim.goto(line);
            return line;
        }, id);
        await keys(typed);
        const after = await evaluate(() => ({
            lines: window.__vim.lines(), problems: window.__vim.validate(),
            mode: window.__vim.state(true).mode
        }));
        check(name, after.lines, (lines) => expect(lines, at));
        check(`${name}: the model is valid`, after.problems, []);
        check(`${name}: Normal mode`, after.mode, "normal");
    }
};
```

## Oracles: is the result right?

Three sources say what a command should give, and each covers what the others cannot:

- **The User Guide.** For everything that is Trilium's own, and for every decided deviation, the
  reference page is the expectation. The list _Decided behavior that looks like a bug_ in
  `SKILL.md` names the ones that keep being reported.
- **The editor without Vim.** `o`, `O`, `J`, `>>` and typed text are defined as what Enter,
  Backspace, the indent command and typing do. Run the editor's own command at the same place
  and compare.
- **Vim itself**, for plain text. To tell an adapter bug from engine behavior, send the same keys
  to three places: the text note, a plain-text CodeMirror 6 buffer with `@replit/codemirror-vim`
  (the same engine without the adapter), and Vim.

| Result | Meaning |
| --- | --- |
| Text note equals Vim, CodeMirror differs | The adapter or a wrapper corrects an engine quirk |
| CodeMirror equals Vim, text note differs | An adapter bug |
| Text note equals CodeMirror, Vim differs | Engine behavior; decide whether a wrapper is worth it |

Vim as an oracle has traps:

- Run it as `vim -es` with one `normal!` per command. `normal!` abandons the rest of its keys
  after a motion that fails, so a verdict of "differs" on a string of several keys needs a check
  by hand.
- Put `let &undolevels = &undolevels` between commands to keep undo steps apart.
- Set `nostartofline`, which is how the text note behaves.
- A backward Ex range makes Vim ask for confirmation, so the oracle differs there by design.
- Compare at the level of logical lines, and leave out lines next to a widget, which Vim cannot
  have.
- Git for Windows ships `vim.exe`.

No script for the three-way comparison is bundled: the CodeMirror side has to be bundled with
the engine version of the day.

## The plan of a round

A full round, in order. A smaller change needs only some of it: see the next section.

1. **Fix what is under test.** A clean tree at a known commit, the Vim specs green, nothing else
   changing the repository while the round runs. Write the commit down for the report.
2. **Boot the instance** and choose an output folder outside the repository.
3. **Read the fixture**: `simulate.mjs lines`. Add lines for whatever the change introduced.
4. **Smoke**: a handful of keys with `live.mjs` on the fixture, to see that Vim mode starts, the
   status reads back and writes are held.
5. **Sweep**: first narrow (`--per-kind 1`), then full. Extend the command list with the keys of
   the change.
6. **Fuzz**: a batch of seeds. Reduce every failing seed before going on, since one cause usually
   fails several seeds.
7. **Scenario suites** that the change calls for: the matrix always, the others by the table
   below.
8. **Oracles** for the cases whose result is in doubt.
9. **Timing**, last and alone, with every other browser closed.
10. **Triage** every flagged case, as described below.
11. **Report**.
12. **Hand over each finding as a red spec.** Reproduce it with the kit, fix, and rerun the cases
    that failed (`--kind`, `--only`, the seed). After the fixes, run the sweep and the fuzz batch
    once more with new seeds: a fix in the line model moves other lines.

## Which suites a change needs

| The change | Run |
| --- | --- |
| A new key, motion, operator or text object | Sweep with its variants in `--commands`; add it to `FUZZ` and run a batch; a scenario for its documented rows |
| A new Ex command, or a change to ranges | Bad input for that command; sweep with it on the line and with ranges; fuzz |
| A new block, widget or container | A fixture line; `lines`; the full sweep on its kind (`--kind`); fuzz on a note that is mostly that structure |
| The adapter, the line index, `removeLines()`, `replaceText()`, `putLines()` | Full sweep, a large fuzz batch, timing |
| Undo steps or anything that changes how many operations a command makes | Fuzz (its end check is undo and redo of everything), timing |
| Registers, the clipboard, putting | Formatting, clipboard and paste, the sweep's put commands |
| Key routing, the Escape order, Insert-mode keys | Keys and shortcuts, client |
| The status bar, hints, the command line | Client, with the specs of `VimStatus` |
| An engine upgrade | Everything, and the three-way comparison |
| A CKEditor upgrade | Full sweep, fuzz, timing, and the CKEditor rows of [engine-quirks.md](engine-quirks.md) one by one |

## Triage of an anomaly

1. **Reproduce it alone.** A fresh page, the fixture, the keys: `live.mjs --create-note --content
   … "<keys>"`. If it shows only after other cases, it is a leak of state. Find the earlier
   command with `reduce`, or by replaying the cases before it in halves, and report the pair.
2. **Make it small.** The fewest keys, on the smallest note that still shows it. A report that
   needs the whole fixture is not understood yet.
3. **Look past the text.** After any error read `state()`: an expanded selection in Normal mode
   means that the next `x` deletes it, and a pending key or an open prompt means that the next
   key goes somewhere else. Then press a key and see.
4. **Try it with Vim mode off.** If the editor does the same from its own commands, the problem
   is the editor's, and belongs in a different report.
5. **Name its kind**: a broken invariant is a bug; a result that differs from Vim goes to the
   three-way comparison; a match with the decided-behavior list is not a finding; a new
   deviation that might be wanted is a question for whoever owns the User Guide.
6. **Rank it.** Lost content, a note that no longer saves as it was, or a state that the user
   cannot leave comes first; then a wrong result that undo repairs; then what only looks wrong.
7. **Sort the whole list before reading the rest.** Write a rule for each kind of flagged case
   that is explained, and look at what no rule covers. A rule that explains too many cases hides
   a finding, so read a sample of what each rule took.

## The report

A report lets someone who was not there reproduce every finding. Write it outside the repository
unless asked otherwise; it is not committed.

```markdown
# Vim mode in text notes: test report

- Date, branch and commit, whether the tree was clean
- Browser, instance (fixture or whose), the note (fixture, with what added)
- Oracles used

## 1. Summary
Two or three sentences, then a table: ID, finding in one line, severity.

## 2. What was run
A table: suite, what it does, how many cases, seeds.

## 3. Findings
### <ID> (<severity>): <what the user sees>
Start: the note or the fixture line by ID. Keys: in Vim notation.
Expected: … Actual: … Cause, if known: file and function.
Suggested spec: where, and the assertion.

## 4. Timing
The table of the timing suite, and what grows faster than the note.

## 5. Behavior worth a decision
What is not a bug but differs from Vim or from the guide.

## 6. Verified, nothing found
## 7. Not covered
```

- Give every finding steps that start from a fresh note. Name lines by their ID.
- Say what was not covered. A round that skipped the clipboard should not read as if the
  clipboard were fine.
- Keep the failure records and the seeds with the report.

## Rules that keep a round honest

- **One script per page.** Two scripts typing into one page give garbage in both.
- **A new page after an uncaught error.** Such an error can leave the editor dead without saying
  so. `simulate.mjs` reloads by itself; a scenario calls `reload()`.
- **Mind the page loads.** The server allows about 50 loads of the root page in 15 minutes for
  each address, shared with the developer's own browser on a shared instance. A session stops
  after 30 loads. Put cases into one run instead of starting many runs, and restart a fixture
  instance to clear its counter.
- **Restore with `setContent()`, never by counting `u`.**
- **Compare more than the edited line.** The line count, the kinds, and the lines that should
  not change.
- **Run a control.** When a result looks wrong, run the same text without formatting, and the
  same keys with Vim mode off, before calling it a bug of Vim mode.
- **Timing needs a quiet machine.** Close other browsers, and end leftover headless ones from
  earlier runs.
- **Clipboard checks stay headless.** `--headed` is for watching a scenario, not for copying.
- **Synthetic mouse drags are unreliable** in this editor even without Vim. Do not report a
  failing drag.
- **Record the seeds.** A seed and the commit reproduce a session exactly.
