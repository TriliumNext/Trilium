# What an accepted change looks like

Measured on `main` between March and September 2026: 65 bugfix commits, 30 feature commits, 15
feature PRs, and the last 250 merged PRs. These numbers are the yardstick the complexity and
targeting dimensions measure against. They describe the median, not a limit — a larger diff is
accepted when its body proves the smaller one was wrong.

## A bugfix

| metric | fixes with an issue (n=45) | all fixes (n=65) |
|---|---|---|
| production lines changed (+/−), median | **26** (Q1 13, Q3 44) | ~24 |
| production files, median | **2** | 2 (Q3 4) |
| spec added or changed in the same commit | 80 % | **78 %** |
| spec lines when present, median | 57 (larger than the fix) | — |
| User Guide touched | 0 % | 1.5 % |
| commit body present / median length | 89 % / 21 lines | 88 % |

The template: **one or two production files, 5–30 changed production lines, a spec in the same
commit that is larger than the fix, and a body that explains the cause well enough that the diff
needs no comments.** Exemplars (`git show <hash>`):

| hash | subject | prod | spec | why |
|---|---|---|---|---|
| `1ff82b4195` | fix(client): don't open a target=_blank link on right-click (regression of #3971) | +1 −1 | +16 | names the commit that fixed #3971 and the one that re-broke it; the fix is one condition |
| `4159c782fd` | fix(table): re-widen the row number column past 99 rows (closes #11590) | +5 −1 | +14 | explains why the existing spec missed it and uses the real payload |
| `61d924d53e` | fix(client): stop keystrokes reaching the note while a dialog opens (closes #7996) | +9 | +47 | external, agent-assisted: Cause / Fix / Verification (red before, green after) / Known remainder; merged with one APPROVED |
| `cd381e09fe` | fix(search): keep result paths out of the bookmarks clone (closes #10021) | +13 −10 | +35 | traces the bug through two path prefixes, names the PR that introduced the tiebreaker and keeps its intent |
| `b4266ad816` | (a `key={noteId}`) | **+1** | +65 | one production line and a lifecycle spec |

Fixes that carried more than the bug still landed, at a price — a body that justifies every extra
file: `3c7362888a` (a new 220-line scanner module, with why not a CSSOM walk and two follow-ups),
`b387bbf5ba` (collapses five listeners into one, with a timing table), `d9877c20e9` (9 files, adds
a shared prop and moves a hook, and admits a gate left "narrower than it should be"). Feature-shaped
diffs under a `fix(` subject (`3f8ae20781`, a whole CKEditor plugin; `e355c5840d`, a new component)
are the exception, not the pattern. The question a large `fix(` must answer: **which of these files
is the bug, and which is the refactor you took the opportunity for?**

### The commit body

The canonical body has three movements: (1) what the user saw and why the code did it, with the
offending identifier named and, for a regression, the hash that caused it; (2) what changes and why
that shape — often "X rather than Y because …"; (3) what is unchanged or out of scope. Over the
sample: 82 % name the cause, 42 % weigh an alternative, 23 % describe verification, 12 % cite the
regressing hash. Contributors who write `Cause:` / `Fix:` / `Verification:` / `Known remainder:`
headings are accepted as-is.

### The subject

98 % are `fix(<area>): …` with an area (`search`, `share`, `desktop`, `collections/table`), not a
file. The close keyword is always `closes`, always in the subject: `(closes #N)`, bare `(#N)` when
the issue stays open, `(regression of #N)`. The subject describes the user-visible outcome in the
imperative, not the mechanism.

## A feature

| metric | per feat commit (n=30) | per feat PR (n=15) |
|---|---|---|
| production lines, median (Q1–Q3) | 74 (30–133) | **367** (70–1085) |
| production files / total files, median | 3 / 5 | 8 / 16 |
| spec in the same change | 87 % | **93 %** |
| `docs/User Guide/**` in the same change | 13 % | **53 %** — 8/8 of the PRs with a UI surface |
| generated help (`doc_notes`) regenerated | — | always together with the User Guide edit, never one without the other |
| `translations/en/*` touched | 37 % | 53 % |

Docs usually arrive as their own `docs(user): …` commit on the branch, which is why the per-commit
rate is low and the per-PR rate is what counts. The 7 feature PRs without a User Guide change were
ETAPI (the OpenAPI file is the doc), standalone internals and build changes (Developer Guide
touched instead), and two tiny UI tweaks.

Options: 48 keys added to `options_interface.ts` since March; 45 whitelisted in `ALLOWED_OPTIONS`
in the same commit (the three exceptions are server-internal state that must not be
client-writable), 42 with the default in `options_init.ts`, 12 of the last 17 with the settings
control and its English key in the same commit. A user-facing option that misses any of these is
incomplete, not wrong.

Exemplars: `433a238751` (core + two specs + translation + User Guide in one commit), `31cc8a825b`
(client + specs + the `.md` + the regenerated `.html`), `c9dec8e2cd` (the full seven-file option
recipe in +56 lines), `8e876786e6` (ETAPI route + `etapi.openapi.yaml` + spec), `07aaf5ef8f`
(`.tsx` + its `.css` twin + `.spec.tsx` + i18n). PRs: #11667, #11521, #11440, #11424, #11652.

## How a PR lands

- **Always a merge commit**, never squash or rebase (60/60). The branch commits survive verbatim on
  `main`, so each commit's subject and body is what history keeps — a PR is judged commit by
  commit, not as one blob. External PRs carry a median of 4 commits.
- **The merge subject is the PR title + ` (#N)`**, body empty. The title was rewritten on merge
  once in 49; so the PR title has to already be the conventional subject with `(closes #N)`.
- **The maintainer finishes rather than sends back.** 10 of 32 external PRs got maintainer commits
  before merging (renames, a spec, a doc line, a moved control); only one PR in the sample carried
  a CHANGES_REQUESTED review, and it still merged after maintainer commits. 22 of 49 external PRs
  merged with no formal review. Time to merge: 0.7 h for the maintainer's own, a median of 20.6 h
  for external.
- **27 % of landings bypass a PR**: small fixes pushed straight to `main` by maintainers. A
  contributor's small fix competes with "I could push this myself in ten minutes" — which is why a
  correct 5-line fix with a good spec merges within a day, and a 300-line one for the same bug gets
  re-done.
- **Bots are not reviewers.** `greptile-apps` comments on every PR and gates nothing; `codecov`
  posts coverage deltas. Neither is evidence of review.
- **Accepted PR bodies** are structured prose: `## Why / ## What`, `## Problem / ## Fix`,
  `## Tests / ## Verification`, one heading per cause. The maintainer's own PR bodies are the commit
  bodies regrouped by subsystem.

## What gets asked, fixed silently, or sent back

From 147 merged external PRs (November 2025 → September 2026). **108 merged silently** — no
maintainer text, or an empty APPROVED with "Nice." / "Thanks!" / "Good job!" — and 10 of the 19
zero-text merges were 100–250-line self-contained fixes with a spec and `(closes #N)`. Only 39 drew
a substantive comment. What those comments asked for, ranked:

1. **Robustness (12)** — "Always validate user data. If I enter `#calendar:slotLabelInterval=
   "00:aa:00"`, the calendar crashes." / "the fix is good but it doesn't fix the issue reported
   in #10663. This fixes only mis-positioning of the cursor, it does not cure duplicated text." /
   "It doesn't seem to work, at least on the Trilium Next theme." / "This is not platform-agnostic
   since it will fail on Windows." / a hidden capability loss caught in review (#11424).
2. **Docs (9)** — "Please also mention it somewhere in the documentation. Even if it's niche." /
   "an important feature such as recurrence needs its own heading in the Calendar documentation" /
   "No need to modify the HTML file directly, please follow the `edit-docs` process."
3. **Questions (8)** — "what's the use case here? Is there an issue related to it?" / "what happens
   if you add too many items in the launch bar?" / "Why were the `if` conditions removed?"
4. **Simplify (6)** — "Too complicated. Extract to a function with simple `if`s and `return`s." /
   "There's no benefit of having a wrapper class" / "This doesn't make sense as a standalone method,
   it needs to be inline." / "This whole resize mechanism feels overengineered. Do we actually need
   it? I tried remove part of it and it worked just fine."
5. **Scope (5)** — "It's not part of the fix, it's a completely separate feature so it deserves its
   own PR." / "the tree is for note-related options, there are no other content-copy operations in
   it." / "could you please try to separate the features into multiple PRs?"
6. **Tests (5)** — "Missing tests. The event builder has pretty decent coverage and I would like to
   keep it that way." / "The test is OK-ish, although I feel it's quite a bit complicated."
7. **i18n (5)**, **diff noise (3)** — "I see you re-formatted the entire file and this makes it
   really hard to see what actually got changed." — **offline/privacy/size (3)**, **where a value
   lives (3)** — "All new options/configurations in Trilium must also be exposed to the user
   through the UI, not just through attributes." / "We don't expose additional widgets to the
   front end API, only widgets that are actually used by Trilium." — **naming (3)** — a syntax
   colliding with attribute names — **consistency (2)**, **reuse (2)** — "Let's just use
   `useNoteLabel` instead." / "Why not simply use `<FormTextBox>` with `type=datetime-local`".

Never asked on a merged PR: commit-message format, squash or rebase, sync implications. The
regulars follow the subject convention; nobody else is held to it — the maintainer fixes it.

**Fixed by the maintainer on the branch** (42 of 147 PRs carry his commits; 16 of the 28
substantive ones merged with no review text — he edits rather than asks): typecheck and lock
files; renames (`textarea` → `multiline text`); inlining single-caller helpers and shortening
comments; the `docs(user): …` and `test(…): …` commits the contributor did not write; the bot's
suggestion; a second-order bug found while testing; widening to the sibling platform or API (a
backend script-API method gets its frontend twin); moving a control to where it belongs. Three
contributions became seeds he rewrote wholesale (link previews: 17 of 20 commits his; the Ollama
provider: 22 of 31; the iOS app: 20 of 43).

**Sent back instead**: a crash on bad input; an unrequested feature riding along; missing tests on
a covered module; an unreviewable reformatted diff; a feature in the wrong menu; a syntax that
collides with attribute names. Closed outright: an undiscussed design in a maintainer-led area, a
bounty attempt, and anything he preferred to re-do at a different seam.

He also merges imperfect work that moves in the right direction and says so: "OK as a first
implementation, although the long-term fix is to get rid of the jQuery" / "Please note that this
will not be the final form" — then polishes on `main` within the week rather than holding the PR.

## Mechanical checks on a diff

The house rules from `CLAUDE.md` that a diff can be checked for. Each is a gap for the maintainer's
"you finish" list — a verdict changes only when they are pervasive enough to show the code was
written beside the codebase rather than in it. Run them in the verify worktree
(`.claude/worktrees/pr-N`) with `R=$(git merge-base HEAD origin/main)..HEAD`:

| rule | check |
|---|---|
| bugfix subject carries `(closes #N)` | `git log --format=%s $R \| grep -E '^fix' \| grep -vE '\((closes\|regression of) #[0-9]+\)'` |
| no non-null assertion `!` | added lines: `git diff -U0 $R -- '*.ts' '*.tsx' \| grep '^+' \| grep -P '[A-Za-z0-9_)\]]!(?=[.\[);,]\|$)'` (strings and `!==` excluded by eye) |
| no `forEach` | `git diff -U0 $R \| grep '^+' \| grep -E '\.forEach\('` |
| no inline `style=` in JSX | `git diff -U0 $R -- '*.tsx' \| grep '^+' \| grep -E '\bstyle=\{'` |
| a `.css` twin per new component | each added `*.tsx` outside specs has `${f%.tsx}.css` |
| reuse the react components | added `<(input\|select\|button\|textarea\|a)\b` or `form-control\|input-group\|btn btn-` in `.tsx` under `apps/client` |
| no `localStorage` / secure-context crypto in the client | `grep -E 'localStorage\|sessionStorage\|crypto\.randomUUID\|crypto\.subtle'` on added lines |
| safe-area insets via the custom property | added `env(safe-area-inset` without `var(--safe-area` |
| new option: whitelist + default + control | a key added in `options_interface.ts` ⇒ the same diff touches `routes/api/options.ts` (`ALLOWED_OPTIONS`), `options_init.ts`, an options pane and the English catalogue |
| core has no Node built-ins or `process.env` | `git diff -U0 $R -- 'packages/trilium-core/src/**' \| grep '^+' \| grep -E 'process\.env\|from "(node:)?(fs\|path\|os\|crypto\|child_process\|url)"'` |
| server assets never via `import.meta.url` / `__dirname` | added lines under `apps/server/src` |
| the client never imports core | `git diff --name-only $R -- 'apps/client/**' \| xargs grep -l '@triliumnext/core'` is empty |
| core specs run in both runtimes | a core change is verified by `verify` under `apps/server` **and** `apps/standalone` |
| generated help never alone | `doc_notes/**` or `help_meta.json` changed ⇔ `docs/User Guide/**` changed |
| only the `en` catalogues edited | `git diff --name-only $R \| grep -P 'translations/(?!en/)'` is empty |
| `en-GB` twin for US spellings | an added `en` string with `color\|center\|meter\|recogni[sz]e\|labell?ed\|cancell?ed` needs the `en-GB` entry |
| comment style | added comment lines with `—`, ` may `, `was \|previously\|no longer\|moved from\|removed\|intentionally not`; CSS `/* was Npx */` |
| no ~10-SLOC module | `git diff --diff-filter=A --numstat $R \| awk '$1 <= 15 && $3 !~ /spec/'` |
| helpers below the primary export | in an added module, the first non-exported `function` comes after the first `export` |
| CJS dynamic-import interop in split ESM | `const mod = await import("pkg"); const { x } = mod.default ?? mod;` — a plain destructure is the trap (`analyzing-backend-bundle` skill) |
| formatting | `pnpm dev:format-check` in the worktree (never ESLint) |
