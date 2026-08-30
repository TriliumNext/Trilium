import type { SpaceUsageNoteResponse } from "@triliumnext/commons";
import { type ComponentChildren, render } from "preact";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DonutRing } from "../../react/charts/DonutChart";
import type { UsageSegmentData } from "./donut_segments";

interface CapturedDonutProps {
    usage: SpaceUsageNoteResponse;
    title: string;
    notePath: string[];
    outerRings: DonutRing<UsageSegmentData>[];
    selectedSegmentId?: string;
    centerActions: ComponentChildren;
    onTitleContextMenu: (event: MouseEvent) => void;
}

const mocks = vi.hoisted(() => ({
    usage: undefined as unknown,
    failed: false,
    loading: false,
    fetchedUrls: [] as string[],
    donutProps: undefined as unknown,
    openContextMenu: vi.fn(),
    contentChanged: vi.fn(),
    loadingChange: vi.fn(),
    select: vi.fn(),
    pathChanged: vi.fn()
}));

vi.mock("./context_menu", () => ({
    openSpaceUsageContextMenu: (...args: unknown[]) => mocks.openContextMenu(...args)
}));

vi.mock("../../react/use_fetch", () => ({
    useFetch: (url: string) => {
        mocks.fetchedUrls.push(url);
        return { data: mocks.usage, failed: mocks.failed, loading: mocks.loading };
    }
}));

// The donut is covered by its own spec; here it captures its props and renders the center actions
// so the back button is reachable.
vi.mock("./note_usage_donut", () => ({
    default: (props: CapturedDonutProps) => {
        mocks.donutProps = props;
        return <div className="donut-stub">{props.centerActions}</div>;
    },
    segmentTooltip: (kind: string, title: string, size: number) => `${kind}:${title}:${size}`
}));

vi.mock("../../react/ActionButton", () => ({
    default: ({ className, disabled, onClick }: { className?: string, disabled?: boolean, onClick?: () => void }) => (
        <button type="button" className={`back-stub ${className ?? ""}`} disabled={disabled} onClick={onClick} />
    )
}));

// Uninitialized, the real `t` answers undefined for every key — which would leave the two figures
// closing the ring unnamed, and a mark with no name is one the strip has nothing to say about.
vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key
}));

vi.mock("../../../services/froca", () => ({
    default: {
        getNotes: async (noteIds: string[]) => noteIds.map((noteId) => ({ noteId, title: `title:${noteId}` }))
    }
}));

import Browse from "./browse";
import type { SpaceUsageSelection } from "./selection";

function usageOf(noteId: string, children: string[]): SpaceUsageNoteResponse {
    return {
        noteId,
        ownSize: 10,
        attachmentsSize: 0,
        revisionsSize: 0,
        subtreeRevisionsContentSize: 0,
        noteContentSize: 10,
        subtreeContentSize: 100,
        attachments: [],
        children: children.map((childId) => ({
            noteId: childId,
            subtreeSize: 40,
            subtreeNoteCount: 2
        }))
    };
}

let container: HTMLDivElement | undefined;

/** The path is owned by the section in the app; here a minimal host stands in for it. */
function BrowseHost() {
    const [ path, setPath ] = useState([ "root" ]);

    // The refresh token never changes here: navigation is what this spec is about.
    return (
        <Browse
            path={path}
            onPathChange={setPath}
            refreshToken={0}
            onContentChanged={mocks.contentChanged}
            onLoadingChange={mocks.loadingChange}
        />
    );
}

function renderBrowse() {
    container = document.body.appendChild(document.createElement("div"));
    render(<BrowseHost />, container);
    return container;
}

function donutProps() {
    return mocks.donutProps as CapturedDonutProps;
}

/** The children ring is the outer one; its segments are what a tap in this view lands on. */
function childSegment(id: string) {
    const ring = donutProps().outerRings[0];
    const segment = ring?.segments.find((candidate) => candidate.id === id);

    if (!ring || !segment) {
        throw new Error(`no segment ${id} on the children ring`);
    }

    ring.onSegmentClick?.(segment);
}

function lastSelection(): SpaceUsageSelection {
    return mocks.select.mock.calls[mocks.select.mock.calls.length - 1]?.[0] as SpaceUsageSelection;
}

/** How the page renders this view on a phone: a tap names a segment rather than descending into it. */
function renderSelectableBrowse(selection?: SpaceUsageSelection) {
    container = document.body.appendChild(document.createElement("div"));
    render(
        <Browse
            path={[ "root" ]}
            onPathChange={mocks.pathChanged}
            refreshToken={0}
            onContentChanged={mocks.contentChanged}
            selection={selection ?? null}
            onSelect={mocks.select}
            onLoadingChange={mocks.loadingChange}
        />,
        container
    );
    return container;
}

