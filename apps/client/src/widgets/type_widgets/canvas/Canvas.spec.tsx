import type { OptionNames } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Hoisted shared state — declared via vi.hoisted so the (hoisted) vi.mock factories can read it.
const hoisted = vi.hoisted(() => ({
    // Capture the props Excalidraw is rendered with so we can drive its callbacks (onWheel sits on
    // the outer wrapper; onLinkOpen / excalidrawAPI / theme / viewModeEnabled / langCode come here).
    excalidrawProps: [] as Record<string, unknown>[],
    persistenceStub: { onChange: () => {}, onLibraryChange: () => {} },
    goToLinkExt: vi.fn(() => true)
}));
const { excalidrawProps, persistenceStub, goToLinkExt } = hoisted;

vi.mock("@excalidraw/excalidraw", () => ({
    Excalidraw: (props: Record<string, unknown>) => {
        hoisted.excalidrawProps.push(props);
        // Invoke the excalidrawAPI callback so the component's apiRef gets populated.
        const setApi = props.excalidrawAPI as ((api: unknown) => void) | undefined;
        setApi?.({ fake: "api" });
        return <div className="fake-excalidraw" />;
    }
}));

// Mock the CSS side-effect import (no styling needed under happy-dom).
vi.mock("@excalidraw/excalidraw/index.css", () => ({}));
vi.mock("./Canvas.css", () => ({}));

// Persistence is exercised by its own spec; stub it so Canvas.tsx is isolated and froca/server
// blob loading isn't triggered. The returned object is spread onto <Excalidraw {...persistence} />.
vi.mock("./persistence", () => ({ default: vi.fn(() => hoisted.persistenceStub) }));

// Spy on the link navigation helper invoked from onLinkOpen; keep the rest of the link service
// intact (app_context imports its default export + ViewScope type).
vi.mock("../../../services/link", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/link")>()),
    goToLinkExt: hoisted.goToLinkExt
}));

import type NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import options from "../../../services/options";
import { buildNote } from "../../../test/easy-froca";
import Canvas from "./Canvas";
import useCanvasPersistence from "./persistence";

// --- Render helper --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
function renderCanvas(props: { note: FNote; noteContext?: NoteContext }) {
    const target = document.createElement("div");
    container = target;
    document.body.appendChild(target);
    act(() => {
        render(
            <Canvas
                note={props.note}
                noteContext={props.noteContext}
                viewScope={undefined}
                ntxId={null}
                parentComponent={undefined}
            />,
            target
        );
    });
    return target;
}

function teardownContainer() {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

function lastProps() {
    return excalidrawProps[excalidrawProps.length - 1];
}

// happy-dom's matchMedia returns undefined by default; useColorScheme reads window.glob.getThemeStyle.
let originalMatchMedia: typeof window.matchMedia;
let originalGlob: unknown;

beforeEach(() => {
    excalidrawProps.length = 0;
    setOptions({});
    vi.clearAllMocks();
    (useCanvasPersistence as ReturnType<typeof vi.fn>).mockReturnValue(persistenceStub);

    originalMatchMedia = window.matchMedia;
    originalGlob = (window as unknown as { glob: unknown }).glob;
    window.matchMedia = vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
    }) as unknown as typeof window.matchMedia;
    (window as unknown as { glob: { getThemeStyle: () => string } }).glob = {
        getThemeStyle: () => "light"
    };
});

