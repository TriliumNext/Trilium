import type { NoteType } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapMock } from "../../test/mocks";
import { fakeNoteContext, renderComponent, resetFroca } from "../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// The real bootstrap Tooltip machinery does not behave under happy-dom; provide an inert stub.
vi.mock("bootstrap", () => bootstrapMock());

// i18next is never initialised in tests; return the key so structure renders.
vi.mock("../../services/i18n", () => ({
    t: (key: string) => key,
    getCurrentLanguage: () => "en"
}));

// react-i18next's <Trans> needs an initialised i18n instance and pulls a React copy that conflicts
// with preact — stub it but still render the interpolated `Value` component so it stays assertable.
vi.mock("react-i18next", () => ({
    Trans: ({ i18nKey, components }: { i18nKey?: string; components?: Record<string, unknown> }) => (
        <span class="trans-stub" data-i18n-key={i18nKey}>
            {(components?.Value as never) ?? null}
        </span>
    )
}));

// Child widgets call useNoteContext themselves and pull heavy dropdown/editor machinery; stub them
// so this spec exercises only InlineTitle's own structure and logic.
vi.mock("../note_icon", () => ({
    default: () => <div class="note-icon-stub" />
}));
vi.mock("../note_title", () => ({
    default: () => <div class="note-title-stub" />
}));

// useNoteMetadata fetches over the server; provide a controllable stub returning fixed metadata.
const { metadataRef } = vi.hoisted(() => ({
    metadataRef: { current: undefined as { dateCreated?: string; dateModified?: string } | undefined }
}));
vi.mock("../ribbon/NoteInfoTab", () => ({
    useNoteMetadata: () => ({ metadata: metadataRef.current })
}));

// Keep the real hooks (useNoteContext / useNoteProperty) but stub the bootstrap-tooltip hook.
vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useStaticTooltip: vi.fn()
}));

import type { CommandNames } from "../../components/app_context";
import Component from "../../components/component";
import { buildNote } from "../../test/easy-froca";
import InlineTitle, { NoteTitleDetails } from "./InlineTitle";

// --- IntersectionObserver fake --------------------------------------------------------------------

class FakeIntersectionObserver {
    static instances: FakeIntersectionObserver[] = [];
    callback: IntersectionObserverCallback;
    observed: Element[] = [];
    disconnected = false;
    constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        FakeIntersectionObserver.instances.push(this);
    }
    observe(el: Element) { this.observed.push(el); }
    unobserve() {}
    disconnect() { this.disconnected = true; }
    takeRecords(): IntersectionObserverEntry[] { return []; }
    trigger(isIntersecting: boolean) {
        this.callback([ { isIntersecting } as IntersectionObserverEntry ], this as unknown as IntersectionObserver);
    }
}

const originalIntersectionObserver = window.IntersectionObserver;

// --- Render harness -------------------------------------------------------------------------------

/**
 * A parent {@link Component} whose `$widget` lives inside a `.note-split` that also contains a direct
 * `.title-row` child — the structure InlineTitle's IntersectionObserver effect walks to.
 */
function makeParent({ withTitleRow = true, withSplit = true } = {}) {
    const parent = new Component();
    const split = document.createElement("div");
    if (withSplit) split.className = "note-split";
    const titleRow = document.createElement("div");
    titleRow.className = "title-row";
    const widgetEl = document.createElement("div");
    widgetEl.className = "react-widget";
    if (withTitleRow) split.appendChild(titleRow);
    split.appendChild(widgetEl);
    document.body.appendChild(split);
    parent.$widget = $(widgetEl);
    return { parent, split, titleRow, widgetEl };
}

beforeEach(() => {
    resetFroca();
    FakeIntersectionObserver.instances = [];
    metadataRef.current = undefined;
    Object.assign(window, { IntersectionObserver: FakeIntersectionObserver });
    vi.clearAllMocks();
});

