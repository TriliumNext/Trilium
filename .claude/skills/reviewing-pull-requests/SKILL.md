---
name: reviewing-pull-requests
description: Use whenever a Trilium pull request is to be judged — "review PR N", "is #N good?", "which PRs should I merge?", "list the merge candidates", "triage the open PRs", "does this fit Trilium?", "compare #A and #B", "draft feedback for this contributor", or any PR number or link with an evaluative question attached. Also use when asked what is mergeable, what to close, or whether a contributor's fix targets the bug it names. The judgement is about fit and shape (philosophy, targeting, complexity, spec, docs), never about CI, conflicts or the description; every candidate is checked out in a temporary worktree and its specs run red/green against the base. Provides review.mjs (list / dossier / verify / dupes / issue / clean) and references on the philosophy as the maintainers apply it, why PRs get closed here, and what an accepted change looks like. Never writes to GitHub. Not for an uncommitted local diff (/code-review) and not for CKEditor-plugin internals (ckeditor5-reviewing, which this skill delegates to).
---

# Reviewing pull requests

A PR arrives with a title, a description and a green check mark, and all three are the author's
claims. This skill judges a PR from three things instead: the **issue** (what is actually wrong or
wanted), the **diff read in the context of the code around it**, and a **verification run** on a
checkout of the branch. The verdict is about whether the change fits this project and has the shape
the maintainers would have given it — because the most common fate of a working contribution here
is not "declined" but "re-done smaller by the maintainer" (33 of 126 closed PRs with a discussion).

Everything mechanical is [review.mjs](review.mjs):

```bash
R=.claude/skills/reviewing-pull-requests/review.mjs
node $R list                 # every open PR: kind, age, size by file kind, issues, flags, rivals
node $R dupes                # open PRs competing for the same issue or subject
node $R dossier 11536        # the PR in full: body, linked issues + their discussion, commits,
                             # files by kind, human review threads (bots folded), rivals
node $R verify 11536         # worktree at .claude/worktrees/pr-11536, install, typecheck, the
                             # PR's specs green on the branch and red with production reverted,
                             # sibling specs, dependency lines, docs impact — ~25 s for a small PR
node $R issue 6853           # an issue with its human comments: the problem statement itself
node $R clean 11536          # remove the worktree (all of them without a number)
```

`dossier` and `verify` save their reports under `.claude/reviews/pr-N/` (gitignored). Nothing here
writes to GitHub — see **Conduct**.

## What is not a factor

State these plainly in a report when the author or a bot leans on them:

- **CI status.** Informational. Forks fail on missing tokens, runners flake, and a green run
  proves the spec passed, not that it tests anything. `verify` answers the real question.
- **Merge conflicts.** The maintainer merges `main` into the branch himself; a PR is merged with
  a merge commit, never squashed. Conflicts matter only when they span the whole change (a branch
  thousands of commits behind, like the MapLibre PR that was rebuilt instead).
- **Age, `size:*` and `lgtm` labels.** `size:*` is a bot's line count; `lgtm` is a bot mirroring a
  maintainer's APPROVED seconds later, not a judgement of its own. `don't merge yet` and `State:*`
  are issue labels; on PRs the state toggle is draft ↔ ready.
- **Bot reviews.** greptile, gemini and codecov comment on every PR. Their findings are unverified
  suggestions; a bot's "approve" is nothing.
- **The description.** Read it last, after the issue and the diff, so it cannot frame the reading.
  Accepted PR bodies are structured prose (`## Why / ## What`, `## Problem / ## Fix`); a body longer
  than the diff is a warning, not a virtue.
- **Whether the author used an agent.** Thirteen agent-assisted PRs by one contributor merged with
  a single APPROVED each. What the maintainers refuse is bulk that does not integrate — additions
  only, planning artifacts in the tree, "vibe coded" — not the tool.

## The dimensions, in the order they decide outcomes

1. **Fit.** Does this belong in Trilium's core at all, and in this shape? The questions are in
   [references/philosophy.md](references/philosophy.md), one per principle: script/widget material?
   an option for one use case? one surface of an app-wide behavior? a workaround for a library?
   outside the data/sync model? an undiscussed design in a maintainer-led area (mobile, sync,
   encryption, storage, `trilium://`)? a changed default or convention? a dependency? Fit decides
   more closed PRs than everything else combined; 40 of the closed PRs had specs.
