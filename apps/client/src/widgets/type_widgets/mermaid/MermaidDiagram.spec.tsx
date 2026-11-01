import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContentEditor } from "../../../services/content_renderer";
import { renderMermaidSvg } from "../../../services/mermaid";
import options from "../../../services/options";
import {
    buildCodeViewTextEditor, getEmbedMenuItems, runEmbedMenuItem, summarizeMenuItem
} from "../../../test/content_embed";
import { getContentEmbedTools } from "../text/content_embed_tools";
import MermaidDiagram from "./MermaidDiagram";

vi.mock("../../../services/mermaid", () => ({
    renderMermaidSvg: vi.fn(async () => "<svg></svg>")
}));
const openInAppHelpFromUrl = vi.hoisted(() => vi.fn());
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/utils")>(),
    openInAppHelpFromUrl
}));
// react-zoom-pan-pinch measures its boxes, which happy-dom cannot do.
vi.mock("react-zoom-pan-pinch", () => ({
    TransformWrapper: (props: { children?: ComponentChildren }) => <>{props.children}</>,
    TransformComponent: (props: { children?: ComponentChildren }) => <div>{props.children}</div>
}));

// `CodeEditor` reads the theme as a string, and the line numbers set to Auto from the option.
options.set("codeNoteTheme", "");
options.set("codeLineNumbersEnabled", "true");

const figures: HTMLElement[] = [];

afterEach(() => {
    for (const figure of figures) {
        const box = figure.querySelector(".include-note-content");
        if (box) act(() => render(null, box));
        figure.remove();
    }
    figures.length = 0;
});

