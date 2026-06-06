# Testing Preact components (`apps/client/src/widgets/react/`)

> Testing a **hook** (`use*`) rather than a component? Use the `renderHook` harness — see [client-hooks.md](client-hooks.md).

You can render real components **with zero new dependencies**. The test env is already `happy-dom`, esbuild compiles JSX with `jsxImportSource: "preact"`, and `apps/client/src/test/setup.ts` already injects `$`/`glob`/`ws`, auto-mocks `services/server` (incl. `put`/`upload`/`patch`/`remove` + `ws.logError`/`logInfo` as cleared-each-test `vi.fn`s), runs `vi.restoreAllMocks()` after every test, and provides inert `matchMedia`/`ResizeObserver`/`animate`/`scrollIntoView` fallbacks. So **don't re-augment `server`/`ws`, don't add your own `restoreAllMocks`, and don't stub those DOM APIs** unless you need to *drive* one (capture its callback).

## The render helpers — import them, don't re-create them

The shared kit lives in **`apps/client/src/test/render.tsx`** (rendered containers auto–tear-down):

```ts
import { renderInto, renderComponent, renderHook, flush, fakeNoteContext, makeLoadResults, resetFroca } from "../../test/render";
// bootstrap stub (Tooltip/Dropdown/Modal):
import { bootstrapMock } from "../../test/mocks";   // vi.mock("bootstrap", () => bootstrapMock())
```

- **`renderInto(vnode)` → `HTMLElement`** — a presentational component, no Trilium context. (Icon/Button/FormSelect…)
- **`renderComponent(vnode, { parent?, noteContext? })` → `{ container, parent, rerender, unmount }`** — wraps in `ParentComponent` + `NoteContextContext`, so `useTriliumEvent` registers against `parent` (drive events via `parent.handleEventInChildren(name, data)`) and note-context hooks resolve. Pass `noteContext: fakeNoteContext({…})`.
- **`renderHook` / `flush` / `makeLoadResults`** — see [client-hooks.md](client-hooks.md).
- **`fakeNoteContext(overrides)`**, **`resetFroca()`** — shared fixtures (call `resetFroca()` in `beforeEach` if you mutate froca).

> Proven at scale: ~250 widget specs use these; the kit fixes the `let container: HTMLDivElement | undefined` → `render(...)` type error that hand-rolled helpers kept reintroducing. Spec files using JSX must be named `*.spec.tsx`.

## Firing events — match Preact's delegated event names

Set the value, then dispatch the **native** event Preact listens for, always with `{ bubbles: true }`:

| Handler | Dispatch | Notes |
|---|---|---|
| `onClick` | `el.click()` | simplest |
| `onInput` | `new Event("input", { bubbles: true })` | text inputs |
| `onChange` (on `<select>`) | `new Event("change", { bubbles: true })` | |
| **`onBlur`** | **`new Event("focusout", { bubbles: true })`** | ⚠️ Preact delegates blur→`focusout`; a `"blur"` event silently does **nothing** |

## Tier A — presentational (props → DOM + click)

```tsx
import { describe, expect, it, vi } from "vitest";
import { renderInto } from "../../test/render";
import Icon from "./Icon";
import Button from "./Button";

describe("Icon", () => {
    it("composes icon + extra classes and passes through title", () => {
        const span = renderInto(<Icon icon="bx bx-search" className="extra" title="Search" />).querySelector("span")!;
        expect(span.className).toBe("bx bx-search extra tn-icon");
        expect(span.getAttribute("title")).toBe("Search");
    });
    it("falls back to bx-empty when no icon given", () => {
        expect(renderInto(<Icon />).querySelector("span")!.className).toBe("bx bx-empty tn-icon");
    });
});

describe("Button", () => {
    it("applies kind class, becomes type=button with a handler, fires onClick", () => {
        const onClick = vi.fn();
        const btn = renderInto(<Button text="Save" onClick={onClick} kind="primary" />).querySelector("button")!;
        expect(btn.className).toContain("btn-primary");
        expect(btn.getAttribute("type")).toBe("button");   // submit only when no handler/command
        btn.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });
    it("does not fire onClick when disabled", () => {
        const onClick = vi.fn();
        renderInto(<Button text="Nope" disabled onClick={onClick} />).querySelector("button")!.click();
        expect(onClick).not.toHaveBeenCalled();
    });
});
```

