import { ComponentChild, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) ----------------------------------------

const { openInCurrentNoteContext, loadPresentationTheme, buildPresentationModel } = vi.hoisted(() => ({
    openInCurrentNoteContext: vi.fn(),
    loadPresentationTheme: vi.fn<() => Promise<string>>(async () => ":root { --theme: 1; }"),
    buildPresentationModel: vi.fn()
}));
vi.mock("../../../components/note_context", () => ({ openInCurrentNoteContext }));

// Reveal.js is a heavy, DOM-driven library; replace it with a controllable fake.
// Defined via vi.hoisted so it exists before the hoisted vi.mock factory runs.
const { FakeReveal, revealInstances } = vi.hoisted(() => {
    const revealInstances: FakeRevealInstance[] = [];
    class FakeReveal {
        el: HTMLElement;
        config: { keyboardCondition?: (event: { key: string }) => boolean };
        listeners = new Map<string, Set<() => void>>();
        overview = false;
        initialized = false;
        destroyed = false;
        syncCount = 0;
        currentSlide: HTMLElement | undefined;
        slideCalls: Array<[number, number, number]> = [];
        constructor(el: HTMLElement, config: { keyboardCondition?: (event: { key: string }) => boolean }) {
            this.el = el;
            this.config = config;
            revealInstances.push(this);
        }
        async initialize() { this.initialized = true; }
        isOverview() { return this.overview; }
        toggleOverview() { this.overview = !this.overview; }
        on(name: string, cb: () => void) {
            if (!this.listeners.has(name)) this.listeners.set(name, new Set());
            this.listeners.get(name)?.add(cb);
        }
        off(name: string, cb: () => void) { this.listeners.get(name)?.delete(cb); }
        emit(name: string) { this.listeners.get(name)?.forEach(cb => cb()); }
        sync() { this.syncCount++; }
        destroy() { this.destroyed = true; }
        getCurrentSlide() { return this.currentSlide; }
        getIndices() { return { h: 1, v: 2, f: 3 }; }
        slide(h: number, v: number, f: number) { this.slideCalls.push([ h, v, f ]); }
    }
    return { FakeReveal, revealInstances };
});
type FakeRevealInstance = {
    el: HTMLElement;
    config: { keyboardCondition?: (event: { key: string }) => boolean };
    overview: boolean;
    initialized: boolean;
    destroyed: boolean;
    syncCount: number;
    currentSlide: HTMLElement | undefined;
    slideCalls: Array<[number, number, number]>;
    emit(name: string): void;
};
vi.mock("reveal.js", () => ({ default: FakeReveal }));
vi.mock("reveal.js/reveal.css?raw", () => ({ default: ":root { --base: 1; }" }));
vi.mock("./slidejs.css?raw", () => ({ default: ":root { --custom: 1; }" }));

vi.mock("./themes", () => ({
    DEFAULT_THEME: "white",
    loadPresentationTheme
}));

// The model build pulls in the content renderer; stub it and feed slides directly.
vi.mock("./model", () => ({ buildPresentationModel }));

// Render ShadowDom children inline so the inner Presentation actually mounts (a real shadow
// root + nested preact render is unreliable under happy-dom).
vi.mock("../../react/ShadowDom", () => ({
    default: ({ children, className, containerRef }: {
        children: ComponentChild;
        className?: string;
        containerRef?: { current: HTMLDivElement | null };
    }) => (
        <div
            class={className}
            ref={(el: HTMLDivElement | null) => { if (containerRef) containerRef.current = el; }}
        >{children}</div>
    )
}));

// CollectionProperties has its own deep dependency tree; render only what the view passes in.
vi.mock("../../note_bars/CollectionProperties", () => ({
    default: ({ rightChildren }: { rightChildren?: ComponentChild }) => (
        <div class="collection-properties-stub">{rightChildren}</div>
    )
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useStaticTooltip: vi.fn()
}));

import Component from "../../../components/component";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import type { ViewModeProps } from "../interface";
import PresentationView from "./index";
import type { PresentationModel } from "./model";

// --- Helpers ----------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component | undefined;