describe("MermaidDiagram", () => {
    it("offers both the Editable toggle and the display modes where it can edit", async () => {
        const { figure } = await mount({ editor: buildEditor() });
        expect(getContentEmbedTools(figure)).toMatchObject({
            hasEditableFlag: true,
            hasDisplayModes: true
        });
    });

    it("shows the panes of the mode, the source editable only while Editable is on", async () => {
        const editable = await mount({ editor: buildEditor(), isEditable: true });
        expect(getPanes(editable.figure)).toEqual({ source: true, preview: true });
        expect(await isSourceEditable(editable.figure)).toBe(true);

        const fixed = await mount({ editor: buildEditor(), displayMode: "split" });
        expect(getPanes(fixed.figure)).toEqual({ source: true, preview: true });
        expect(await isSourceEditable(fixed.figure)).toBe(false);

        const source = await mount({ editor: buildEditor(), displayMode: "source" });
        expect(getPanes(source.figure)).toEqual({ source: true, preview: false });

        const preview = await mount({
            editor: buildEditor(), isEditable: true, displayMode: "preview"
        });
        expect(getPanes(preview.figure)).toEqual({ source: false, preview: true });
    });

    it("shows the diagram alone without a mode, unless Editable is on", async () => {
        const diagram = await mount({ editor: buildEditor() });
        expect(getPanes(diagram.figure)).toEqual({ source: false, preview: true });

        const readOnly = await mount({ editor: undefined, isEditable: true });
        expect(getPanes(readOnly.figure)).toEqual({ source: false, preview: true });

        const picked = await mount({ editor: undefined, displayMode: "source" });
        expect(getPanes(picked.figure)).toEqual({ source: true, preview: false });
        expect(await isSourceEditable(picked.figure)).toBe(false);
    });

    it("offers the syntax help while the source shows", async () => {
        const split = await mount({ editor: buildEditor(), displayMode: "split" });
        const tools = getContentEmbedTools(split.figure);
        expect(tools?.getTools().at(-1)).toMatchObject({ id: "syntaxHelp", group: "help" });
        tools?.execute("syntaxHelp");
        expect(openInAppHelpFromUrl).toHaveBeenCalledExactlyOnceWith("s1aBHPd79XYj");

        const source = await mount({ editor: buildEditor(), displayMode: "source" });
        expect(getContentEmbedTools(source.figure)?.getTools().map(({ id }) => id))
            .toContain("syntaxHelp");

        const preview = await mount({ editor: buildEditor(), displayMode: "preview" });
        expect(getContentEmbedTools(preview.figure)?.getTools().map(({ id }) => id))
            .not.toContain("syntaxHelp");
    });

    it("groups the fullscreen with the zoom, and the help apart", async () => {
        const { figure } = await mount({ editor: buildEditor(), displayMode: "split" });
        figure.dataset.hideTitle = "true";
        figure.dataset.boxSize = "medium";
        const tools = getContentEmbedTools(figure)?.getTools() ?? [];
        expect(tools.map(({ id, group }) => [ id, group ])).toEqual([
            [ "zoomOut", "zoom" ], [ "resetZoom", "zoom" ], [ "zoomIn", "zoom" ],
            [ "fullscreen", "zoom" ], [ "syntaxHelp", "help" ]
        ]);
    });

    it("shows a render error in the card of the Mermaid note", async () => {
        vi.mocked(renderMermaidSvg).mockRejectedValueOnce(
            new Error("Parse error on line 2:\n...A--\n---^"));
        const failed = await mount({ editor: buildEditor() });
        const card = await vi.waitFor(() => {
            const found = failed.figure.querySelector(".note-detail-split .note-detail-error-card");
            expect(found).not.toBeNull();
            return found;
        });
        expect(card?.querySelector(".note-detail-error-message")?.textContent)
            .toBe("Parse error on line 2:");
        expect(card?.querySelector("pre")?.textContent).toBe("...A--\n---^");
        expect(failed.figure.querySelector(".note-detail-error-stale-badge")).toBeNull();
        expect(failed.figure.querySelector(".svg-preview-root")).not.toBeNull();
    });

    it("shows the zoom buttons over the diagram while in fullscreen", async () => {
        const { figure } = await mount({ editor: buildEditor(), displayMode: "split" });
        const box = figure.querySelector(".include-note-content");
        if (!box) throw new Error("Expected the content box.");
        await vi.waitFor(() => expect(figure.querySelector(".render-container svg")).not.toBeNull());
        expect(getZoomButtons(figure)).toBeNull();

        await act(async () => {
            box.dispatchEvent(new Event("enterFullscreen", { bubbles: true }));
        });
        const buttons = getZoomButtons(figure);
        expect(buttons).not.toBeNull();
        // Zoom out, the zoom level, zoom in.
        expect(buttons?.querySelectorAll("button")).toHaveLength(3);

        await act(async () => {
            box.dispatchEvent(new Event("leaveFullscreen", { bubbles: true }));
        });
        expect(getZoomButtons(figure)).toBeNull();
    });

    it("offers fullscreen over a read-only diagram whose box has no title row", async () => {
        const untitled = await mount({ editor: undefined, boxSize: "medium", hideTitle: true });
        await waitForDiagram(untitled.figure);
        const buttons = getZoomButtons(untitled.figure)?.querySelectorAll("button");
        // Zoom out, the zoom level, zoom in, fullscreen.
        expect(buttons).toHaveLength(4);
        const box = untitled.figure.querySelector(".include-note-content");
        if (!(box instanceof HTMLElement)) throw new Error("Expected the content box.");
        const requestFullscreen = vi.fn(async () => {});
        box.requestFullscreen = requestFullscreen;
        await act(async () => buttons?.[3]?.click());
        expect(requestFullscreen).toHaveBeenCalledOnce();

        await act(async () => {
            box.dispatchEvent(new Event("enterFullscreen", { bubbles: true }));
        });
        expect(getZoomButtons(untitled.figure)?.querySelectorAll("button")).toHaveLength(3);

        for (const options of [ { boxSize: "small", hideTitle: true }, { boxSize: "full" } ]) {
            const other = await mount({ editor: undefined, ...options });
            await waitForDiagram(other.figure);
            expect(getZoomButtons(other.figure)?.querySelectorAll("button")).toHaveLength(3);
        }

        const source = await mount({
            editor: undefined, displayMode: "source", boxSize: "full", hideTitle: true
        });
        const sourceButtons = source.figure
            .querySelectorAll<HTMLElement>(".mermaid-diagram-controls button");
        expect(sourceButtons).toHaveLength(1);
        const sourceBox = source.figure.querySelector(".include-note-content");
        if (!(sourceBox instanceof HTMLElement)) throw new Error("Expected the content box.");
        sourceBox.requestFullscreen = requestFullscreen;
        await act(async () => sourceButtons[0]?.click());
        expect(requestFullscreen).toHaveBeenCalledTimes(2);

        const split = await mount({
            editor: undefined, displayMode: "split", boxSize: "full", hideTitle: true
        });
        await waitForDiagram(split.figure);
        expect(split.figure.querySelector(".mermaid-diagram-controls")).toBeNull();
    });

    it("makes the same source editor editable while Editable is on", async () => {
        const editor = buildEditor();
        const { figure } = await mount({ editor, displayMode: "split" });
        const view = await findSourceView(figure);
        expect(await isSourceEditable(figure)).toBe(false);

        await act(async () => {
            figure.dataset.editable = "true";
            await Promise.resolve();
        });
        await vi.waitFor(async () => expect(await isSourceEditable(figure)).toBe(true));
        expect(await findSourceView(figure)).toBe(view);
        act(() => view.dispatch({ changes: { from: 0, insert: "%% " } }));
        expect(editor.scheduleSave).toHaveBeenCalledOnce();

        await act(async () => {
            delete figure.dataset.editable;
            await Promise.resolve();
        });
        expect(await isSourceEditable(figure)).toBe(false);
        expect(await findSourceView(figure)).toBe(view);
    });

    it("keeps the edits of its source on the text note's undo stack, read-only too", async () => {
        const host = {
            push: vi.fn(() => ({ isLatest: () => false })), undo: vi.fn(), redo: vi.fn(),
            isEnabled: () => false, subscribe: () => () => {}
        };
        const editor = { ...buildEditor(), history: { host, write: vi.fn() } };
        const { figure } = await mount({ editor, isEditable: true, displayMode: "split" });
        const view = await findSourceView(figure);

        act(() => view.dispatch({ changes: { from: 0, insert: "%% " } }));
        expect(host.push).toHaveBeenCalledOnce();

        await act(async () => {
            delete figure.dataset.editable;
            await Promise.resolve();
        });
        expect(await isSourceEditable(figure)).toBe(false);
        view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
            key: "z", ctrlKey: true, bubbles: true, cancelable: true
        }));
        expect(host.undo).toHaveBeenCalledOnce();
    });

    it("wraps and numbers the lines of the source as the menu of its embed sets", async () => {
        const { textEditor, editable } = buildCodeViewTextEditor();
        const { figure } = await mount({
            editor: buildEditor(),
            displayMode: "source",
            embedAttributes: { "data-code-wrap-lines": "true", "data-code-line-numbers": "false" },
            container: editable
        });
        const view = await findSourceView(figure);
        expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
        expect(figure.querySelector(".cm-lineNumbers")).toBeNull();
        // Word wrap, then line numbers.
        expect(getEmbedMenuItems(figure).map(summarizeMenuItem)).toMatchObject([
            { items: [ { checked: false }, { checked: true }, { checked: false } ] },
            { items: [ { checked: false }, { checked: false }, { checked: true } ] }
        ]);

        // A diagram has no note, so its embed keeps both.
        await runEmbedMenuItem(figure, 0, 2);
        await runEmbedMenuItem(figure, 1, 0);
        expect(textEditor.execute.mock.calls.map(([ , codeView ]) => codeView))
            .toEqual([ { wrapLines: false }, { lineNumbers: null } ]);
        await vi.waitFor(() => {
            expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
            expect(figure.querySelector(".cm-lineNumbers")).not.toBeNull();
        });
    });
});

