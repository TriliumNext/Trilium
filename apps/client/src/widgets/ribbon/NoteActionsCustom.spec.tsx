import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapMock } from "../../test/mocks";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Force desktop mode: `cachedIsMobile = isMobile()` is captured at module load both here and inside
// ActionButton/Button, so it must be mocked before the component (and its deps) are imported.
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: () => false,
    createImageSrcUrl: vi.fn(() => "data:image/png;base64,xxx"),
    openInAppHelpFromUrl: vi.fn()
}));
vi.mock("bootstrap", () => bootstrapMock());
vi.mock("../../services/keyboard_actions", () => ({
    default: { getAction: vi.fn(async () => ({ effectiveShortcuts: [] })) }
}));
vi.mock("../../services/image", () => ({ copyImageReferenceToClipboard: vi.fn() }));
vi.mock("../../services/open", () => ({ openNoteExternally: vi.fn(), downloadFileNote: vi.fn() }));
vi.mock("../FloatingButtonsDefinitions", () => ({ buildSaveSqlToNoteHandler: vi.fn(() => vi.fn()) }));
vi.mock("./FilePropertiesTab", () => ({ buildUploadNewFileRevisionListener: vi.fn(() => vi.fn()) }));
vi.mock("./ImagePropertiesTab", () => ({ buildUploadNewImageRevisionListener: vi.fn(() => vi.fn()) }));

import Component from "../../components/component";
import type NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import { copyImageReferenceToClipboard } from "../../services/image";
import options from "../../services/options";
import { downloadFileNote, openNoteExternally } from "../../services/open";
import { openInAppHelpFromUrl } from "../../services/utils";
import { buildNote } from "../../test/easy-froca";
import { fakeNoteContext, makeLoadResults, renderComponent as renderWithProviders } from "../../test/render";
import NoteActionsCustom from "./NoteActionsCustom";

// --- Render helper -------------------------------------------------------------------------------

function renderComponent(note: FNote, parent: Component | null = new Component(), noteContext?: Partial<NoteContext>) {
    const ctx = fakeNoteContext({ ntxId: "ntx1", viewScope: { viewMode: "default" }, ...noteContext });
    // `null` is intentional here (tests the no-parent early-return); cast since the helper types `parent` as optional.
    const { container } = renderWithProviders(
        <NoteActionsCustom note={note} ntxId="ntx1" noteContext={ctx} />,
        { parent: parent as Component | undefined }
    );
    return container;
}

function makeNote(def: Parameters<typeof buildNote>[0], mime?: string) {
    const note = buildNote(def);
    if (mime !== undefined) {
        note.mime = mime;
    }
    return note;
}

// --- Lifecycle -----------------------------------------------------------------------------------

beforeEach(() => {
    options.load({} as never);
    vi.clearAllMocks();
});

// --- Tests ---------------------------------------------------------------------------------------