function renderInto(vnode: ComponentChild) {
    const el = document.createElement("div");
    container = el;
    document.body.appendChild(el);
    const p = new Component();
    parent = p;
    act(() => {
        render(<ParentComponent.Provider value={p}>{vnode}</ParentComponent.Provider>, el);
    });
    return el;
}

/** Drive a Trilium event through the parent component (which the view subscribes to). */
function fireTrilium(name: string, data: unknown) {
    const p = parent;
    if (!p) throw new Error("renderInto must be called first");
    act(() => {
        (p.handleEventInChildren as (n: string, d: unknown) => unknown)(name, data);
    });
}

/** Settle the chained async effects (model build + theme load) and the resulting re-render. */
async function settle() {
    for (let i = 0; i < 4; i++) {
        await act(async () => { await Promise.resolve(); });
    }
}

function makeModel(slides: PresentationModel["slides"]): PresentationModel {
    return { slides };
}

function makeProps(overrides: Partial<ViewModeProps<object>> = {}): ViewModeProps<object> {
    return {
        note: buildNote({ id: "pres", title: "Pres", children: [ { id: "s1", title: "S1" } ] }),
        notePath: "root/pres",
        noteIds: [ "s1" ],
        highlightedTokens: null,
        viewConfig: undefined,
        saveConfig: vi.fn(),
        media: "screen",
        onReady: vi.fn(),
        onProgressChanged: vi.fn(),
        ...overrides
    } as ViewModeProps<object>;
}

function makeLoadResults(opts: {
    noteIds?: string[];
    attributeRows?: Array<{ noteId?: string; name?: string }>;
} = {}) {
    return {
        getNoteIds: () => opts.noteIds ?? [],
        getAttributeRows: () => opts.attributeRows ?? []
    };
}

const HORIZONTAL_SLIDE = {
    noteId: "s1",
    type: "text" as const,
    content: { __html: "<p>One</p>" },
    backgroundColor: "#fff",
    verticalSlides: undefined
};

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    revealInstances.length = 0;
    openInCurrentNoteContext.mockReset();
    loadPresentationTheme.mockClear();
    loadPresentationTheme.mockResolvedValue(":root { --theme: 1; }");
    buildPresentationModel.mockReset();
    buildPresentationModel.mockResolvedValue(makeModel([ HORIZONTAL_SLIDE ]));
    vi.useFakeTimers();
});

afterEach(() => {
    const el = container;
    if (el) {
        act(() => { render(null, el); });
        el.remove();
        container = undefined;
    }
    parent = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
});

// --- Tests ------------------------------------------------------------------------------------

describe("PresentationView (screen)", () => {
    it("renders nothing until the model and stylesheets resolve, then mounts reveal", async () => {
        const root = renderInto(<PresentationView {...makeProps()} />);
        // The first synchronous render bails out (presentation/stylesheets not ready yet).
        expect(root.querySelector(".presentation-view")).toBeNull();

        await settle();

        expect(root.querySelector(".presentation-view")).not.toBeNull();
        expect(root.querySelector(".presentation-container")).not.toBeNull();
        const slide = root.querySelector<HTMLElement>("#slide-s1");
        expect(slide).not.toBeNull();
        expect(slide?.dataset.noteId).toBe("s1");
        expect(slide?.getAttribute("data-background-color")).toBe("#fff");
        expect(revealInstances.length).toBe(1);
        expect(revealInstances[0]?.initialized).toBe(true);
    });

    it("renders nothing when the note has no children", async () => {
        const note = buildNote({ id: "empty", title: "Empty" });
        const root = renderInto(<PresentationView {...makeProps({ note, noteIds: [] })} />);
        await settle();
        expect(root.querySelector(".presentation-view")).toBeNull();
    });

    it("calls onReady after the ready timeout once api and presentation exist", async () => {
        const onReady = vi.fn();
        renderInto(<PresentationView {...makeProps({ onReady })} />);
        await settle();

        expect(onReady).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(200); });
        expect(onReady).toHaveBeenCalledTimes(1);
    });

    it("applies :host rewriting to stylesheets in screen mode", async () => {
        const root = renderInto(<PresentationView {...makeProps()} />);
        await settle();
        const styleText = Array.from(root.querySelectorAll("style")).map(s => s.textContent).join("\n");
        expect(styleText).toContain(":host");
        expect(styleText).not.toContain(":root");
    });

    it("configures keyboardCondition to suppress the 'f' fullscreen key", async () => {
        renderInto(<PresentationView {...makeProps()} />);
        await settle();
        const keyboardCondition = revealInstances[0]?.config.keyboardCondition;
        expect(keyboardCondition).toBeTypeOf("function");
        expect(keyboardCondition?.({ key: "f" })).toBe(false);
        expect(keyboardCondition?.({ key: "n" })).toBe(true);
    });

    it("syncs reveal after the presentation model changes", async () => {
        const root = renderInto(<PresentationView {...makeProps()} />);
        await settle();
        const reveal = revealInstances[0];
        const before = reveal?.syncCount ?? 0;

        buildPresentationModel.mockResolvedValue(makeModel([
            { ...HORIZONTAL_SLIDE, noteId: "s1", content: { __html: "<p>Updated</p>" } }
        ]));
        fireTrilium("entitiesReloaded", { loadResults: makeLoadResults({ noteIds: [ "s1" ] }) });
        await settle();
        void root;
        expect((reveal?.syncCount ?? 0)).toBeGreaterThan(before);
    });
});

