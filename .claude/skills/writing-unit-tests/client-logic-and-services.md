# Testing client widgets & services (`apps/client/src/`)

Two harnesses already exist and do the heavy lifting — use them instead of inventing new ones.

## The fixtures you already have

- **`apps/client/src/test/setup.ts`** (registered as `setupFiles`, runs for every spec): runs under happy-dom, injects `window.$` (jQuery), `window.glob`, a WebSocket stub, and **globally `vi.mock`s `services/ws.js` and `services/server.js`** so froca never hits the network. The default `server` mock returns canned data for `options`/`keyboard-actions`/`tree` GETs and **throws on `tree/load` POST** to force you to seed froca instead.
- **`apps/client/src/test/easy-froca.ts`** — `buildNote(def)` / `buildNotes(def[])` construct real `FNote`/`FAttribute`/`FBranch`/`FBlob`, register them in froca + `noteAttributeCache`, and wire parent/child branches.
  - Labels: `"#color"`; relations: `"~template"`; inheritable: `"#x(inheritable)"`; children: `children: [...]`; content via `content`.
  - ⚠️ It does **not** model template inheritance — `~template`-derived inherited attributes won't behave like production. Cover those in E2E.

## Widgets

### (Primary) Extract pure logic, then test the function

Mirror `apps/client/src/widgets/ribbon/FormattingToolbar.tsx` → `getFormattingToolbarState(...)`, tested in `FormattingToolbar.spec.ts`. Move the widget's "what to show / how to map data" out into a top-level `export function` taking an `FNote` (from `buildNote`), a `NoteContext`, primitives; the widget becomes a thin caller. `vi.mock` only the few services the logic transitively touches (e.g. `services/tree.ts`).

```ts
import { beforeAll, describe, expect, it, vi } from "vitest";
import NoteContext from "../../components/note_context";
import { buildNote } from "../../test/easy-froca";
import { getFormattingToolbarState } from "./FormattingToolbar";

describe("getFormattingToolbarState", () => {
    beforeAll(() => {
        vi.mock("../../services/tree.ts", () => ({ default: { getActiveContextNotePath: () => "root", resolveNotePath: (p: string) => p } }));
        buildNote({ id: "root", title: "Root" });
    });
    it("is hidden for a read-only text note", async () => {
        const note = buildNote({ title: "N", type: "text" });
        const ctx = new NoteContext("abc");
        ctx.noteId = note.noteId;
        ctx.isReadOnly = async () => true;
        ctx.getMainContext = () => ctx; ctx.getSubContexts = () => [ctx];
        expect(await getFormattingToolbarState(ctx, note, "ckeditor-classic")).toBe("hidden");
    });
});
```

### Extract `entitiesReloadedEvent` predicates

The valuable, testable part of a refresh handler is the predicate "given these entity changes, should I refresh?". `LoadResults` (`apps/client/src/services/load_results.ts`) is a plain class built from an `EntityChange[]`. Extract `export function shouldRefreshFor(loadResults, noteId, note)` from the inline handler (e.g. in `toc.ts`, `highlights_list.ts`) and test it with a hand-built `LoadResults`. `vi.mock` `services/attributes` if it calls `isAffecting`.

### (Secondary) Instantiate a legacy `BasicWidget` and assert on `$widget`

`new TheWidget()` then `widget.render()` returns the jQuery `$widget` (see `basic_widget.ts`), queryable with `.find()`/`.html()`/`.hasClass()`. `highlights_list.spec.ts` shows the pattern. Keep these to **leaf** widgets and single methods — a top-level note-detail widget's `doRender` cascades into CKEditor/child widgets and is not unit-testable. Assert on classes (`hidden-int`/`visible`), not computed visibility (happy-dom has no layout).

## Services (`apps/client/src/services/`)

Because `setup.ts` already mocks `server.js` globally, **override specific methods per test** rather than re-mocking the whole module (re-mocking loses the canned `tree`/`options` responses froca needs):

```ts
import { describe, expect, it, vi } from "vitest";
import server from "../services/server";
import { buildNote } from "../test/easy-froca";
import attributeService from "./attributes";

it("setLabel calls server.put and updates froca", async () => {
    const note = buildNote({ title: "N" });
    server.put = vi.fn(async () => ({})) as typeof server.put;
    await attributeService.setLabel(note.noteId, "color", "red");
    expect(server.put).toHaveBeenCalled();
});
```

Rules of thumb:
- Reading froca? `buildNote(...)` it **first** — `froca.getNote` for an unknown id triggers the throwing `tree/load` POST.
- froca is a **singleton** with no reset between tests — use fresh/unique ids (the `buildNote` default) and don't assume an empty cache.
- Many services `await ws.waitForMaxKnownEntityChangeId()`. The global stub provides it; if you locally `vi.mock("./ws.js")` you must re-provide both `subscribeToMessages` and `waitForMaxKnownEntityChangeId` or the await hangs.
- Module-load side effects exist (`branches.ts`/`tree.ts` call `ws.subscribeToMessages` at import); harmless under the global stub.

### Highest-ROI untested service

`apps/client/src/services/load_results.ts` — ~253 lines, **zero deps, pure class**, ~20 branchy methods. 0% → ~95% in one mock-free spec. Then: `tree.ts` string helpers (`getNoteIdFromUrl`, `resolveNotePathToSegments`), `options.ts` (`getJson`/`getInt`/`save`), `branches.ts` (move/delete guards), `mime_types.ts`, `bulk_action.ts` (`parseActions`).
