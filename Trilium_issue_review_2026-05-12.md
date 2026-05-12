# Trilium Issue Review 2026-05-12

## Scope
- Repository: `/Users/pranay/Projects/_bounties/Trilium`
- PR: `#9708`
- Issue linkage: `#5561` (task management board progress slice)
- Focus: workflow compliance audit + review-comment remediation

## Instruction And Context Review Completed
- Reviewed workspace instruction stack:
  - `/Users/pranay/AGENTS.md`
  - `/Users/pranay/Projects/AGENTS.md`
- Reviewed repo-level instruction surfaces:
  - `/Users/pranay/Projects/_bounties/Trilium/CLAUDE.md`
  - `/Users/pranay/Projects/_bounties/Trilium/.github/copilot-instructions.md`
- Checked project state and branch drift with `git status --short --branch`.

## Architecture And Ownership Review
- Board feature ownership surface reviewed:
  - `apps/client/src/widgets/collections/board/index.tsx`
  - `apps/client/src/widgets/collections/board/api.ts`
  - `apps/client/src/widgets/collections/board/column.tsx`
  - `apps/client/src/widgets/collections/board/data.ts`
  - `apps/client/src/widgets/collections/board/data.spec.ts`
  - `apps/client/src/widgets/collections/board/index.css`
  - `apps/client/src/translations/en/translation.json`
- Existing abstraction ownership confirmed:
  - `BoardApi` is canonical board-action wrapper.
  - `calculateBoardProgress()` belongs in board data utility, not UI layer.

## Pattern Search Findings
- Constructor alias mismatch class:
  - Searched `new Api(` and board imports; mismatch was isolated to board `index.tsx`.
- Accessibility pattern:
  - Progressbar role used in board and media options widget.
  - Board progressbar lacked direct accessible naming before patch.
- Progress normalization pattern:
  - Done-column normalization logic was asymmetrical (trim/case mismatch risk) before patch.

## Root Causes
1. Incomplete import refactor: default import renamed to `BoardApi`, but instantiation still used `Api`.
2. Accessibility semantics gap: `aria-label` on wrapper does not label nested `role="progressbar"`.
3. Matching inconsistency: `doneColumnsRaw` trimmed/lowercased but board column keys only lowercased.
4. Perf/type concerns: helper used intermediate arrays and broad `Map<string, unknown[]>` type.

## Changes Applied
1. `apps/client/src/widgets/collections/board/index.tsx`
- Replaced `new Api(...)` with `new BoardApi(...)`.
- Added direct `aria-label` to `.board-progress-track[role="progressbar"]`.

2. `apps/client/src/widgets/collections/board/data.ts`
- Tightened helper signature from `Map<string, unknown[]>` to `ColumnMap`.
- Rewrote progress computation using `for...of` loops (no intermediate arrays).
- Normalized both lookup sides with `trim().toLowerCase()`.

3. `apps/client/src/widgets/collections/board/data.spec.ts`
- Updated test fixture typing to use `ColumnMap`.
- Added normalization regression test for whitespace/case handling.

## Related Issues Found (Not Changed In This Pass)
- `apps/client/src/widgets/type_widgets/options/media.tsx` contains inline style + progressbar usage pattern.
- Not directly in scope of PR `#9708`, but should be reviewed in a follow-up accessibility/style consistency sweep.

## Validation Plan And Evidence
- Commands to run for this slice:
  1. `pnpm --filter @triliumnext/client test src/widgets/collections/board/data.spec.ts`
  2. `pnpm exec eslint apps/client/src/widgets/collections/board/index.tsx apps/client/src/widgets/collections/board/data.ts apps/client/src/widgets/collections/board/data.spec.ts`

## Risk Assessment
- Runtime risk: reduced (constructor reference bug fixed).
- Accessibility risk: reduced (progressbar now directly named).
- Data/logic risk: reduced (symmetric normalization + explicit tests).
- Broader UX/a11y consistency risk: still open for non-board widgets.

## Recommended Follow-Up
1. Run a focused a11y sweep for all `role="progressbar"` usages in client widgets.
2. Consider replacing inline width styles in progress UIs with CSS custom property patterns where feasible.
3. Add CI lint rule/check specifically for unlabeled `role="progressbar"` occurrences if current stack does not enforce it.
