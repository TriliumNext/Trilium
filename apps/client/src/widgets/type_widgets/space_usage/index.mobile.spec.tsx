import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SpaceUsageSelection } from "./selection";

/**
 * The page reads `isMobile()` once, when the module loads, so what a phone gets is decided by the
 * mock below rather than by anything a test can do afterwards. Hence a file of its own: the pointer
 * behaviour is what `index.spec.tsx` covers.
 */
const mocks = vi.hoisted(() => ({
    overview: undefined as unknown,
    /** The page hands these to whichever view is on show; the stubs keep the last set. */
    select: undefined as ((selection: SpaceUsageSelection) => void) | undefined,
    selectedMarkId: undefined as string | undefined,
    browseSelection: undefined as SpaceUsageSelection | null | undefined,
    showDetails: undefined as ((notePath: string[]) => void) | undefined
}));

vi.mock("../../../services/utils", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/utils")>(),
    isMobile: () => true
}));

vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key
}));

// The strip is measured with a ResizeObserver, which happy-dom does not provide; the page only
// wants the height to leave the map room for it, so a fixed one stands in.
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../react/hooks")>(),
    useElementSize: () => ({ height: 48 })
}));

vi.mock("../../react/use_fetch", () => ({
    useFetch: () => ({ data: mocks.overview, failed: false, loading: false })
}));

vi.mock("../../../services/froca", () => ({
    default: {
        getNotes: async (noteIds: string[]) => noteIds.map((noteId) => ({ noteId, title: `title:${noteId}` }))
    }
}));

vi.mock("./overview", () => ({
    default: ({ selectedMarkId, onSelect, onShowDetails }: {
        selectedMarkId?: string,
        onSelect?: (selection: SpaceUsageSelection) => void,
        onShowDetails: (notePath: string[]) => void
    }) => {
        mocks.select = onSelect;
        mocks.selectedMarkId = selectedMarkId;
        mocks.showDetails = onShowDetails;
        return <div className="overview-stub" />;
    }
}));

vi.mock("./browse", () => ({
    default: ({ selection, onSelect }: {
        selection?: SpaceUsageSelection | null,
        onSelect?: (selection: SpaceUsageSelection) => void
    }) => {
        mocks.select = onSelect;
        mocks.browseSelection = selection;
        return <div className="browse-stub" />;
    }
}));

import SpaceUsage from "./index";

const OVERVIEW: SpaceUsageOverviewResponse = {
    content: { size: 4000, noteCount: 12, attachmentsSize: 300, revisionsSize: 200 },
    notes: [],
    otherNotes: { size: 0, revisionsSize: 0, noteCount: 0 },
    hiddenNotes: { size: 0, revisionsSize: 0, noteCount: 0 },
    deletedNotes: { size: 900, noteCount: 3, attachmentCount: 2 },
    unusedAttachments: { size: 0, attachmentCount: 0 },
    total: { size: 3500, revisionsSize: 0, noteCount: 12 }
};

let container: HTMLDivElement | undefined;

function renderPage() {
    mocks.overview = OVERVIEW;
    container = document.body.appendChild(document.createElement("div"));
    render(<SpaceUsage />, container);
    return container;
}

/** State set from a handler renders on a microtask. */
function flushRender() {
    return new Promise((resolve) => setTimeout(resolve));
}

/**
 * Effects flush on an animation frame, so the page's own mount effects have to land before a tap is
 * simulated: one of them lets the selection go whenever the ground under it moves, and arriving late
 * it would let go of a mark chosen a moment earlier. In a browser it has long since run.
 */
function flushEffects() {
    return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
}

function selectionOf(markId: string, onOpen?: () => void): SpaceUsageSelection {
    return { markId, notePath: [ "root", markId ], size: 10, onOpen };
}

function stripTexts(probe: HTMLElement) {
    return {
        hint: probe.querySelector(".space-usage-selection-hint")?.textContent,
        name: probe.querySelector(".space-usage-selection-name")?.textContent
    };
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    mocks.overview = undefined;
    mocks.select = undefined;
    mocks.selectedMarkId = undefined;
    mocks.browseSelection = undefined;
});

describe("SpaceUsage page on a phone", () => {
    it("draws the totals as a grid of figures rather than as the status line", () => {
        const probe = renderPage();
        const figures = [ ...probe.querySelectorAll(".space-usage-status-value") ].map((el) => el.textContent);

        expect(probe.querySelector(".space-usage-status")).toBeNull();
        // Notes, total, attachments, deleted items, in that order.
        expect(figures).toEqual([ "12", "3.91 KiB", "300 B", "900 B" ]);
    });

    it("keeps the strip on show from the start, saying what to do until something is chosen", async () => {
        const probe = renderPage();

        await flushEffects();

        expect(stripTexts(probe).hint).toBe("space_usage.selection_hint");

        mocks.select?.(selectionOf("n1"));
        await flushRender();

        expect(stripTexts(probe).hint).toBeUndefined();
        await vi.waitFor(() => expect(stripTexts(probe).name).toBe("title:n1"));
        expect(mocks.selectedMarkId).toBe("n1");
    });

    it("opens the chosen mark on a second tap, and lets go of one with nothing to open", async () => {
        const open = vi.fn();
        const probe = renderPage();

        await flushEffects();
        mocks.select?.(selectionOf("n1", open));
        await flushRender();
        mocks.select?.(selectionOf("n1", open));
        await flushRender();

        // Still chosen, and opened rather than let go of.
        expect(open).toHaveBeenCalledTimes(1);
        expect(mocks.selectedMarkId).toBe("n1");

        mocks.select?.(selectionOf("bucket"));
        await flushRender();
        mocks.select?.(selectionOf("bucket"));
        await flushRender();

        expect(mocks.selectedMarkId).toBeUndefined();
        expect(stripTexts(probe).hint).toBe("space_usage.selection_hint");
    });

    it("lets the selection go when the ground under it moves", async () => {
        const probe = renderPage();

        await flushEffects();
        mocks.select?.(selectionOf("n1"));
        await flushRender();
        expect(mocks.selectedMarkId).toBe("n1");

        // "Show details" switches the view and walks Browse to that note: the mark it named is not
        // on the chart that follows.
        mocks.showDetails?.([ "root", "p1", "n1" ]);
        await flushRender();

        expect(probe.querySelector(".browse-stub")).not.toBeNull();
        expect(mocks.browseSelection ?? null).toBeNull();
        expect(stripTexts(probe).hint).toBe("space_usage.selection_hint");
    });

    it("asks for a fresh reading and drops the selection when refresh is pressed", async () => {
        const probe = renderPage();

        await flushEffects();
        mocks.select?.(selectionOf("n1"));
        await flushRender();
        expect(mocks.selectedMarkId).toBe("n1");

        probe.querySelector<HTMLElement>(".space-usage-refresh")?.click();
        await flushEffects();

        expect(stripTexts(probe).hint).toBe("space_usage.selection_hint");
    });
});