describe("PresentationView refresh triggers", () => {
    it("rebuilds the model when a matching note id is reloaded", async () => {
        renderInto(<PresentationView {...makeProps()} />);
        await settle();
        const before = buildPresentationModel.mock.calls.length;

        fireTrilium("entitiesReloaded", { loadResults: makeLoadResults({ noteIds: [ "s1" ] }) });
        await settle();
        expect(buildPresentationModel.mock.calls.length).toBeGreaterThan(before);
    });

    it("rebuilds when a slide:* attribute change targets a slide note", async () => {
        renderInto(<PresentationView {...makeProps()} />);
        await settle();
        const before = buildPresentationModel.mock.calls.length;

        fireTrilium("entitiesReloaded", {
            loadResults: makeLoadResults({ attributeRows: [ { noteId: "s1", name: "slide:background" } ] })
        });
        await settle();
        expect(buildPresentationModel.mock.calls.length).toBeGreaterThan(before);
    });

    it("ignores entitiesReloaded events that do not touch the slides", async () => {
        renderInto(<PresentationView {...makeProps()} />);
        await settle();
        const before = buildPresentationModel.mock.calls.length;

        fireTrilium("entitiesReloaded", {
            loadResults: makeLoadResults({
                noteIds: [ "unrelated" ],
                attributeRows: [ { noteId: "unrelated", name: "label" }, { noteId: "s1", name: "color" } ]
            })
        });
        await settle();
        expect(buildPresentationModel.mock.calls.length).toBe(before);
    });
});

describe("PresentationView slide rendering", () => {
    it("wraps vertical slides in a section and renders each child slide", async () => {
        buildPresentationModel.mockResolvedValue(makeModel([
            {
                noteId: "top",
                type: "text" as const,
                content: { __html: "<p>Top</p>" },
                verticalSlides: [
                    { noteId: "v1", type: "text" as const, content: { __html: "<p>V1</p>" } },
                    { noteId: "v2", type: "text" as const, content: { __html: "<p>V2</p>" } }
                ]
            }
        ]));
        const root = renderInto(<PresentationView {...makeProps()} />);
        await settle();

        expect(root.querySelector("#slide-top")).not.toBeNull();
        expect(root.querySelector("#slide-v1")).not.toBeNull();
        expect(root.querySelector("#slide-v2")).not.toBeNull();
        const section = root.querySelector("#slide-top")?.parentElement;
        expect(section?.tagName).toBe("SECTION");
    });

    it("applies background gradient when present", async () => {
        buildPresentationModel.mockResolvedValue(makeModel([
            {
                noteId: "g1",
                type: "text" as const,
                content: { __html: "<p>G</p>" },
                backgroundGradient: "linear-gradient(red, blue)",
                verticalSlides: undefined
            }
        ]));
        const root = renderInto(<PresentationView {...makeProps({ noteIds: [ "g1" ] })} />);
        await settle();
        const slide = root.querySelector<HTMLElement>("#slide-g1");
        expect(slide?.getAttribute("data-background-gradient")).toBe("linear-gradient(red, blue)");
    });
});