afterEach(() => {
    document.querySelectorAll(".note-split").forEach((el) => el.remove());
    Object.assign(window, { IntersectionObserver: originalIntersectionObserver });
});

// --- shouldShow via the rendered container --------------------------------------------------------

describe("InlineTitle — visibility (shouldShow)", () => {
    function renderForNote(noteOverrides: Record<string, unknown>, ctxOverrides: Record<string, unknown> = {}) {
        const note = buildNote({ id: noteOverrides.id as string ?? "n", title: "T", type: (noteOverrides.type as NoteType) ?? "text" });
        Object.assign(note, noteOverrides);
        const { parent } = makeParent();
        const { container } = renderComponent(<InlineTitle />, { parent, noteContext: fakeNoteContext({ note, ...ctxOverrides }) });
        return { note, container };
    }

    it("shows for a supported text note in the default view", () => {
        const { container } = renderForNote({ id: "txt", type: "text" });
        const root = container.querySelector(".inline-title");
        expect(root).toBeTruthy();
        expect(root?.classList.contains("hidden")).toBe(false);
        // Child stubs are rendered inside the title row.
        expect(container.querySelector(".inline-title-row .note-icon-stub")).toBeTruthy();
        expect(container.querySelector(".note-title-caption .note-title-stub")).toBeTruthy();
    });

    it("shows for a code note", () => {
        const { container } = renderForNote({ id: "code", type: "code", mime: "text/plain" });
        expect(container.querySelector(".inline-title")?.classList.contains("hidden")).toBe(false);
    });

    it("hides for an unsupported note type", () => {
        const { container } = renderForNote({ id: "img", type: "image" });
        expect(container.querySelector(".inline-title")?.classList.contains("hidden")).toBe(true);
    });

    it("hides when the view mode is not the default", () => {
        const { container } = renderForNote({ id: "src", type: "text" }, { viewScope: { viewMode: "source" } });
        expect(container.querySelector(".inline-title")?.classList.contains("hidden")).toBe(true);
    });

    it("hides when there is no view scope at all", () => {
        const { container } = renderForNote({ id: "noscope", type: "text" }, { viewScope: undefined });
        expect(container.querySelector(".inline-title")?.classList.contains("hidden")).toBe(true);
    });

    it("always shows for an _options note regardless of type", () => {
        const { container } = renderForNote({ id: "_optionsAppearance", type: "image" });
        expect(container.querySelector(".inline-title")?.classList.contains("hidden")).toBe(false);
    });

    it("hides for a Trilium SQLite note", () => {
        const { container } = renderForNote({ id: "sql", type: "code", mime: "text/x-sqlite;schema=trilium" });
        expect(container.querySelector(".inline-title")?.classList.contains("hidden")).toBe(true);
    });

    it("hides for a Markdown code note", () => {
        const { container } = renderForNote({ id: "md", type: "code", mime: "text/markdown" });
        expect(container.querySelector(".inline-title")?.classList.contains("hidden")).toBe(true);
    });
});

// --- IntersectionObserver effect ------------------------------------------------------------------