afterEach(() => {
    teardownContainer();
    window.matchMedia = originalMatchMedia;
    (window as unknown as { glob: unknown }).glob = originalGlob;
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("Canvas", () => {
    it("renders the canvas wrapper structure and mounts Excalidraw with base props", () => {
        const note = buildNote({ id: "c1", title: "Canvas", type: "canvas" });
        const el = renderCanvas({ note });

        expect(el.querySelector(".canvas-render")).not.toBeNull();
        expect(el.querySelector(".excalidraw-wrapper")).not.toBeNull();
        expect(el.querySelector(".fake-excalidraw")).not.toBeNull();

        const props = lastProps();
        expect(props.theme).toBe("light");
        expect(props.zenModeEnabled).toBe(false);
        expect(props.isCollaborating).toBe(false);
        expect(props.detectScroll).toBe(false);
        expect(props.autoFocus).toBe(false);
        // persistence props spread onto Excalidraw
        expect(props.onChange).toBe(persistenceStub.onChange);
        expect(props.onLibraryChange).toBe(persistenceStub.onLibraryChange);
    });

    it("resolves langCode from the locale option mapping, and falls back to undefined for unknown locales", () => {
        const note = buildNote({ id: "c2", title: "Canvas", type: "canvas" });

        setOptions({ locale: "de" });
        renderCanvas({ note });
        expect(lastProps().langCode).toBe("de-DE");

        // ga maps to null in LANGUAGE_MAPPINGS -> coerced to undefined via `?? undefined`.
        teardownContainer();
        excalidrawProps.length = 0;
        setOptions({ locale: "ga" });
        renderCanvas({ note });
        expect(lastProps().langCode).toBeUndefined();

        // An unrecognised locale id -> mapping lookup is undefined -> undefined.
        teardownContainer();
        excalidrawProps.length = 0;
        setOptions({ locale: "zz-unknown" });
        renderCanvas({ note });
        expect(lastProps().langCode).toBeUndefined();
    });

    it("enables view mode when the readOnly label is set", () => {
        const note = buildNote({ id: "c3", title: "Canvas", type: "canvas", "#readOnly": "true" });
        renderCanvas({ note });
        expect(lastProps().viewModeEnabled).toBe(true);
    });

    it("enables view mode when the databaseReadonly option is on (even without readOnly label)", () => {
        const note = buildNote({ id: "c4", title: "Canvas", type: "canvas" });
        setOptions({ databaseReadonly: "true" });
        renderCanvas({ note });
        expect(lastProps().viewModeEnabled).toBe(true);
    });

    it("keeps view mode disabled for an editable note", () => {
        const note = buildNote({ id: "c5", title: "Canvas", type: "canvas" });
        renderCanvas({ note });
        expect(lastProps().viewModeEnabled).toBe(false);
    });

    it("onWheel prevents default + stops propagation only when ctrl is held", () => {
        const note = buildNote({ id: "c6", title: "Canvas", type: "canvas" });
        const el = renderCanvas({ note });
        const wrapper = el.querySelector(".canvas-render");
        expect(wrapper).not.toBeNull();
        if (!wrapper) return;

        const ctrlWheel = new Event("wheel", { bubbles: true, cancelable: true }) as Event & { ctrlKey: boolean };
        Object.defineProperty(ctrlWheel, "ctrlKey", { value: true });
        const ctrlPrevent = vi.spyOn(ctrlWheel, "preventDefault");
        const ctrlStop = vi.spyOn(ctrlWheel, "stopPropagation");
        wrapper.dispatchEvent(ctrlWheel);
        expect(ctrlPrevent).toHaveBeenCalled();
        expect(ctrlStop).toHaveBeenCalled();

        const plainWheel = new Event("wheel", { bubbles: true, cancelable: true }) as Event & { ctrlKey: boolean };
        Object.defineProperty(plainWheel, "ctrlKey", { value: false });
        const plainPrevent = vi.spyOn(plainWheel, "preventDefault");
        wrapper.dispatchEvent(plainWheel);
        expect(plainPrevent).not.toHaveBeenCalled();
    });

    it("onLinkOpen returns false for an element without a link", () => {
        const note = buildNote({ id: "c7", title: "Canvas", type: "canvas" });
        renderCanvas({ note });
        const onLinkOpen = lastProps().onLinkOpen as (el: unknown, ev: unknown) => unknown;

        const event = { detail: { nativeEvent: {} }, preventDefault: vi.fn() };
        const result = onLinkOpen({ link: undefined }, event);
        expect(result).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(goToLinkExt).not.toHaveBeenCalled();
    });

    it("onLinkOpen forwards an external link verbatim to goToLinkExt", () => {
        const note = buildNote({ id: "c8", title: "Canvas", type: "canvas" });
        renderCanvas({ note });
        const onLinkOpen = lastProps().onLinkOpen as (el: unknown, ev: unknown) => unknown;

        const nativeEvent = { kind: "native" };
        const event = { detail: { nativeEvent }, preventDefault: vi.fn() };
        const result = onLinkOpen({ link: "https://example.com" }, event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(goToLinkExt).toHaveBeenCalledWith(nativeEvent, "https://example.com", null);
        expect(result).toBe(true);
    });

    it("onLinkOpen rewrites a root/ link to a hash note link before navigating", () => {
        const note = buildNote({ id: "c9", title: "Canvas", type: "canvas" });
        renderCanvas({ note });
        const onLinkOpen = lastProps().onLinkOpen as (el: unknown, ev: unknown) => unknown;

        const nativeEvent = { kind: "native" };
        const event = { detail: { nativeEvent }, preventDefault: vi.fn() };
        onLinkOpen({ link: "root/abc123" }, event);

        expect(goToLinkExt).toHaveBeenCalledWith(nativeEvent, "#root/abc123", null);
    });
});