describe("NoteActionsCustom", () => {
    it("renders the container with shared buttons for a plain text note", () => {
        const note = makeNote({ id: "plain", title: "Plain", type: "text" }, "text/html");
        const root = renderComponent(note);
        const wrapper = root.querySelector(".note-actions-custom");
        expect(wrapper).toBeTruthy();
        // A plain text note: none of the type-specific buttons, but the help / inner are evaluated.
        expect(root.querySelectorAll(".note-actions-custom-display-mode").length).toBe(0);
    });

    it("returns nothing (early-return) when there is no parent component", () => {
        const note = makeNote({ id: "noparent", title: "NP", type: "text" }, "text/html");
        const root = renderComponent(note, null);
        expect(root.querySelector(".note-actions-custom")).toBeNull();
    });

    it("shows the Run button for a JavaScript code note and the SQL run button", () => {
        const js = makeNote({ id: "jsnote", title: "JS", type: "code" }, "application/javascript;env=frontend");
        const root = renderComponent(js);
        const runBtn = root.querySelector("[data-trigger-command='runActiveNote']");
        expect(runBtn).toBeTruthy();
    });

    it("shows the Run button for an SQLite note", () => {
        const sql = makeNote({ id: "sqlnote", title: "SQL", type: "code" }, "text/x-sqlite;schema=trilium");
        const root = renderComponent(sql);
        expect(root.querySelector("[data-trigger-command='runActiveNote']")).toBeTruthy();
    });

    it("renders file actions (upload / open externally / download) for a file note", () => {
        const file = makeNote({ id: "filenote", title: "F", type: "file" }, "application/pdf");
        const root = renderComponent(file);
        // A file input from the upload-new-revision button is present.
        expect(root.querySelector("input[type='file']")).toBeTruthy();
        // The download button triggers downloadFileNote when clicked.
        const buttons = Array.from(root.querySelectorAll("button.icon-action"));
        expect(buttons.length).toBeGreaterThan(0);
    });

    it("download button invokes downloadFileNote", () => {
        const file = makeNote({ id: "fdl", title: "F", type: "file" }, "application/pdf");
        const root = renderComponent(file);
        const downloadBtn = root.querySelector("button.bx-download");
        expect(downloadBtn).toBeTruthy();
        act(() => (downloadBtn as HTMLButtonElement).click());
        expect(downloadFileNote).toHaveBeenCalled();
    });

    it("open-externally button invokes openNoteExternally", () => {
        const file = makeNote({ id: "fext", title: "F", type: "file" }, "application/pdf");
        const root = renderComponent(file);
        const openBtn = root.querySelector("button.bx-link-external");
        expect(openBtn).toBeTruthy();
        act(() => (openBtn as HTMLButtonElement).click());
        expect(openNoteExternally).toHaveBeenCalledWith("fext", "application/pdf");
    });

    it("renders image actions and the copy-reference button for an image note", () => {
        const img = makeNote({ id: "imgnote", title: "Img", type: "image" }, "image/png");
        const root = renderComponent(img);
        const copyBtn = root.querySelector("button.bx-copy");
        expect(copyBtn).toBeTruthy();
        act(() => (copyBtn as HTMLButtonElement).click());
        expect(copyImageReferenceToClipboard).toHaveBeenCalled();
    });

    it("renders the in-app-help button for a mermaid note and triggers help on click", () => {
        const mermaid = makeNote({ id: "mer", title: "M", type: "mermaid" }, "text/mermaid");
        const root = renderComponent(mermaid);
        const helpBtn = root.querySelector("button.bx-help-circle");
        expect(helpBtn).toBeTruthy();
        act(() => (helpBtn as HTMLButtonElement).click());
        expect(openInAppHelpFromUrl).toHaveBeenCalled();
    });

    it("renders the AddChildButton for a relationMap note and fires the event", () => {
        const rm = makeNote({ id: "rmnote", title: "RM", type: "relationMap" }, "application/json");
        const parent = new Component();
        const trigger = vi.spyOn(parent, "triggerEvent").mockResolvedValue(undefined as never);
        const root = renderComponent(rm, parent);
        const addBtn = root.querySelector("button.bx-folder-plus");
        expect(addBtn).toBeTruthy();
        act(() => (addBtn as HTMLButtonElement).click());
        expect(trigger).toHaveBeenCalledWith("relationMapCreateChildNote", { ntxId: "ntx1" });
    });

    it("disables the AddChildButton when the relationMap note is read-only", () => {
        const rm = makeNote({ id: "rmro", title: "RM", type: "relationMap", "#readOnly": "true" }, "application/json");
        const root = renderComponent(rm);
        const addBtn = root.querySelector("button.bx-folder-plus");
        expect(addBtn).toBeTruthy();
        expect((addBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it("renders the refresh button for the _backendLog note and fires refreshData", () => {
        const log = makeNote({ id: "_backendLog", title: "Log", type: "text" }, "text/plain");
        const parent = new Component();
        const trigger = vi.spyOn(parent, "triggerEvent").mockResolvedValue(undefined as never);
        const root = renderComponent(log, parent);
        const refreshBtn = root.querySelector("button.bx-refresh");
        expect(refreshBtn).toBeTruthy();
        act(() => (refreshBtn as HTMLButtonElement).click());
        expect(trigger).toHaveBeenCalledWith("refreshData", { ntxId: "ntx1" });
        // _backendLog also renders an extra download button.
        expect(root.querySelector("button.bx-download")).toBeTruthy();
    });

    it("renders the refresh button for a render note in default view mode", () => {
        const renderNote = makeNote({ id: "rendernote", title: "R", type: "render" }, "text/html");
        const root = renderComponent(renderNote);
        expect(root.querySelector("button.bx-refresh")).toBeTruthy();
    });

    it("does not render the refresh button for a render note outside the default view mode", () => {
        const renderNote = makeNote({ id: "rendernote2", title: "R", type: "render" }, "text/html");
        const root = renderComponent(renderNote, new Component(), { viewScope: { viewMode: "source" } } as Partial<NoteContext>);
        expect(root.querySelector("button.bx-refresh")).toBeNull();
    });
});

describe("NoteActionsCustom - markdown / display mode", () => {
    it("renders the display-mode switcher (desktop button group) for a markdown note", () => {
        const md = makeNote({ id: "mdnote", title: "MD", type: "code", content: "# Hi" }, "text/markdown");
        const root = renderComponent(md);
        // Desktop: spacer + button group, with the three mode buttons.
        expect(root.querySelectorAll(".note-actions-custom-spacer").length).toBe(2);
        expect(root.querySelector("button.bx-code")).toBeTruthy();
        expect(root.querySelector("button.bx-show")).toBeTruthy();
    });

    it("clicking a display-mode button sets the displayMode label", () => {
        const md = makeNote({ id: "mdset", title: "MD", type: "code", content: "# Hi" }, "text/x-markdown");
        const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
        const root = renderComponent(md);
        const sourceBtn = root.querySelector("button.bx-code");
        expect(sourceBtn).toBeTruthy();
        act(() => (sourceBtn as HTMLButtonElement).click());
        expect(setLabel).toHaveBeenCalledWith("mdset", "displayMode", "source");
    });
});

describe("NoteActionsCustom - mermaid split orientation", () => {
    it("renders the split-orientation switch for a mermaid note in default view mode", () => {
        const mermaid = makeNote({ id: "mersplit", title: "M", type: "mermaid", content: "graph TD" }, "text/mermaid");
        const root = renderComponent(mermaid);
        // The switch shows either the dock-left or dock-bottom icon depending on the option.
        const hasSwitch = root.querySelector("button.bxs-dock-left") || root.querySelector("button.bxs-dock-bottom");
        expect(hasSwitch).toBeTruthy();
    });

    it("uses the vertical orientation icon when the option is horizontal", () => {
        options.load({ splitEditorOrientation: "horizontal" } as never);
        const mermaid = makeNote({ id: "merh", title: "M", type: "mermaid", content: "graph TD" }, "text/mermaid");
        const root = renderComponent(mermaid);
        expect(root.querySelector("button.bxs-dock-bottom")).toBeTruthy();
    });

    it("clicking the split-orientation switch toggles splitEditorOrientation", () => {
        options.load({ splitEditorOrientation: "vertical" } as never);
        const setOption = vi.spyOn(options, "save").mockResolvedValue(undefined);
        const mermaid = makeNote({ id: "merclick", title: "M", type: "mermaid", content: "graph TD" }, "text/mermaid");
        const root = renderComponent(mermaid);
        const switchBtn = root.querySelector("button.bxs-dock-left");
        expect(switchBtn).toBeTruthy();
        expect((switchBtn as HTMLButtonElement).disabled).toBe(false);
        act(() => (switchBtn as HTMLButtonElement).click());
        expect(setOption).toHaveBeenCalledWith("splitEditorOrientation", "horizontal");
    });

    it("disables the split-orientation switch when the displayMode is not split", () => {
        const mermaid = makeNote({ id: "merpreview", title: "M", type: "mermaid", content: "graph TD", "#readOnly": "true" }, "text/mermaid");
        const root = renderComponent(mermaid);
        const switchBtn = root.querySelector("button.bxs-dock-left") ?? root.querySelector("button.bxs-dock-bottom");
        expect(switchBtn).toBeTruthy();
        // readOnly + no displayMode label → effectiveMode = "preview" → disabled.
        expect((switchBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it("respects an explicit displayMode=split label (switch enabled)", () => {
        const mermaid = makeNote({ id: "mersplitlbl", title: "M", type: "mermaid", content: "graph TD", "#displayMode": "split" }, "text/mermaid");
        const root = renderComponent(mermaid);
        const switchBtn = root.querySelector("button.bxs-dock-left") ?? root.querySelector("button.bxs-dock-bottom");
        expect(switchBtn).toBeTruthy();
        expect((switchBtn as HTMLButtonElement).disabled).toBe(false);
    });

    it("marks the preview display-mode button active for displayMode=preview", () => {
        const mermaid = makeNote({ id: "merdmprev", title: "M", type: "mermaid", content: "graph TD", "#displayMode": "preview" }, "text/mermaid");
        const root = renderComponent(mermaid);
        const previewBtn = root.querySelector("button.bx-show");
        expect(previewBtn).toBeTruthy();
        expect((previewBtn as HTMLButtonElement).className).toContain("active");
    });
});

describe("NoteActionsCustom - SaveToNoteButton", () => {
    it("shows the save-to-note button for a hidden SQLite note and refreshes on branch reload", () => {
        const sql = makeNote({ id: "_hiddenSql", title: "SQL", type: "code" }, "text/x-sqlite;schema=trilium");
        // _hidden prefix → isHiddenCompletely() walks parents; "_hiddenSql" is not _hidden itself,
        // but with no parents getParentNotes() is empty so isHiddenCompletely returns true.
        const parent = new Component();
        const root = renderComponent(sql, parent);
        const saveBtn = root.querySelector("button.bx-save");
        expect(saveBtn).toBeTruthy();

        // Firing entitiesReloaded with a matching branch row re-runs refresh().
        act(() => {
            (parent.handleEventInChildren as (n: string, d: unknown) => void)("entitiesReloaded", {
                loadResults: makeLoadResults({ branchRows: [ { noteId: "_hiddenSql" } ] })
            });
        });
        expect(root.querySelector("button.bx-save")).toBeTruthy();

        // A non-matching branch row leaves the button untouched (refresh not re-run).
        act(() => {
            (parent.handleEventInChildren as (n: string, d: unknown) => void)("entitiesReloaded", {
                loadResults: makeLoadResults({ branchRows: [ { noteId: "other" } ] })
            });
        });
        expect(root.querySelector("button.bx-save")).toBeTruthy();
    });
});

describe("NoteActionsCustom - focus event", () => {
    it("focuses the first child element on toggleRibbonTabFileProperties", () => {
        const file = makeNote({ id: "focusfile", title: "F", type: "file" }, "application/pdf");
        const parent = new Component();
        const root = renderComponent(file, parent);
        const wrapper = root.querySelector(".note-actions-custom");
        const firstChild = wrapper?.firstElementChild as HTMLElement | null;
        expect(firstChild).toBeTruthy();
        const focusSpy = firstChild ? vi.spyOn(firstChild, "focus") : null;
        act(() => {
            (parent.handleEventInChildren as (n: string, d: unknown) => void)("toggleRibbonTabFileProperties", {});
        });
        expect(focusSpy).toHaveBeenCalled();
    });
});

// The mobile path (`cachedIsMobile === true`) is captured at module load, so it needs a fresh module
// graph with `isMobile()` mocked to true. We reset the registry, re-declare the mocks, then import.
describe("NoteActionsCustom - mobile layout", () => {
    let mobileContainer: HTMLDivElement | undefined;
    let mobileRender: typeof import("preact").render | undefined;

    afterEach(() => {
        if (mobileContainer && mobileRender) {
            const c = mobileContainer;
            const r = mobileRender;
            act(() => r(null, c));
            c.remove();
        }
        mobileContainer = undefined;
        mobileRender = undefined;
        vi.resetModules();
        vi.restoreAllMocks();
    });

    async function renderMobile(note: FNote) {
        vi.resetModules();
        vi.doMock("../../services/utils", async (importOriginal) => ({
            ...(await importOriginal<typeof import("../../services/utils")>()),
            isMobile: () => true,
            createImageSrcUrl: vi.fn(() => "data:image/png;base64,xxx"),
            openInAppHelpFromUrl: vi.fn()
        }));
        vi.doMock("../../services/keyboard_actions", () => ({
            default: { getAction: vi.fn(async () => ({ effectiveShortcuts: [] })) }
        }));
        vi.doMock("../../services/image", () => ({ copyImageReferenceToClipboard: vi.fn() }));
        vi.doMock("../../services/open", () => ({ openNoteExternally: vi.fn(), downloadFileNote: vi.fn() }));
        vi.doMock("../FloatingButtonsDefinitions", () => ({ buildSaveSqlToNoteHandler: vi.fn(() => vi.fn()) }));
        vi.doMock("./FilePropertiesTab", () => ({ buildUploadNewFileRevisionListener: vi.fn(() => vi.fn()) }));
        vi.doMock("./ImagePropertiesTab", () => ({ buildUploadNewImageRevisionListener: vi.fn(() => vi.fn()) }));

        const preact = await import("preact");
        const { h } = preact;
        const { ParentComponent: MobileParent } = await import("../react/react_utils");
        const ComponentMod = (await import("../../components/component")).default;
        const Mobile = (await import("./NoteActionsCustom")).default;

        // The freshly-imported graph has its own service singletons; augment server's write verbs.
        const freshServer = (await import("../../services/server")).default;
        Object.assign(freshServer, { put: vi.fn(async () => undefined), upload: vi.fn(async () => undefined) });
        const freshAttributes = (await import("../../services/attributes")).default;

        mobileRender = preact.render;
        const el = document.createElement("div");
        mobileContainer = el;
        document.body.appendChild(el);
        const ctx = { ntxId: "ntx1", viewScope: { viewMode: "default" } } as unknown as NoteContext;
        act(() => preact.render(
            h(MobileParent.Provider, { value: new ComponentMod() },
                h(Mobile, { note, ntxId: "ntx1", noteContext: ctx })),
            el
        ));
        return { root: el, attributes: freshAttributes };
    }

    it("renders display-mode items as a dropdown list on mobile and clicking one sets displayMode", async () => {
        const mermaid = makeNote({ id: "mobmermaid", title: "M", type: "mermaid", content: "graph TD" }, "text/mermaid");
        const { root, attributes: freshAttributes } = await renderMobile(mermaid);
        const setLabel = vi.spyOn(freshAttributes, "setLabel").mockResolvedValue(undefined);
        // Mobile DisplayModeSwitcher wraps items in .note-actions-custom-display-mode with list items.
        const switcher = root.querySelector(".note-actions-custom-display-mode");
        expect(switcher).toBeTruthy();
        const items = switcher?.querySelectorAll("li.dropdown-item") ?? [];
        expect(items.length).toBe(3);

        // Click the first item (source) → setDisplayMode("source").
        const sourceItem = switcher?.querySelector("li.dropdown-item") as HTMLLIElement | null;
        expect(sourceItem).toBeTruthy();
        act(() => sourceItem?.click());
        expect(setLabel).toHaveBeenCalledWith("mobmermaid", "displayMode", "source");
    });

    it("renders file actions as list items (no buttons) on mobile", async () => {
        const file = makeNote({ id: "mobfile", title: "F", type: "file" }, "application/pdf");
        const { root } = await renderMobile(file);
        expect(root.querySelectorAll("li.dropdown-item").length).toBeGreaterThan(0);
        // The upload-new-revision uses a file-upload list item containing a file input.
        expect(root.querySelector("input[type='file']")).toBeTruthy();
    });
});