describe("InlineTitle — title-row observer", () => {
    function renderShown() {
        const note = buildNote({ id: "obsNote", title: "T", type: "text" });
        const { parent, split, titleRow } = makeParent();
        const { container, unmount } = renderComponent(<InlineTitle />, { parent, noteContext: fakeNoteContext({ note }) });
        return { container, split, titleRow, unmount };
    }

    it("toggles hide-title on the sibling title-row and reacts to intersection", () => {
        const { container, titleRow } = renderShown();

        // The effect immediately hides the external title row and registers an observer.
        expect(titleRow.classList.contains("hide-title")).toBe(true);
        expect(FakeIntersectionObserver.instances.length).toBe(1);
        const observer = FakeIntersectionObserver.instances[0];
        expect(observer.observed.length).toBe(1);

        const innerRow = () => container.querySelector(".inline-title-row");

        // Not intersecting → external row stays hidden, inner row gets the "hidden" class.
        act(() => observer.trigger(false));
        expect(titleRow.classList.contains("hide-title")).toBe(false);
        expect(innerRow()?.classList.contains("hidden")).toBe(true);

        // Intersecting → external row hidden again, inner row visible.
        act(() => observer.trigger(true));
        expect(titleRow.classList.contains("hide-title")).toBe(true);
        expect(innerRow()?.classList.contains("hidden")).toBe(false);
    });

    it("cleans up the observer and restores the title-row on unmount", () => {
        const { titleRow, unmount } = renderShown();
        const observer = FakeIntersectionObserver.instances[0];
        expect(titleRow.classList.contains("hide-title")).toBe(true);

        unmount();

        expect(observer.disconnected).toBe(true);
        expect(titleRow.classList.contains("hide-title")).toBe(false);
    });

    it("does not register an observer when the note is hidden", () => {
        const note = buildNote({ id: "hiddenObs", title: "T", type: "image" });
        const { parent } = makeParent();
        renderComponent(<InlineTitle />, { parent, noteContext: fakeNoteContext({ note }) });
        expect(FakeIntersectionObserver.instances.length).toBe(0);
    });

    it("no-ops when the split has no sibling title-row", () => {
        const note = buildNote({ id: "noRow", title: "T", type: "text" });
        const { parent } = makeParent({ withTitleRow: false });
        renderComponent(<InlineTitle />, { parent, noteContext: fakeNoteContext({ note }) });
        // Effect bails before constructing an observer because the title-row query returns null.
        expect(FakeIntersectionObserver.instances.length).toBe(0);
    });
});

// --- NoteTitleDetails -----------------------------------------------------------------------------

describe("NoteTitleDetails", () => {
    function renderDetails(noteId: string) {
        const note = buildNote({ id: noteId, title: "T", type: "text" });
        const { parent } = makeParent();
        const { container } = renderComponent(<NoteTitleDetails />, { parent, noteContext: fakeNoteContext({ note }) });
        return container;
    }

    it("renders nothing when no metadata is available", () => {
        metadataRef.current = undefined;
        const container = renderDetails("d-empty");
        expect(container.querySelector(".title-details")).toBeNull();
    });

    it("renders created and modified items joined by a separator", () => {
        metadataRef.current = {
            dateCreated: "2024-01-01 10:00:00.000Z",
            dateModified: "2024-02-02 11:00:00.000Z"
        };
        const container = renderDetails("d-both");
        const details = container.querySelector(".title-details");
        expect(details).toBeTruthy();
        // Two <li> entries (created + modified), each carrying a value span.
        expect(details?.querySelectorAll("li").length).toBe(2);
        expect(details?.querySelectorAll("span.value").length).toBe(2);
        // The bullet separator between the two items is present in text content.
        expect(details?.textContent).toContain("•");
        // i18n keys flow through the stubbed <Trans>.
        const keys = Array.from(details?.querySelectorAll(".trans-stub") ?? []).map((el) => el.getAttribute("data-i18n-key"));
        expect(keys).toEqual([ "note_title.created_on", "note_title.last_modified" ]);
    });

    it("renders only the created item when modified is missing", () => {
        metadataRef.current = { dateCreated: "2024-01-01 10:00:00.000Z" };
        const container = renderDetails("d-created");
        const details = container.querySelector(".title-details");
        expect(details?.querySelectorAll("li").length).toBe(1);
        expect(details?.textContent).not.toContain("•");
    });

    it("suppresses date items for hidden (underscore-prefixed) notes", () => {
        metadataRef.current = {
            dateCreated: "2024-01-01 10:00:00.000Z",
            dateModified: "2024-02-02 11:00:00.000Z"
        };
        const container = renderDetails("_hiddenNote");
        expect(container.querySelector(".title-details")).toBeNull();
    });
});