## Tier B — stateful / controlled form components

```tsx
import { describe, expect, it, vi } from "vitest";
import { renderInto } from "../../test/render";
import FormTextBox from "./FormTextBox";
import FormSelect from "./FormSelect";

function typeInto(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("FormTextBox", () => {
    it("clamps number inputs to [min,max] on change", () => {
        const onChange = vi.fn();
        const input = renderInto(<FormTextBox type="number" min={1} max={10} currentValue="5" onChange={onChange} />).querySelector("input")!;
        typeInto(input, "999");
        expect(onChange).toHaveBeenLastCalledWith("10", expect.anything());   // applyLimits() clamps
    });
    it("fires onBlur with the clamped value", () => {
        const onBlur = vi.fn();
        const input = renderInto(<FormTextBox type="number" min={2} onBlur={onBlur} />).querySelector("input")!;
        input.value = "0";
        input.dispatchEvent(new Event("focusout", { bubbles: true }));   // NOT "blur"
        expect(onBlur).toHaveBeenCalledWith("2");
    });
});

describe("FormSelect", () => {
    it("renders options, marks current, emits key on change", () => {
        const onChange = vi.fn();
        const values = [{ key: "a", label: "Apple" }, { key: "b", label: "Banana" }];
        const select = renderInto(<FormSelect values={values} keyProperty="key" titleProperty="label" currentValue="b" onChange={onChange} />).querySelector("select")!;
        expect(select.value).toBe("b");
        select.value = "a";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith("a");
    });
});
```

## Tier C — components importing services / i18n / bootstrap

`vi.mock` the side-effectful service and partial-mock `./hooks` so the real DOM still renders:

```tsx
import { describe, expect, it, vi } from "vitest";
import { renderInto } from "../../test/render";

vi.mock("../../services/keyboard_actions", () => ({
    default: { getAction: vi.fn().mockResolvedValue({ effectiveShortcuts: [] }) }
}));
vi.mock("./hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./hooks")>()),
    useStaticTooltip: vi.fn()        // stub only the bootstrap-Tooltip hook
}));
import ActionButton from "./ActionButton";   // import AFTER the mocks (they're hoisted)

describe("ActionButton", () => {
    it("renders icon-action button and forwards trigger command", () => {
        const onClick = vi.fn();
        const btn = renderInto(<ActionButton text="Delete" icon="bx bx-trash" triggerCommand="saveToNoteMap" onClick={onClick} />).querySelector("button")!;
        expect(btn.className).toContain("icon-action");
        expect(btn.getAttribute("data-trigger-command")).toBe("saveToNoteMap");
        btn.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
```

## Component-specific gotchas

- **`isMobile()`/`isDesktop()` are cached at module load** (`const cachedIsMobile = isMobile()` in `Button`/`ActionButton`). To exercise both branches, `vi.mock("../../services/utils")` **before** importing the component — a runtime spy is too late.
- **`Modal`** visibility is driven by the bootstrap Modal instance + `openDialog` (jQuery) inside `useEffect`; show/hide won't behave under happy-dom. Treat it as integration-tier; in happy-dom only assert its static structure with `show`.
- Pre-existing stderr noise (KaTeX "quirks mode", the `setup.ts` "vi.mock not at top level" warning) is **not** a failure — ignore it.

## Optional ergonomic upgrade

Once the raw approach is established, you may add `@testing-library/preact` (+ `@testing-library/jest-dom`) as client devDeps. The concrete win: `fireEvent.blur()` hides the focusout gotcha, `cleanup` removes the manual `afterEach`, and `getByRole`/jest-dom matchers (`toBeDisabled`, `toHaveValue`) read better. It's a convenience layer, not a requirement — neither is installed today.

## Best first targets (high branch density)

`Icon` → `Button` (kind/size/type/`<kbd>` branches) → `FormTextBox` (`applyLimits` clamping) → `FormSelect` (optgroups) → `ActionButton` / `Badge` (Tier C). Defer `Modal`.
