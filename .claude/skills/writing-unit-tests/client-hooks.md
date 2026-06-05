# Testing Preact hooks (`apps/client/src/widgets/react/hooks.tsx`)

Hooks can't be called outside a render. Test them by mounting a throwaway component that calls the hook and exposes its return value — using the **shared harness** `apps/client/src/test/render-hook.tsx`. It renders inside the real `ParentComponent`/`NoteContextContext` providers (the same ones `react_utils.tsx` uses in the app), so `useTriliumEvent`/`useTriliumEvents` register against a real `Component` you can drive.

> **Proven:** all ~50 hooks in `hooks.tsx` were taken from 0.8% → **100% lines / 90.6% branches** (64 tests, zero new deps, no production-code changes) in `hooks.spec.tsx`. Use that file as the worked example.

## The harness (already in the repo — import it, don't re-create)

```ts
import { renderHook, flush, makeLoadResults } from "../../test/render-hook";
```

- **`renderHook(useHook, { parent?, noteContext? })`** → `{ result, parent, fireEvent, rerender, unmount }`.
  - `result.current` — the hook's latest return value; **re-read it after every `fireEvent`/`flush`/`rerender`** (don't destructure once).
  - `fireEvent(name, data)` — synchronously dispatches a Trilium event to the hook's handlers (wraps `parent.handleEventInChildren`).
  - `rerender(hook?)` — re-render with a new closure, e.g. to change the hook's arguments.
  - `unmount()` — runs the hook's cleanup effects (test `removeEventListener`/`dispose`/unsubscribe paths here).
- **`await flush()`** — settles async effect chains (froca/server) **and** the resulting re-render. A bare `act()` is **not** enough for anything that `await`s froca; use `flush()`.
- **`makeLoadResults({ attributeRows?, branchRows?, optionNames?, reloadedNoteIds?, contentReloadedNoteIds?, entities? })`** — a duck-typed `LoadResults` for `entitiesReloaded`-style events; implement only the accessors the hook reads.

`act` comes from `preact/test-utils` (ships with preact — no install). Spec files using JSX must be `*.spec.tsx`.

## Patterns by hook shape

**Pure / value hook** — just read `result.current`:
```ts
expect(renderHook(() => useUniqueName("box")).result.current).toMatch(/^box-[a-zA-Z0-9]{10}$/);
```

**Option hook** — seed with `options.load(...)`, then fire `entitiesReloaded`:
```ts
options.load({ theme: "dark" } as Record<OptionNames, string>);
const h = renderHook(() => useTriliumOption("theme" as OptionNames));
expect(h.result.current[0]).toBe("dark");
options.load({ theme: "light" } as Record<OptionNames, string>);
h.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ optionNames: [ "theme" ] }) });
expect(h.result.current[0]).toBe("light");
await act(async () => { await h.result.current[1]("blue"); });   // setter → options.save → server.put
```

**Note-data hook (froca)** — build with `easy-froca`, then `await flush()` for the async effect:
```ts
buildNote({ id: "p", title: "P", children: [ { id: "c1", title: "C1" } ] });
const h = renderHook(() => useChildNotes("p"));
await flush();
expect(h.result.current.map(n => n.noteId)).toEqual([ "c1" ]);
```

**Attribute hook** — fire `entitiesReloaded` with `attributeRows`. `attributes.isAffecting` matches when the row's `noteId` is a **cached** note (build it) equal to / an ancestor of the hook's note. Spy the writer for setters:
```ts
const note = buildNote({ id: "n", title: "N", "#status": "open" });
const setLabel = vi.spyOn(attributes, "setLabel").mockImplementation(() => undefined as never);
const h = renderHook(() => useNoteLabel(note, "status"));
h.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ attributeRows: [ { type: "label", name: "status", value: "closed", noteId: "n", isDeleted: false } ] }) });
act(() => h.result.current[1]("done"));
expect(setLabel).toHaveBeenCalledWith("n", "status", "done");
```

**Note-context hook** — pass a fake context (cast through `unknown`, implement only the fields the hook touches) via the `noteContext` option, or stub `appContext.tabManager.getActiveContext` for the *active* variant:
```ts
const ctx = { ntxId: "ntx1", viewScope: { viewMode: "default" }, isReadOnly: vi.fn(async () => true) } as unknown as NoteContext;
renderHook(() => useNoteContext(), { noteContext: ctx });
```