describe("PresentationView print mode", () => {
    it("sets the print-pdf query parameter and returns bare content", async () => {
        const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
        const root = renderInto(<PresentationView {...makeProps({ media: "print" })} />);
        await settle();

        expect(root.querySelector(".presentation-view")).toBeNull();
        expect(root.querySelector("#slide-s1")).not.toBeNull();
        expect(replaceState).toHaveBeenCalled();
        const lastUrl = replaceState.mock.calls.at(-1)?.[2];
        expect(String(lastUrl)).toContain("print-pdf=");
    });
});

describe("ButtonOverlay", () => {
    async function renderScreen() {
        const root = renderInto(<PresentationView {...makeProps()} />);
        await settle();
        return root;
    }

    function overlayButtons(root: HTMLElement) {
        return root.querySelectorAll<HTMLButtonElement>(".collection-properties-stub button");
    }

    it("renders the three overlay action buttons", async () => {
        const root = await renderScreen();
        expect(overlayButtons(root).length).toBe(3);
    });

    it("edit button opens the slide note when a current slide has a note id", async () => {
        const root = await renderScreen();
        const reveal = revealInstances[0];
        const currentSlide = document.createElement("section");
        currentSlide.dataset.noteId = "slide-target";
        if (reveal) reveal.currentSlide = currentSlide;

        act(() => overlayButtons(root)[0]?.click());
        expect(openInCurrentNoteContext).toHaveBeenCalledWith(expect.anything(), "slide-target");
    });

    it("edit button is a no-op when the current slide has no note id", async () => {
        const root = await renderScreen();
        const reveal = revealInstances[0];
        if (reveal) reveal.currentSlide = document.createElement("section");
        act(() => overlayButtons(root)[0]?.click());
        expect(openInCurrentNoteContext).not.toHaveBeenCalled();
    });

    it("overview button toggles overview and reflects shown/hidden events", async () => {
        const root = await renderScreen();
        const reveal = revealInstances[0];

        act(() => overlayButtons(root)[1]?.click());
        expect(reveal?.overview).toBe(true);

        act(() => reveal?.emit("overviewshown"));
        expect(overlayButtons(root)[1]?.className).toContain("active");

        act(() => reveal?.emit("overviewhidden"));
        expect(overlayButtons(root)[1]?.className).not.toContain("active");
    });

    it("fullscreen button requests fullscreen on the container", async () => {
        const requestFullscreen = vi.fn();
        Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
            configurable: true,
            value: requestFullscreen
        });
        try {
            const root = await renderScreen();
            act(() => overlayButtons(root)[2]?.click());
            expect(requestFullscreen).toHaveBeenCalled();
        } finally {
            delete (HTMLElement.prototype as unknown as Record<string, unknown>).requestFullscreen;
        }
    });
});

describe("link rewiring", () => {
    it("wires reference links so clicks navigate via reveal indices", async () => {
        buildPresentationModel.mockResolvedValue(makeModel([
            {
                noteId: "withlink",
                type: "text" as const,
                content: { __html: `<a class="reference-link" href="http://x/#/slide-withlink">link</a>` },
                verticalSlides: undefined
            }
        ]));
        const root = renderInto(<PresentationView {...makeProps({ noteIds: [ "withlink" ] })} />);
        await settle();

        const reveal = revealInstances[0];
        const link = root.querySelector<HTMLAnchorElement>("a.reference-link");
        expect(link).not.toBeNull();
        act(() => link?.click());
        expect(reveal?.slideCalls.length).toBe(1);
        expect(reveal?.slideCalls[0]).toEqual([ 1, 2, 3 ]);
    });

    it("ignores reference-link clicks whose hash is not a slide", async () => {
        buildPresentationModel.mockResolvedValue(makeModel([
            {
                noteId: "extlink",
                type: "text" as const,
                content: { __html: `<a class="reference-link" href="http://x/#/other">link</a>` },
                verticalSlides: undefined
            }
        ]));
        const root = renderInto(<PresentationView {...makeProps({ noteIds: [ "extlink" ] })} />);
        await settle();

        const reveal = revealInstances[0];
        const link = root.querySelector<HTMLAnchorElement>("a.reference-link");
        act(() => link?.click());
        expect(reveal?.slideCalls.length).toBe(0);
    });
});
