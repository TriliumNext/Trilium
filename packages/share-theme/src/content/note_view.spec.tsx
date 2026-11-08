// @vitest-environment happy-dom
import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppPayload, HostedApp } from "./app_host.js";
import mountNoteView from "./note_view.js";

const mocks = vi.hoisted(() => ({
    loadCodeView: vi.fn(),
    useNoteBlob: vi.fn(),
    openNote: vi.fn(),
    drawMermaid: vi.fn(),
    noteMap: vi.fn(() => null),
    relationMap: vi.fn(() => null)
}));

// The real modules reach `window.glob`, which only the app's boot script defines.
vi.mock("@triliumnext/client/src/services/i18n.js", () => ({ t: (key: string) => key }));
vi.mock("@triliumnext/client/src/services/image_urls.js", () => ({
    getNoteImageUrl: (noteId: string, title: string, blobId: string) =>
        `api/images/${noteId}/${title}?${blobId}`
}));
vi.mock("@triliumnext/client/src/widgets/react/hooks.js", () => ({
    useNoteBlob: mocks.useNoteBlob
}));
vi.mock("@triliumnext/client/src/widgets/react/RawHtml.js", () => ({
    RawHtmlBlock: ({ className, html }: { className: string; html: string }) =>
        <div className={className} data-html={html} />
}));
vi.mock("@triliumnext/client/src/widgets/note_types.js", () => ({
    TYPE_MAPPINGS: { code: { view: mocks.loadCodeView, className: "note-detail-code" } }
}));
vi.mock("@triliumnext/client/src/widgets/note_map/NoteMap.js", () => ({ default: mocks.noteMap }));
vi.mock("@triliumnext/client/src/widgets/type_widgets/relation_map/RelationMap.js", () => ({
    default: mocks.relationMap
}));
vi.mock("mermaid", () => ({ default: {} }));
vi.mock("./mermaid.js", () => ({
    loadMermaid: async () => ({}),
    drawMermaid: mocks.drawMermaid,
    readMermaidTheme: () => document.documentElement.className || "default"
}));
vi.mock("./zoom_viewer.js", () => ({
    ZoomViewer: ({ label, children }: { label: string; children?: ComponentChildren }) =>
        <div className="zoom-viewer" aria-label={label}>{children}</div>
}));
vi.mock("./app_host.js", () => ({
    default: ({ noteId, payload, children }: {
        noteId: string;
        payload: AppPayload;
        children(app: HostedApp): ComponentChildren;
    }) => children({
        note: payload.notes.find((note) => note.noteId === noteId),
        parentNoteId: "parent",
        openNote: mocks.openNote
    } as unknown as HostedApp)
}));

const containers: HTMLElement[] = [];