**DOM-observer hook** — happy-dom's `ResizeObserver`/`matchMedia` are inert stubs; replace them to capture and fire the callback:
```ts
const observers: { cb: () => void }[] = [];
class FakeRO { constructor(public cb: () => void) { observers.push({ cb }); } observe(){} unobserve(){} disconnect(){} }
Object.assign(window, { ResizeObserver: FakeRO });
const cb = vi.fn();
renderHook(() => useResizeObserver({ current: document.createElement("div") }, cb));
act(() => observers.forEach(o => o.cb()));
expect(cb).toHaveBeenCalled();
```

**Service-coupled hook** — `vi.mock` the side-effectful module at the **top** of the spec (hoisted above the hook import). For bootstrap tooltips, mock `"bootstrap"` with a stub `Tooltip` class (the module patches `Tooltip.prototype.dispose` at import) and add a no-op `$.fn.tooltip`:
```ts
vi.mock("../../services/math", () => ({ default: { render: vi.fn() } }));
vi.mock("bootstrap", () => { class Tooltip { static getInstance(){return null;} dispose(){} hide(){} show(){} } return { Tooltip }; });
```

**Legacy-widget hook (`useLegacyWidget`)** — the harness's `Harness` returns `null`, so the hook's returned VNode never mounts. To exercise the append/cleanup effects, render the VNode yourself:
```ts
let widget: FakeWidget | undefined;
function Host() { const [ vnode, w ] = useLegacyWidget(() => new FakeWidget()); widget = w; return vnode; }
act(() => render(<ParentComponent.Provider value={parent}><Host /></ParentComponent.Provider>, host));
```

## Footguns (each cost real time)

- **`vi.restoreAllMocks()` in `afterEach` is mandatory.** `vi.spyOn(froca, …)`/`vi.spyOn(tree, …)` **leak across tests** in the same file — a later real call then returns `undefined` (e.g. `useChildNotes` silently yields `[]`). `clearAllMocks` is not enough; you must *restore*.
- **Augment `server` and `ws` per test.** `test/setup.ts`'s auto-mock only defines `server.get`/`server.post`. Setter/save/upload hooks need `Object.assign(server, { put: vi.fn(async()=>undefined), upload: vi.fn(async()=>undefined) })` and `Object.assign(ws, { logError: vi.fn() })` in `beforeEach`.
- **Use valid typed label/relation names** or `tsc --build` fails. They're curated unions in `packages/commons/src/lib/attribute_names.ts` (`FilterLabelsByType<T>`): relations are `searchScript|ancestor|renderNote|disabled:renderNote|target|widget`; bool labels include `archived`/`includeArchived`/`readOnly`; number labels are `pageSize`/`maxNestingDepth`/`tabWidth`. Arbitrary names like `"status2"`/`"count"` are type errors.
- **A non-cached `noteId` triggers a froca server-load → unhandled rejection** (the mock server throws on `tree/load`). Vitest reports it as an "unhandled error" that can flag false positives. Build the note via `easy-froca`, or spy the loader (`vi.spyOn(tree, "getNoteTitle").mockResolvedValue(...)`).
- **`await flush()` for async, plain `act()` for sync.** froca/server effects span multiple microtasks; a single `act()` won't drain them — use `flush()` (a macrotask inside async `act`). Re-establish module-mock defaults (e.g. `protected_session_holder.isProtectedSessionAvailable`) in `beforeEach` after `clearAllMocks`, since per-test overrides persist.
- A bare `act(() => { … })` statement trips typescript-eslint `no-floating-promises` (act returns a thenable). It's a **warning, not a `tsc` error**, and ESLint isn't gated in CI — leave it, or `void act(...)`.
- A brand-new `.tsx` helper under `src/test/` shows a stale **TS6307** ("not listed within the file list") in the IDE until `tsc --build` rebuilds the app project reference; the real `pnpm typecheck` resolves it. Verify specs with `tsc --build apps/client/tsconfig.spec.json` (build mode), not plain `tsc -p`.

See also [client-components.md](client-components.md) for rendering Preact *components* (the `renderInto` recipe).