interface MountOptions {
    editor: ContentEditor | undefined;
    isEditable?: boolean;
    displayMode?: string;
    boxSize?: string;
    hideTitle?: boolean;
    /** Other attributes of the embed, such as `data-code-wrap-lines`. */
    embedAttributes?: Record<string, string>;
    /** The element the embed goes in, such as the editable root of a text editor. */
    container?: HTMLElement;
}

async function mount({
    editor, isEditable, displayMode, boxSize, hideTitle, embedAttributes, container
}: MountOptions) {
    const figure = document.createElement("figure");
    figure.className = "include-note";
    if (isEditable) figure.dataset.editable = "true";
    if (displayMode) figure.dataset.displayMode = displayMode;
    if (boxSize) figure.dataset.boxSize = boxSize;
    if (hideTitle) figure.dataset.hideTitle = "true";
    for (const [ name, value ] of Object.entries(embedAttributes ?? {})) {
        figure.setAttribute(name, value);
    }
    const box = document.createElement("div");
    box.className = "include-note-content";
    figure.append(box);
    (container ?? document.body).append(figure);
    figures.push(figure);

    await act(async () => render(<MermaidDiagram content="graph TD;" editor={editor} />, box));
    return { figure };
}

async function waitForDiagram(figure: HTMLElement) {
    await vi.waitFor(() => expect(figure.querySelector(".render-container svg")).not.toBeNull());
}

function getZoomButtons(figure: HTMLElement) {
    return figure.querySelector(".note-detail-split-preview-col .svg-preview-controls");
}

/** The panes the layout shows, out of those mounted. */
function getPanes(figure: HTMLElement) {
    const split = figure.querySelector(".note-detail-split");
    expect(split).not.toBeNull();
    return {
        source: !!split?.querySelector(".note-detail-split-editor-col")
            && !split.classList.contains("split-read-only"),
        preview: !!split?.querySelector(".note-detail-split-preview-col")
            && !split.classList.contains("split-source-only")
    };
}

/** Whether the CodeMirror of the source pane takes edits, once it has loaded. */
async function isSourceEditable(figure: HTMLElement) {
    return !(await findSourceView(figure)).state.readOnly;
}

/** The CodeMirror of the source pane, once it has loaded. */
async function findSourceView(figure: HTMLElement) {
    const { EditorView } = await import("@codemirror/view");
    let view: InstanceType<typeof EditorView> | null = null;
    await vi.waitFor(() => {
        const dom = figure.querySelector(".note-detail-split-editor .cm-editor");
        view = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null;
        expect(view).not.toBeNull();
    }, { timeout: 5000 });
    if (!view) throw new Error("CodeMirror did not mount.");
    return view as InstanceType<typeof EditorView>;
}

function buildEditor(): ContentEditor {
    return {
        canEdit: () => true,
        getUnsavedContent: () => undefined,
        scheduleSave: vi.fn(),
        release: vi.fn()
    };
}
