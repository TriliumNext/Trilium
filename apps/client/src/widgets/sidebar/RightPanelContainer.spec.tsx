import { NoteType } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Replace the heavy children with light stubs that render an identifiable marker so we can
// assert ordering/inclusion without pulling in CKEditor / PDF.js / LLM chat.
vi.mock("./TableOfContents", () => ({ default: () => <div data-widget="toc" /> }));
vi.mock("./pdf/PdfPages", () => ({ default: () => <div data-widget="pdf-pages" /> }));
vi.mock("./pdf/PdfAttachments", () => ({ default: () => <div data-widget="pdf-attachments" /> }));
vi.mock("./pdf/PdfLayers", () => ({ default: () => <div data-widget="pdf-layers" /> }));
vi.mock("./pdf/PdfAnnotations", () => ({ default: () => <div data-widget="pdf-annotations" /> }));
vi.mock("./HighlightsList", () => ({ default: () => <div data-widget="highlights" /> }));
vi.mock("./SidebarChat", () => ({ default: () => <div data-widget="chat" /> }));
// Keep RightPanelWidget light but render its children so the CustomWidgetContent path executes.
// Also surface each contextMenuItem handler as a clickable button so its handler can be exercised.
vi.mock("./RightPanelWidget", () => ({
    default: ({ id, children, contextMenuItems }: {
        id: string;
        children: unknown;
        contextMenuItems?: { handler: () => void }[];
    }) => (
        <div data-widget="legacy" data-id={id}>
            {(contextMenuItems ?? []).map((item, i) => (
                <button key={i} class="ctx-menu-item" onClick={() => item.handler()} />
            ))}
            {children}
        </div>
    )
}));
vi.mock("../../services/experimental_features", () => ({
    isExperimentalFeatureEnabled: vi.fn(() => false)
}));
vi.mock("@triliumnext/split.js", () => {
    const Split = vi.fn(() => ({ destroy: vi.fn() }));
    return { default: Split };
});

import appContext from "../../components/app_context";
import Component from "../../components/component";
import type NoteContext from "../../components/note_context";
import { isExperimentalFeatureEnabled } from "../../services/experimental_features";
import options from "../../services/options";
import Split from "@triliumnext/split.js";
import { buildNote } from "../../test/easy-froca";
import { fakeNoteContext, renderComponent, resetFroca, type RenderResult } from "../../test/render";
import LegacyRightPanelWidget from "../right_panel_widget";
import RightPanelContainer from "./RightPanelContainer";
import type { WidgetsByParent } from "../../services/bundle";

// --- Helpers -------------------------------------------------------------------------------------

let parent: Component;

function makeWidgetsByParent(overrides: Partial<{
    legacy: LegacyRightPanelWidget[];
    preact: { render: () => unknown; position?: number }[];
}> = {}): WidgetsByParent {
    return {
        getLegacyWidgets: () => overrides.legacy ?? [],
        getPreactWidgets: () => overrides.preact ?? []
    } as unknown as WidgetsByParent;
}

function setActiveNote(noteDef: { id: string; type?: NoteType; mime?: string } | null) {
    let noteContext: NoteContext | null = null;
    if (noteDef) {
        const note = buildNote({ id: noteDef.id, title: noteDef.id, type: noteDef.type ?? "text" });
        if (noteDef.mime) {
            note.mime = noteDef.mime;
        }
        noteContext = fakeNoteContext({
            note,
            notePath: `root/${noteDef.id}`,
            viewScope: { viewMode: "default" }
        });
    }
    Object.assign(appContext, { tabManager: { getActiveContext: () => noteContext } });
    return noteContext;
}

function renderContainer(widgetsByParent: WidgetsByParent, noteContext: NoteContext | null): RenderResult {
    return renderComponent(
        <RightPanelContainer widgetsByParent={widgetsByParent} />,
        { parent, noteContext }
    );
}

function widgetMarkers(root: HTMLElement) {
    return Array.from(root.querySelectorAll<HTMLElement>("[data-widget]")).map(el => el.getAttribute("data-widget"));
}

// `highlightsList` is read unconditionally via useTriliumOptionJson, which JSON.parses the raw
// value — so every test needs a valid-JSON default unless it overrides it.
const BASE_OPTIONS = { highlightsList: JSON.stringify([]) };