describe("mountNoteView", () => {
    afterEach(() => {
        for (const container of containers.splice(0)) {
            act(() => render(null, container));
        }
        document.body.replaceChildren();
        document.documentElement.className = "";
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    it("replaces the rendered content with the note's widget once the widget loads", async () => {
        mocks.loadCodeView.mockResolvedValue({ default: () => <p className="widget">Widget</p> });
        const container = buildContainer("code");

        await act(() => mountNoteView(container, buildPayload("code")));

        expect(container.querySelector(".note-detail-code > p.widget")?.textContent).toBe("Widget");
        expect(container.querySelector("p.fallback")).toBeNull();

        // A widget module can be the component itself.
        mocks.loadCodeView.mockResolvedValue(() => <p className="bare">Bare</p>);
        await act(() => mountNoteView(container, buildPayload("code")));
        expect(container.querySelector(".note-detail-code > p.bare")).not.toBeNull();
    });

    it("keeps the rendered content when the widget fails to load or no note is named", async () => {
        mocks.loadCodeView.mockRejectedValue(
            new Error("Failed to fetch dynamically imported module"));
        const container = buildContainer("code");

        await act(async () => {
            await expect(mountNoteView(container, buildPayload("code")))
                .rejects.toThrow("Failed to fetch");
        });
        delete container.dataset.noteId;
        await act(async () => {
            await expect(mountNoteView(container, buildPayload("code"))).rejects.toThrow();
        });

        expect(container.querySelector("p.fallback")?.textContent).toBe("Rendered");
        expect(container.querySelector(".note-detail-code")).toBeNull();
    });

    it("shows an image, a canvas or a mind map in the pan and zoom viewer", async () => {
        for (const type of [ "image", "canvas", "mindMap" ]) {
            const container = buildContainer(type);

            await act(() => mountNoteView(container, buildPayload(type)));

            const image = container.querySelector(".zoom-viewer img");
            expect(image?.getAttribute("src"), type).toBe(`api/images/${type}Note/Title?blob`);
            expect(image?.getAttribute("alt")).toBe("Title");
        }
    });

    it("draws a Mermaid note, again when the theme changes, and not once unmounted", async () => {
        mocks.useNoteBlob.mockReturnValue({ content: "graph TD; A-->B" });
        mocks.drawMermaid.mockImplementation(
            async (_mermaid, source, theme) => `<svg>${source} ${theme}</svg>`);
        const container = buildContainer("mermaid");

        await act(() => mountNoteView(container, buildPayload("mermaid")));
        const drawn = () => container.querySelector(".mermaid")?.getAttribute("data-html");
        await vi.waitFor(() => expect(drawn()).toBe("<svg>graph TD; A-->B default</svg>"));

        await act(async () => { document.documentElement.className = "dark"; });
        await vi.waitFor(() => expect(drawn()).toBe("<svg>graph TD; A-->B dark</svg>"));

        let finishDrawing = (_svg: string) => {};
        mocks.drawMermaid.mockReturnValue(new Promise((resolve) => { finishDrawing = resolve; }));
        await act(async () => { document.documentElement.className = "light"; });
        act(() => render(null, container));
        finishDrawing("<svg>late</svg>");
        expect(mocks.drawMermaid).toHaveBeenLastCalledWith({}, "graph TD; A-->B", "light");
    });

    it("draws nothing for a Mermaid note without content and logs a failed drawing", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.useNoteBlob.mockReturnValue(null);
        const container = buildContainer("mermaid");

        await act(() => mountNoteView(container, buildPayload("mermaid")));
        expect(mocks.drawMermaid).not.toHaveBeenCalled();

        mocks.useNoteBlob.mockReturnValue({ content: "graph TD; broken" });
        mocks.drawMermaid.mockRejectedValue(new Error("Parse error"));
        await act(() => mountNoteView(buildContainer("mermaid"), buildPayload("mermaid")));

        await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(new Error("Parse error")));
        expect(container.querySelector(".mermaid")).toBeNull();
    });

    it("draws a note map and a relation map, opening notes on their pages", async () => {
        await act(() => mountNoteView(buildContainer("noteMap"), buildPayload("noteMap")));
        await act(() => mountNoteView(buildContainer("relationMap"), buildPayload("relationMap")));

        expect(mocks.noteMap).toHaveBeenCalledWith(expect.objectContaining({
            note: expect.objectContaining({ noteId: "noteMapNote" }),
            widgetMode: "type",
            defaultRootNoteId: "parent",
            onOpenNote: mocks.openNote
        }), expect.anything());
        expect(mocks.relationMap).toHaveBeenCalledWith(expect.objectContaining({
            note: expect.objectContaining({ noteId: "relationMapNote" }),
            onOpenNote: mocks.openNote
        }), expect.anything());
        expect(document.querySelector(".note-detail-note-map")).not.toBeNull();
        expect(document.querySelector(".note-detail-relation-map")).not.toBeNull();
    });
});

function buildContainer(type: string) {
    const container = document.createElement("div");
    container.dataset.noteId = `${type}Note`;
    container.innerHTML = `<p class="fallback">Rendered</p>`;
    document.body.append(container);
    containers.push(container);
    return container;
}

function buildPayload(type: string) {
    return {
        notes: [ { noteId: `${type}Note`, type, title: "Title", blobId: "blob" } ],
        branches: [],
        attributes: [],
        links: {},
        options: {},
        assetPath: "",
        parentNoteId: null
    } as unknown as AppPayload;
}