2. **Problem and cause.** Is the problem real (an issue, a reproduction), is the cause the one the
   diff changes, and does the diff fix *what the reporter described*? The maintainer tests every PR
   by hand and the most common substantive review comment is "it doesn't fix the issue" / "it
   crashes on `00:aa:00`" / "doesn't work on this theme". A fix at the place a symptom is *seen*
   rather than *produced* is `REWORK`.
3. **Targeting and scope.** A bugfix changes the cause and nothing else: no riding feature ("not
   part of the fix, it's a completely separate feature so it deserves its own PR"), no reformatting
   ("makes it really hard to see what actually got changed"), no "while I was here", no labels or
   options beyond what the feature needs. A feature does what the issue thread agreed to, not more.
4. **Size and complexity, against the yardstick.** An accepted bugfix is a median **26 production
   lines in 2 files with a spec larger than the fix**; a feature commit ~74 lines, a feature PR
   ~370. Numbers and exemplars in [references/accepted-shape.md](references/accepted-shape.md).
   Beyond the median, ask the maintainer's question: *which of these files is the bug, and which is
   the refactor you took the opportunity for?* Count abstractions, not lines: a wrapper class, a
   helper with one caller, a new module beside one that does the job, a regex where a parser
   exists, a third mechanism next to two. "Too complicated. Extract to a function with simple `if`s
   and `return`s" is a verdict this project gives.
5. **Robustness.** Bad input ("Always validate user data"), a database with 100 000 notes ("my
   Trilium board has 581 tasks"), other themes and platforms (Windows paths, the flatpak), sync
   peers on an older version, a hidden loss of an existing capability (the sort dialog that lost
   "folders at the bottom"). Look for the branch the author did not test.
6. **Spec.** `verify` says whether the PR's tests fail without the production change and pass
   with it. A new test that passes both ways covers existing behavior, not this fix. A core change
   is proven under `apps/server` **and** `apps/standalone`. No spec on a covered module is a gap;
   a spec that is "quite a bit complicated" is a gap too — the house writes concise ones.
7. **Docs and i18n.** A user-facing change ships with its User Guide page in the same PR, "even if
   it's niche"; `docs/User Guide/**` Markdown and the generated `doc_notes/**` move together
   (hand-edited HTML or unsynced Markdown is a gap); only the `en` catalogues are edited; a new
   option is whitelisted, defaulted and has a control (the seven-file recipe in accepted-shape).
   `verify` runs `docs.mjs impact` for the diff; run it with the feature's name too.
8. **Conventions.** The mechanical checks at the end of accepted-shape (`!`, `forEach`, inline
   `style`, hand-rolled `<input>` where `FormTextBox` exists, `localStorage`, Node built-ins in
   core, comment style, ~10-SLOC modules). Each is a "you finish" gap. They change a verdict only
   in bulk, when they show the code was written beside the codebase rather than in it.

For a diff under `packages/ckeditor5`, load the `ckeditor5-reviewing` skill for the plugin-level
defects; this skill still owns the verdict.

## Workflow A — one PR

1. `node $R dossier N`. Read in this order: the **linked issue and its comments** (the problem, in
   the reporter's and the maintainer's words — if there is none, decide whether the problem is real
   before anything else), the **commits** (subject and body per commit; they land verbatim on
   `main`), the **files by kind and the flags**, the **human review threads** (what a maintainer
   already asked; whether it was done), the **rivals**, and only then the description.
2. `node $R verify N`. Read the report: install, typecheck, each spec's green/red result and which
   tests prove the change, sibling specs, dependency lines, docs impact.
3. **Read the diff in the worktree**, not on GitHub: `git -C .claude/worktrees/pr-N diff
   $(git -C .claude/worktrees/pr-N merge-base HEAD origin/main)` and then the changed files whole,
   with what surrounds them. This is where "reuse the existing helper" (`useNoteLabel`,
   `isCtrlKey`, `FormTextBox`, an existing option) and "wrong layer" are visible and a diff view
   hides them. For a bugfix, find the cause yourself first, then compare.
4. Run the mechanical checks from accepted-shape in the worktree that apply to the touched areas.
5. Judge the eight dimensions. Write findings ordered by weight — a fit problem first, a missing
   `en-GB` twin last.
6. Verdict, with the gaps list, and the report block below.

When the PR has a rival (`dupes`), do both and write one comparison: the smaller change that fixes
the cause usually wins; the earlier one has no precedence by age; sometimes the right answer is a
third, smaller change that neither made — say so, and name it.

## Workflow B — merge candidates (triage)

The question "what should I merge?" is answered in two passes, because verifying 60 PRs costs an
hour and most verdicts do not depend on the code running.

1. `node $R list` and `node $R dupes`. Note what the list hides (bots, the maintainers' own drafts
   and spikes — those are the maintainer's business, not candidates).
2. **Screen on dossiers.** `dossier` each PR (the saved reports accumulate under
   `.claude/reviews/`). Decide from the issue, the commits, the file mix and the review threads
   which PRs cannot be candidates whatever the code does: fit failures, undiscussed designs in
   maintainer-led areas, bulk, riding features, a use case nobody asked for, a rival already
   superseded. Give each a one-line reason and its verdict (`DECLINE`, `REWORK` or `YOUR CALL`).
   Do not read code yet.
3. **Verify the rest.** Everything that survives the screen gets Workflow A in full, `verify`
   included — nothing is called a candidate on a description. For more than a handful, fan out one
   agent per PR with this skill's path and the dossier, each returning the report block; keep the
   ranking and the rival comparisons for yourself.
4. **Resolve rivals** side by side (Workflow A's last step).
5. **Rank the candidates by cost to land**, then by value: no gaps < a subject line or a doc
   paragraph < a spec to write < a fix to make. Value is the issue behind it — a regression, a
   reported bug with traction, a feature a maintainer said yes to — never the PR's own claims.
6. Report with the triage block below. Say which PRs were verified and which were screened out on
   the dossier alone, so the maintainer knows what was and was not run.

## Verdicts

- **MERGE** — right problem, right cause, right shape, fits. The spec proves the change and
  typecheck passes. Gaps, if any, are what the maintainer finishes on the branch in minutes: the
  `(closes #N)` subject, a rename, a doc paragraph, an `en-GB` twin, a redundant comment. List
  them under *You finish*; they do not lower the verdict.
- **MERGE AFTER FIXES** — the same, but something is not right yet and the fix is local: a crash on
  bad input, a missing validation, a test for a well-covered module, a riding change to drop, the
  feature in the wrong menu. The shape stays. List each fix; the contributor or the maintainer does
  them before it lands.
- **REWORK** — the goal is right (and, for a feature, agreed), the shape is wrong: too big for the
  bug, the wrong seam or layer, one surface of an app-wide behavior, a toggle where the default
  should change, a parallel mechanism, a workaround. Name the target shape concretely — the
  maintainer's habit is to write that smaller change himself, so "the fix is the one condition in
  `link.ts:142`, the rest is a refactor" saves a round trip. The *yes, but* table in philosophy.md
  is the catalogue of target shapes.
- **DECLINE** — does not fit: script or widget material, a use case that is not the project's,
  duplicates what exists, an undiscussed architecture from a first-time contributor in a
  maintainer-led area, a workaround for a library the project would rather remove, bulk that does
  not integrate, or a rival that lost. Quote the principle and the precedent (issue or PR number).
- **YOUR CALL** — the code could be fine but the question is direction, and only the maintainer
  settles it: a new default, a convention change, a dependency, a real proposal in a maintainer-led
  area, a plausible feature nobody requested, a behavior change users will notice. State the
  question in one sentence, give a recommendation, and do not call it a merge candidate.

`MERGE` and `MERGE AFTER FIXES` are the merge candidates. A `YOUR CALL` becomes one only after the
maintainer answers.

## Claims to check, not read

| The PR says | Check |
|---|---|
| "Fixes #N" | Read #N. Does the diff address what the reporter described, or a neighbor of it? (#11063 fixed the cursor position, not the duplicated text.) A `(closes #N)` in the title counts as a link even when GitHub did not parse it. |
| "Tested manually", "works for me" | `verify`. Then ask which platform, theme, database size and sync setup — the untested branch is usually the one that breaks. |
| "No user-facing change" | `verify`'s docs impact; grep the diff for `t("`, JSX, CSS, keyboard actions, options, hidden-subtree launchers. |
| "Small change", `size:S` | Production lines and files from the dossier, not the total; then count abstractions. |
| "Added tests" | `verify`'s red run. Tests that pass without the production change do not test it. |
| "Refactor, no behavior change" | Every call site of what moved; a capability quietly lost (folders-at-the-bottom in #11424). |
| "Docs updated" | Both the Markdown and the generated help, produced by `edit-docs`/`docs.mjs sync`, not hand-edited HTML. |
| "Will add docs/tests/UI in a follow-up" | It is a gap now; the PR is judged as it is. The maintainer sometimes allows "a separate PR if needed" — that is his call to make, not the author's. |
| `fix(…)` in the title | Is it a feature? A new plugin, component or module under a `fix(` subject is judged as a feature (discussed? documented? agreed?). |
| "Minimal", "simple" | New classes, wrappers, single-caller helpers, new modules, regexes where a parser exists. |
| "Same as #X but better" | `dupes`; judge both side by side. |
| Bot approval, `lgtm` | A mirror of a human APPROVED at best; nothing on its own. |

## Report block — one PR

```
## #N — <title>
Verdict: MERGE | MERGE AFTER FIXES | REWORK | DECLINE | YOUR CALL
Problem: <the issue in one sentence; whether the diff addresses that, in your words>
Change: <what the diff does, in your words; prod +A/−B in F files, spec, docs>
Fit: <principle engaged, with the precedent, or "fits">
Verified: <spec proves N tests / passes without the change / none; typecheck; runtimes run>
Findings:
- <heaviest first: fit, cause, scope, size, robustness, spec, docs, conventions>
You finish: <gaps the maintainer closes on the branch>            [MERGE]
Fixes before merge: <local fixes>                                   [MERGE AFTER FIXES]
Target shape: <the smaller/other change, concretely>               [REWORK]
Question: <one sentence> — recommendation: <one sentence>          [YOUR CALL]
```

## Report block — triage

```
# Merge candidates — <date> · <N> open PRs, <V> verified, <S> screened on the dossier
## Merge (ranked by cost to land, then value)
1. #N <title> — <value in five words> — you finish: <gaps> — verified: <one line>
## Merge after fixes
## Rework — goal right, shape wrong
## Your call
## Decline
## Rivals — one issue, several PRs
- #A vs #B (issue #I): <which, why, in two lines>
## Not assessed: maintainer drafts and spikes, bots
```

## Conduct

- **Read-only on GitHub.** No comments, no reviews, no labels, no draft toggles, no closes — not
  on PRs, not on issues. The maintainer speaks to contributors; a bot-shaped comment under his name
  is exactly what he objects to in others.
- **Feedback for a contributor is drafted, not sent.** When asked, write it in the maintainer's
  register — short, concrete, the reason with the ask ("Always validate user data. If I enter
  `00:aa:00`, the calendar crashes. Report invalid values via toast; write a test for it.") — and
  hand it over as text to paste.
- **Never write to the PR branch.** The worktree is a reading copy; `verify` restores it and reports
  if it could not.
- **Say what was run.** A verdict without a `verify` run says so; a spec that could not run under
  standalone says so.

## Reference map

| File | Use it for |
|---|---|
| [references/philosophy.md](references/philosophy.md) | The fit dimension: 18 principles as review questions, each with the maintainers' own words and the issue/PR numbers; the *yes, but* table of shapes a request is accepted in. |
| [references/rejection-patterns.md](references/rejection-patterns.md) | Why 126 PRs were closed, as spot-in-a-diff patterns with quotes; the priors (superseded by a smaller change, size, fit over specs). |
| [references/accepted-shape.md](references/accepted-shape.md) | The yardstick: measured size and shape of accepted fixes and features, exemplar commits, how PRs land, what the maintainer asks for vs fixes himself vs sends back, and the mechanical checks. |