beforeEach(() => {
    parent = new Component();
    options.load({ ...BASE_OPTIONS });
    (window as unknown as { glob: Record<string, unknown> }).glob.isRtl = false;
    resetFroca();
    vi.clearAllMocks();
    (isExperimentalFeatureEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

// --- Tests ---------------------------------------------------------------------------------------

describe("RightPanelContainer", () => {
    it("renders an empty right pane when rightPaneVisible is false", () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "false" });
        const noteContext = setActiveNote({ id: "n1", type: "text" });
        const { container: root } = renderContainer(makeWidgetsByParent(), noteContext);

        const pane = root.querySelector("#right-pane");
        expect(pane).toBeTruthy();
        expect(widgetMarkers(root)).toEqual([]);
        // Split is only created while visible.
        expect(Split).not.toHaveBeenCalled();
    });

    it("shows the NoItems placeholder (with toggle button) when visible but no items match", () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "true", rightPaneWidth: "20" });
        // A code (non-markdown) note enables none of the built-in panels.
        const noteContext = setActiveNote({ id: "code1", type: "code", mime: "text/plain" });
        const { container: root } = renderContainer(makeWidgetsByParent(), noteContext);

        expect(widgetMarkers(root)).toEqual([]);
        // The placeholder renders a button wired to the toggle command.
        const button = root.querySelector("button[data-trigger-command='toggleRightPane']");
        expect(button).toBeTruthy();
        // Split is created with the configured width.
        expect(Split).toHaveBeenCalledTimes(1);
    });

    it("shows the table of contents for a text note", () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "true" });
        const noteContext = setActiveNote({ id: "text1", type: "text" });
        const { container: root } = renderContainer(makeWidgetsByParent(), noteContext);
        expect(widgetMarkers(root)).toContain("toc");
        expect(widgetMarkers(root)).not.toContain("pdf-pages");
    });

    it("enables ToC for a doc note and a markdown code note", () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "true" });
        const docCtx = setActiveNote({ id: "doc1", type: "doc" });
        const first = renderContainer(makeWidgetsByParent(), docCtx);
        expect(widgetMarkers(first.container)).toContain("toc");
        first.unmount();

        const mdCtx = setActiveNote({ id: "md1", type: "code", mime: "text/markdown" });
        const { container: root } = renderContainer(makeWidgetsByParent(), mdCtx);
        expect(widgetMarkers(root)).toContain("toc");
    });

    it("enables all the PDF panels (plus ToC) for a PDF file note", () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "true" });
        const noteContext = setActiveNote({ id: "pdf1", type: "file", mime: "application/pdf" });
        const { container: root } = renderContainer(makeWidgetsByParent(), noteContext);
        const markers = widgetMarkers(root);
        for (const expected of [ "toc", "pdf-pages", "pdf-attachments", "pdf-layers", "pdf-annotations" ]) {
            expect(markers).toContain(expected);
        }
    });

    it("enables the highlights list only when configured and the note is text", () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "true", highlightsList: JSON.stringify([ "bold" ]) });
        const noteContext = setActiveNote({ id: "hl1", type: "text" });
        const { container: root } = renderContainer(makeWidgetsByParent(), noteContext);
        expect(widgetMarkers(root)).toContain("highlights");
    });

    it("does not render highlights when the list is empty", () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "true", highlightsList: JSON.stringify([]) });
        const noteContext = setActiveNote({ id: "hl2", type: "text" });
        const { container: root } = renderContainer(makeWidgetsByParent(), noteContext);
        expect(widgetMarkers(root)).not.toContain("highlights");
    });

    it("enables the sidebar chat when the LLM experimental feature is on and note is not llmChat", () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "true" });
        (isExperimentalFeatureEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const noteContext = setActiveNote({ id: "txt2", type: "text" });
        const { container: root } = renderContainer(makeWidgetsByParent(), noteContext);
        const markers = widgetMarkers(root);
        expect(markers).toContain("chat");
        // The chat has an explicit high position, so it sorts after the ToC.
        expect(markers.indexOf("chat")).toBeGreaterThan(markers.indexOf("toc"));
    });

    it("hides the sidebar chat for an llmChat note even with the feature enabled", () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "true" });
        (isExperimentalFeatureEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const noteContext = setActiveNote({ id: "chatNote", type: "llmChat" as NoteType });
        const { container: root } = renderContainer(makeWidgetsByParent(), noteContext);
        expect(widgetMarkers(root)).not.toContain("chat");
    });

    it("toggles visibility on the toggleRightPane event and persists the new value", () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "false" });
        const saveSpy = vi.spyOn(options, "save").mockResolvedValue(undefined);
        const noteContext = setActiveNote({ id: "t3", type: "text" });
        const { container: root } = renderContainer(makeWidgetsByParent(), noteContext);
        expect(widgetMarkers(root)).toEqual([]);

        act(() => {
            (parent.handleEventInChildren as (n: string, d: unknown) => void)("toggleRightPane", {});
        });
        expect(saveSpy).toHaveBeenCalledWith("rightPaneVisible", "true");
        expect(widgetMarkers(root)).toContain("toc");

        // Toggle back off.
        act(() => {
            (parent.handleEventInChildren as (n: string, d: unknown) => void)("toggleRightPane", {});
        });
        expect(saveSpy).toHaveBeenLastCalledWith("rightPaneVisible", "false");
        expect(widgetMarkers(root)).toEqual([]);
    });

    it("clamps rightPaneWidth below the minimum and destroys Split on unmount", () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "true", rightPaneWidth: "1" });
        const destroy = vi.fn();
        (Split as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ destroy });
        const noteContext = setActiveNote({ id: "w1", type: "text" });
        const { unmount } = renderContainer(makeWidgetsByParent(), noteContext);
        expect(Split).toHaveBeenCalledTimes(1);
        const sizes = (Split as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].sizes;
        // MIN_WIDTH_PERCENT is 5, so a configured width of 1 is clamped up to 5.
        expect(sizes).toEqual([ 95, 5 ]);

        unmount();
        expect(destroy).toHaveBeenCalledTimes(1);
    });

    it("persists the new width when Split's onDragEnd fires", () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "true", rightPaneWidth: "20" });
        const saveSpy = vi.spyOn(options, "save").mockResolvedValue(undefined);
        const noteContext = setActiveNote({ id: "w2", type: "text" });
        renderContainer(makeWidgetsByParent(), noteContext);
        const config = (Split as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
        config.onDragEnd([ 70.4, 29.6 ]);
        expect(saveSpy).toHaveBeenCalledWith("rightPaneWidth", 30);
    });

    it("renders Preact script widgets supplied by widgetsByParent", () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "true" });
        const noteContext = setActiveNote({ id: "p1", type: "text" });
        const widgets = makeWidgetsByParent({
            preact: [ { render: () => <div data-widget="custom-preact" />, position: 5 } ]
        });
        const { container: root } = renderContainer(widgets, noteContext);
        const markers = widgetMarkers(root);
        expect(markers).toContain("custom-preact");
        // Position 5 sorts before the auto-assigned ToC (10).
        expect(markers.indexOf("custom-preact")).toBeLessThan(markers.indexOf("toc"));
    });

    it("renders a legacy custom widget, runs its render, and wires the go-to-source action", () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "true" });
        const renderBody = vi.fn();
        class FakeLegacy extends LegacyRightPanelWidget {
            get widgetTitle() { return "Custom"; }
            doRenderBody() { renderBody(); this.$body.append("<span class='legacy-body'>hi</span>"); }
        }
        const widget = new FakeLegacy();
        (widget as unknown as { _noteId: string })._noteId = "legacyNote";

        const noteContext = setActiveNote({ id: "lp1", type: "text" });
        const openInNewTab = vi.fn();
        Object.assign(appContext.tabManager, { openInNewTab });
        const widgets = makeWidgetsByParent({ legacy: [ widget ] });
        const { container: root } = renderContainer(widgets, noteContext);

        const legacyHost = root.querySelector("[data-widget='legacy'][data-id='legacyNote']");
        expect(legacyHost).toBeTruthy();
        expect(renderBody).toHaveBeenCalled();

        // The context-menu "go to source" item opens the widget's source note in a new tab.
        const ctxButton = root.querySelector<HTMLButtonElement>("[data-id='legacyNote'] button.ctx-menu-item");
        ctxButton?.click();
        expect(openInNewTab).toHaveBeenCalledWith("legacyNote", null, true);
    });

    it("survives a legacy widget whose doRenderBody returns a rejecting promise", async () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "true" });
        class FailingLegacy extends LegacyRightPanelWidget {
            get widgetTitle() { return "Bad"; }
            doRenderBody() { return Promise.reject(new Error("boom")); }
        }
        const widget = new FailingLegacy();
        (widget as unknown as { _noteId: string })._noteId = "badNote";
        vi.spyOn(widget, "logRenderingError").mockImplementation(() => undefined);

        const noteContext = setActiveNote({ id: "lp2", type: "text" });
        const widgets = makeWidgetsByParent({ legacy: [ widget ] });
        const { container: root } = renderContainer(widgets, noteContext);
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

        expect(root.querySelector("[data-widget='legacy'][data-id='badNote']")).toBeTruthy();
        expect(widget.logRenderingError).toHaveBeenCalled();
    });

    it("tolerates an active context with no note (no panels)", () => {
        options.load({ ...BASE_OPTIONS, rightPaneVisible: "true" });
        const noteContext = setActiveNote(null);
        const { container: root } = renderContainer(makeWidgetsByParent(), noteContext);
        // No note → no built-in panels, just the placeholder button.
        expect(widgetMarkers(root)).toEqual([]);
        expect(root.querySelector("button[data-trigger-command='toggleRightPane']")).toBeTruthy();
    });
});