/** State set in event handlers and froca's async titles both land on later ticks. */
function flushRender() {
    return new Promise((resolve) => setTimeout(resolve));
}

function crumbTexts(probe: HTMLElement) {
    return [ ...probe.querySelectorAll(".space-usage-crumb") ].map((crumb) => crumb.textContent);
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    mocks.usage = undefined;
    mocks.failed = false;
    mocks.fetchedUrls = [];
    mocks.donutProps = undefined;
    mocks.openContextMenu.mockClear();
    mocks.select.mockClear();
    mocks.pathChanged.mockClear();
});

describe("Browse", () => {
    it("shows the loading state until the usage arrives", () => {
        mocks.usage = undefined;
        const probe = renderBrowse();

        expect(probe.querySelector(".space-usage-loading")).not.toBeNull();
        expect(probe.querySelector(".donut-stub")).toBeNull();
        expect(mocks.fetchedUrls).toEqual([ "space-usage/note/root" ]);
    });

    it("says so when the note's usage could not be measured, rather than measuring on", () => {
        mocks.usage = undefined;
        mocks.failed = true;
        const probe = renderBrowse();

        expect(probe.querySelector(".space-usage-loading")).toBeNull();
        expect(probe.querySelector(".no-items")).not.toBeNull();
        // The breadcrumb still stands, so the user can climb back out of a note that would not load.
        expect(probe.querySelector(".space-usage-breadcrumb")).not.toBeNull();
    });

    it("renders the donut for the root with its children ring and resolved titles", async () => {
        mocks.usage = usageOf("root", [ "child1" ]);
        const probe = renderBrowse();
        // The titles arrive via an effect, which Preact schedules a frame later than state updates.
        await vi.waitFor(() => expect(donutProps().title).toBe("title:root"));
        expect(donutProps().notePath).toEqual([ "root" ]);
        expect(crumbTexts(probe)).toEqual([ "title:root" ]);

        const ring = donutProps().outerRings[0];
        expect(ring.segments[0]).toMatchObject({
            data: { noteId: "child1" },
            tooltip: "child:title:child1:40"
        });

        // Nowhere to go back to from the root.
        expect(probe.querySelector<HTMLButtonElement>(".back-stub")?.disabled).toBe(true);
    });

    it("consolidates the children too small to see into one counted segment", async () => {
        mocks.usage = {
            ...usageOf("root", []),
            children: [
                { noteId: "big", subtreeSize: 100000, subtreeNoteCount: 1 },
                { noteId: "sliver", subtreeSize: 1, subtreeNoteCount: 1 }
            ]
        };
        renderBrowse();

        await vi.waitFor(() => expect(donutProps().outerRings[0].segments).toHaveLength(2));
        // The sliver is folded away rather than drawn as an invisible arc, and the bucket that
        // replaces it stands for a crowd, so it navigates nowhere.
        expect(donutProps().outerRings[0].segments[1]).toMatchObject({ id: "others", data: {} });
    });

    it("descends into a clicked child, then navigates back via button and breadcrumb", async () => {
        mocks.usage = usageOf("root", [ "child1" ]);
        const probe = renderBrowse();
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root" ]));

        donutProps().outerRings[0].onSegmentClick?.({ id: "child/child1", value: 40, data: { noteId: "child1" } });
        await flushRender();

        expect(mocks.fetchedUrls).toContain("space-usage/note/child1");
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root", "title:child1" ]));

        const back = probe.querySelector<HTMLButtonElement>(".back-stub");
        expect(back?.disabled).toBe(false);
        back?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root" ]));

        // Descend twice, then jump straight home through the first crumb.
        donutProps().outerRings[0].onSegmentClick?.({ id: "child/child1", value: 40, data: { noteId: "child1" } });
        await flushRender();
        donutProps().outerRings[0].onSegmentClick?.({ id: "child/child2", value: 40, data: { noteId: "child2" } });
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root", "title:child1", "title:child2" ]));

        probe.querySelector<HTMLButtonElement>("button.space-usage-crumb")
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root" ]));
    });

    it("ignores clicks on segments that name no note, like the deleted bucket", async () => {
        mocks.usage = usageOf("root", [ "child1" ]);
        const probe = renderBrowse();
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root" ]));

        donutProps().outerRings[0].onSegmentClick?.({ id: "/deleted-notes", value: 5, data: {} });
        await flushRender();

        expect(crumbTexts(probe)).toEqual([ "title:root" ]);
    });

    it("opens the shared menu on a child's own path and on the current note, descending on show-details", async () => {
        mocks.usage = usageOf("root", [ "child1" ]);
        const probe = renderBrowse();
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root" ]));

        const event = new MouseEvent("contextmenu");
        const ring = donutProps().outerRings[0];
        ring.onSegmentContextMenu?.({ id: "child/child1", value: 40, data: { noteId: "child1" } }, event);
        expect(mocks.openContextMenu).toHaveBeenCalledWith(
            event, [ "root", "child1" ], expect.any(Function), mocks.contentChanged);

        donutProps().onTitleContextMenu(event);
        expect(mocks.openContextMenu).toHaveBeenLastCalledWith(
            event, [ "root" ], expect.any(Function), mocks.contentChanged);

        // Showing a note's details from within Browse is this view's own descent.
        mocks.openContextMenu.mock.calls[0][2]([ "root", "child1" ]);
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root", "title:child1" ]));

        // A segment naming no note has nothing to offer.
        mocks.openContextMenu.mockClear();
        ring.onSegmentContextMenu?.({ id: "/deleted-notes", value: 5, data: {} }, event);
        expect(mocks.openContextMenu).not.toHaveBeenCalled();
    });
    it("names a tapped child for the strip instead of descending, keeping both actions on it", () => {
        mocks.usage = usageOf("root", [ "child1" ]);
        renderSelectableBrowse();

        childSegment("child/child1");

        const selection = lastSelection();

        expect(selection).toMatchObject({ markId: "child/child1", notePath: [ "root", "child1" ], size: 40 });
        expect(mocks.pathChanged).not.toHaveBeenCalled();

        // A second tap on the same segment is what walks in; the strip raises the menu instead.
        selection.onOpen?.();
        expect(mocks.pathChanged).toHaveBeenCalledWith([ "root", "child1" ]);

        selection.onActivate?.(new MouseEvent("click"));
        expect(mocks.openContextMenu).toHaveBeenCalledWith(
            expect.anything(), [ "root", "child1" ], mocks.pathChanged, mocks.contentChanged);
    });

    it("names the two figures closing the ring, which stand for no note and open nothing", () => {
        mocks.usage = {
            ...usageOf("root", [ "child1" ]),
            subtreeRevisionsContentSize: 500,
            deletedNotes: { size: 300, noteCount: 1, attachmentCount: 0 }
        };
        renderSelectableBrowse();

        childSegment("revisions");
        expect(lastSelection()).toMatchObject({ markId: "revisions", size: 500 });
        expect(lastSelection().notePath).toBeUndefined();
        expect(lastSelection().onOpen).toBeUndefined();
        expect(lastSelection().onActivate).toBeUndefined();

        childSegment("/deleted-notes");
        expect(lastSelection()).toMatchObject({ markId: "/deleted-notes", size: 300 });

    });

    it("names nothing for the bucket standing for several children at once", () => {
        mocks.usage = {
            ...usageOf("root", []),
            children: [
                { noteId: "big", subtreeSize: 100000, subtreeNoteCount: 1 },
                { noteId: "sliver", subtreeSize: 1, subtreeNoteCount: 1 }
            ]
        };
        renderSelectableBrowse();

        childSegment("others");

        expect(mocks.select).not.toHaveBeenCalled();
    });

    it("offers the chosen mark's own action as a line under the chart, and none without one", () => {
        mocks.usage = usageOf("root", [ "child1" ]);
        const open = vi.fn();
        const probe = renderSelectableBrowse({ markId: "child/child1", notePath: [ "root", "child1" ], size: 40, onOpen: open });

        probe.querySelector<HTMLElement>(".space-usage-details-link")?.click();
        expect(open).toHaveBeenCalledTimes(1);

        // With nothing to open it stands there hidden rather than leaving, so the chart above keeps
        // the height it was laid out with.
        render(null, probe);
        const empty = renderSelectableBrowse({ markId: "revisions", label: "Revisions", size: 10 });
        const idle = empty.querySelector(".space-usage-details-link");

        expect(idle).not.toBeNull();
        expect(idle?.classList.contains("space-usage-details-link-idle")).toBe(true);

        idle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(open).toHaveBeenCalledTimes(1);
    });

    it("hands the chosen mark to the donut, so the ring can draw it", () => {
        mocks.usage = usageOf("root", [ "child1" ]);
        renderSelectableBrowse({ markId: "child/child1", notePath: [ "root", "child1" ], size: 40 });

        expect(donutProps().selectedSegmentId).toBe("child/child1");
    });
});
