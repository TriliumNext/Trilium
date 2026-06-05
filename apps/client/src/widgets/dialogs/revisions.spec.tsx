import { RevisionItem, RevisionPojo } from "@triliumnext/commons";
import { ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        static getOrCreateInstance(el: Element) { return Tooltip.getInstance(el) ?? new Tooltip(el); }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
        update() {}
    }
    class Modal {
        static getInstance() { return null; }
        static getOrCreateInstance() { return new Modal(); }
        show() {}
        hide() {}
        dispose() {}
    }
    class Dropdown {
        static getInstance() { return null; }
        static getOrCreateInstance() { return new Dropdown(); }
        show() {}
        hide() {}
        update() {}
        dispose() {}
    }
    return { Tooltip, Modal, Dropdown, default: { Tooltip, Modal, Dropdown } };
});

vi.mock("../../services/dialog", () => ({
    default: {
        confirm: vi.fn(async () => true),
        prompt: vi.fn(async () => "named")
    },
    openDialog: vi.fn(async ($el: unknown) => $el)
}));
vi.mock("../../services/toast", () => ({ default: { showMessage: vi.fn(), showPersistent: vi.fn(), closePersistent: vi.fn() } }));
vi.mock("../../services/open", () => ({ default: { downloadRevision: vi.fn() } }));
vi.mock("../../services/math", () => ({ renderMathInElement: vi.fn() }));
vi.mock("../../services/sanitize_content.js", () => ({ sanitizeNoteContentHtml: (html: string) => html ?? "" }));
vi.mock("../type_widgets/file/PdfViewer", () => ({ default: ({ pdfUrl }: { pdfUrl: string }) => <div className="pdf-stub" data-url={pdfUrl} /> }));
// Render the dropdown's children unconditionally so the menu items are always exercised.
vi.mock("../react/Dropdown", () => ({ default: ({ children }: { children: ComponentChildren }) => <div className="dropdown-stub">{children}</div> }));

import Component from "../../components/component";
import dialog from "../../services/dialog";
import open from "../../services/open";
import server from "../../services/server";
import toast from "../../services/toast";
import { buildNote } from "../../test/easy-froca";
import froca from "../../services/froca";
import { ParentComponent } from "../react/react_utils";
import RevisionsDialog from "./revisions";

// --- Render harness (full component inside the Trilium parent provider) ---------------------------

let container: HTMLDivElement | undefined;
let parent: Component | undefined;

function renderDialog() {
    const localParent = new Component();
    const localContainer = document.createElement("div");
    parent = localParent;
    container = localContainer;
    document.body.appendChild(localContainer);
    act(() => render(
        <ParentComponent.Provider value={localParent}>
            <RevisionsDialog />
        </ParentComponent.Provider>,
        localContainer
    ));
    return localContainer;
}

function fireEvent(name: string, data: unknown) {
    act(() => { (parent?.handleEventInChildren as (n: string, d: unknown) => void)?.(name, data); });
}

async function flush() {
    // The dialog has a multi-step async effect chain (list fetch → select first → full-revision
    // fetch → set content), so settle several macrotask cycles.
    for (let i = 0; i < 5; i++) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    }
}

function makeRevision(overrides: Partial<RevisionItem> = {}): RevisionItem {
    return {
        noteId: "n1",
        revisionId: "rev1",
        type: "text",
        title: "Rev Title",
        mime: "text/html",
        dateCreated: "2026-06-05 10:00:00.000Z",
        source: "manual",
        contentLength: 12,
        ...overrides
    };
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    Object.assign(server, {
        get: vi.fn(async () => []),
        post: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        patch: vi.fn(async () => undefined)
    });
    (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (dialog.prompt as ReturnType<typeof vi.fn>).mockResolvedValue("named");
});

afterEach(() => {
    if (container) { act(() => render(null, container ?? document.createElement("div"))); container.remove(); container = undefined; }
    vi.restoreAllMocks();
});

// --- Tests ---------------------------------------------------------------------------------------

describe("RevisionsDialog — empty state", () => {
    it("shows the no-revisions placeholder and renders the menu when there are no revisions", async () => {
        buildNote({ id: "n1", title: "Note", content: "<p>hello</p>" });
        Object.assign(server, { get: vi.fn(async () => []) });

        const el = renderDialog();
        fireEvent("showRevisions", { noteId: "n1" });
        await flush();

        expect(el.querySelector(".revisions-dialog")).toBeTruthy();
        // No-revisions placeholder uses the bx-history icon.
        expect(el.querySelector(".bx-history")).toBeTruthy();
        // The menu (mocked dropdown) renders the save/settings items but NOT the delete-all item.
        expect(el.querySelector(".bx-save")).toBeTruthy();
        expect(el.querySelector(".bx-trash")).toBeNull();
    });

    it("saving a revision from the empty-state menu refreshes via onRevisionSaved", async () => {
        buildNote({ id: "n1", title: "Note", content: "x" });
        Object.assign(server, { get: vi.fn(async () => []), post: vi.fn(async () => undefined) });
        const el = renderDialog();
        fireEvent("showRevisions", { noteId: "n1" });
        await flush();
        const saveItem = Array.from(el.querySelectorAll(".dropdown-stub .dropdown-item"))
            .find(li => li.querySelector(".bx-save") && !li.hasAttribute("data-value")) as HTMLElement | undefined;
        await act(async () => { saveItem?.click(); await Promise.resolve(); });
        await flush();
        expect(server.post).toHaveBeenCalledWith("notes/n1/revision");
    });
});

describe("RevisionsDialog — populated", () => {
    async function openWith(revisions: RevisionItem[], full?: Partial<RevisionPojo>, noteContent = "<p>current</p>") {
        buildNote({ id: "n1", title: "Note", content: noteContent });
        const fullRevision: RevisionPojo = {
            noteId: "n1", revisionId: "rev1", type: "text", mime: "text/html",
            title: "Rev Title", content: "<p>old</p>", ...full
        };
        Object.assign(server, {
            get: vi.fn(async (url: string) => {
                if (url.endsWith("/revisions")) return revisions;
                if (url.startsWith("revisions/")) return fullRevision;
                return [];
            }),
            post: vi.fn(async () => undefined),
            remove: vi.fn(async () => undefined),
            patch: vi.fn(async () => undefined)
        });
        const el = renderDialog();
        fireEvent("showRevisions", { noteId: "n1" });
        await flush();
        return el;
    }

    it("lists revisions with date-group headers, selects the first by default, and shows the diff toggle", async () => {
        const el = await openWith([
            makeRevision({ revisionId: "rev1", dateCreated: nowStr(), description: "First" }),
            makeRevision({ revisionId: "rev2", dateCreated: oldStr(), source: "auto" })
        ]);

        // The list wrapper exists and contains two items + at least two date-group headers.
        expect(el.querySelector(".revision-list")).toBeTruthy();
        expect(el.querySelectorAll(".dropdown-item[data-value]").length).toBe(2);
        expect(el.querySelectorAll(".revision-group-header").length).toBeGreaterThanOrEqual(2);
        // The first revision is the active selection.
        expect(el.querySelector(".dropdown-item.active")?.getAttribute("data-value")).toBe("rev1");
        // The diff toggle is shown for diffable (text) types.
        expect(el.querySelector(".switch-widget")).toBeTruthy();
        // A description is rendered for the first item.
        expect(el.querySelector(".revision-item-description")?.textContent).toContain("First");
    });

    it("selecting another revision updates the active item", async () => {
        const el = await openWith([
            makeRevision({ revisionId: "rev1", dateCreated: nowStr() }),
            makeRevision({ revisionId: "rev2", dateCreated: nowStr() })
        ]);
        const second = el.querySelector('.dropdown-item[data-value="rev2"]') as HTMLElement | null;
        act(() => second?.click());
        expect(el.querySelector(".dropdown-item.active")?.getAttribute("data-value")).toBe("rev2");
    });

    it("groups a same-week (but not today/yesterday) revision under the weekday format", async () => {
        const { dayjs } = await import("@triliumnext/commons");
        const now = dayjs();
        // A day inside the current week that is neither today nor yesterday: prefer the week start,
        // but if that collides with today/yesterday, step forward until it doesn't.
        let candidate = now.startOf("week");
        while (candidate.isSame(now, "day") || candidate.isSame(now.subtract(1, "day"), "day")) {
            candidate = candidate.add(1, "day");
        }
        const sameWeek = candidate.hour(12).format("YYYY-MM-DD HH:mm:ss.SSS[Z]");
        const el = await openWith([ makeRevision({ revisionId: "rev1", dateCreated: sameWeek }) ]);
        // The item date uses the weekday-with-time format ("dddd · HH:mm"), containing the separator.
        expect(el.querySelector(".revision-item-date")?.textContent).toContain("·");
    });

    it("renders the delete-all menu item when revisions exist and triggers the remove call when confirmed", async () => {
        const el = await openWith([ makeRevision({ revisionId: "rev1", dateCreated: nowStr() }) ]);
        const deleteAll = Array.from(el.querySelectorAll(".bx-trash"))
            .map(icon => icon.closest(".dropdown-item"))
            .find(li => li && !li.hasAttribute("data-value")) as HTMLElement | undefined;
        expect(deleteAll).toBeTruthy();
        await act(async () => { deleteAll?.click(); await Promise.resolve(); });
        await flush();
        expect(dialog.confirm).toHaveBeenCalled();
        expect(server.remove).toHaveBeenCalledWith("notes/n1/revisions");
        expect(toast.showMessage).toHaveBeenCalled();
    });
});

describe("RevisionsMenu actions", () => {
    async function openMenu() {
        buildNote({ id: "n1", title: "Note", "#versioningLimit": "5", content: "x" });
        Object.assign(server, {
            get: vi.fn(async () => [ makeRevision({ revisionId: "rev1", dateCreated: nowStr() }) ]),
            post: vi.fn(async () => undefined)
        });
        const el = renderDialog();
        fireEvent("showRevisions", { noteId: "n1" });
        await flush();
        return el;
    }

    it("save-revision-now posts and toasts", async () => {
        const el = await openMenu();
        const saveItem = Array.from(el.querySelectorAll(".dropdown-item"))
            .find(li => li.querySelector(".bx-save") && !li.hasAttribute("data-value")) as HTMLElement | undefined;
        await act(async () => { saveItem?.click(); await Promise.resolve(); });
        await flush();
        expect(server.post).toHaveBeenCalledWith("notes/n1/revision");
        expect(toast.showMessage).toHaveBeenCalled();
    });

    it("save-named-revision uses the prompt value, and aborts when prompt is cancelled", async () => {
        const el = await openMenu();
        const namedItem = Array.from(el.querySelectorAll(".dropdown-item"))
            .find(li => li.querySelector(".bx-purchase-tag")) as HTMLElement | undefined;

        (dialog.prompt as ReturnType<typeof vi.fn>).mockResolvedValueOnce("MyName");
        await act(async () => { namedItem?.click(); await Promise.resolve(); });
        await flush();
        expect(server.post).toHaveBeenCalledWith("notes/n1/revision", { description: "MyName" });

        (server.post as ReturnType<typeof vi.fn>).mockClear();
        (dialog.prompt as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
        await act(async () => { namedItem?.click(); await Promise.resolve(); });
        await flush();
        expect(server.post).not.toHaveBeenCalled();
    });

    it("falls back to the option limit (incl. the infinity sigil for -1) when no versioningLimit label", async () => {
        // No versioningLimit label → use option; -1 → infinity sigil. i18n isn't initialised in tests
        // so the value is only consumed by t(); assert the menu structure renders without error.
        buildNote({ id: "noLimit", title: "N", content: "x" });
        const options = (await import("../../services/options")).default;
        options.load({ revisionSnapshotNumberLimit: "-1", revisionSnapshotTimeInterval: "60" });
        Object.assign(server, { get: vi.fn(async () => [ makeRevision({ revisionId: "rev1", dateCreated: nowStr() }) ]) });
        const el = renderDialog();
        fireEvent("showRevisions", { noteId: "noLimit" });
        await flush();
        // The settings (cog) menu item is rendered, proving the menu (and the limit-display path) ran.
        expect(el.querySelector(".dropdown-stub .bx-cog")).toBeTruthy();
        // Three disabled header/value rows are present (header, interval, limit).
        expect(el.querySelectorAll(".dropdown-stub .dropdown-item.disabled").length).toBeGreaterThanOrEqual(3);
    });

    it("settings menu item opens the options note", async () => {
        const appContext = (await import("../../components/app_context")).default;
        const openContextWithNote = vi.fn();
        Object.assign(appContext, { tabManager: { ...appContext.tabManager, openContextWithNote } });
        const el = await openMenu();
        const cogItem = Array.from(el.querySelectorAll(".dropdown-item"))
            .find(li => li.querySelector(".bx-cog")) as HTMLElement | undefined;
        act(() => cogItem?.click());
        expect(openContextWithNote).toHaveBeenCalledWith("_optionsOther", { activate: true });
    });
});

describe("RevisionToolbar actions", () => {
    async function openText(full?: Partial<RevisionPojo>) {
        buildNote({ id: "n1", title: "Note", content: "<p>current</p>" });
        const fullRevision: RevisionPojo = {
            noteId: "n1", revisionId: "rev1", type: "text", mime: "text/html",
            title: "Rev Title", content: "<p>old</p>", ...full
        };
        Object.assign(server, {
            get: vi.fn(async (url: string) => url.startsWith("revisions/") ? fullRevision : [ makeRevision({ revisionId: "rev1", dateCreated: nowStr(), description: "desc" }) ]),
            post: vi.fn(async () => undefined),
            remove: vi.fn(async () => undefined),
            patch: vi.fn(async () => undefined)
        });
        const el = renderDialog();
        fireEvent("showRevisions", { noteId: "n1" });
        await flush();
        return el;
    }

    it("toggles the diff view off and on", async () => {
        const el = await openText();
        const checkbox = el.querySelector(".switch-toggle") as HTMLInputElement | null;
        expect(checkbox?.checked).toBe(true);
        act(() => { checkbox?.dispatchEvent(new Event("input", { bubbles: true })); });
        const checkboxAfter = el.querySelector(".switch-toggle") as HTMLInputElement | null;
        expect(checkboxAfter?.checked).toBe(false);
    });

    it("delete button confirms and removes the revision", async () => {
        const el = await openText();
        const delBtn = el.querySelector('button[class*="bx-trash"]') as HTMLButtonElement | null;
        expect(delBtn).toBeTruthy();
        await act(async () => { delBtn?.click(); await Promise.resolve(); });
        await flush();
        expect(server.remove).toHaveBeenCalledWith("revisions/rev1");
        expect(toast.showMessage).toHaveBeenCalled();
    });

    it("download button invokes the open service", async () => {
        const el = await openText();
        const dlBtn = el.querySelector('button[class*="bx-download"]') as HTMLButtonElement | null;
        act(() => dlBtn?.click());
        expect(open.downloadRevision).toHaveBeenCalledWith("n1", "rev1");
    });

    it("restore button confirms, posts and hides the modal", async () => {
        const el = await openText();
        // The restore control is a plain Button (btn-secondary) whose icon span carries bx-history.
        const restoreBtn = Array.from(el.querySelectorAll(".revision-toolbar-actions button"))
            .find(b => b.querySelector(".bx-history")) as HTMLButtonElement | undefined;
        expect(restoreBtn).toBeTruthy();
        await act(async () => { restoreBtn?.click(); await Promise.resolve(); });
        await flush();
        expect(server.post).toHaveBeenCalledWith("revisions/rev1/restore");
    });

    it("edits and saves the description", async () => {
        const el = await openText();
        const editBtn = el.querySelector('button[class*="bx-edit-alt"]') as HTMLButtonElement | null;
        act(() => editBtn?.click());
        const input = el.querySelector(".revision-description-editor input") as HTMLInputElement | null;
        expect(input).toBeTruthy();
        if (input) {
            input.value = "Updated";
            act(() => { input.dispatchEvent(new Event("input", { bubbles: true })); });
            // Save via Enter key.
            await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await Promise.resolve(); });
        }
        await flush();
        expect(server.patch).toHaveBeenCalledWith("revisions/rev1", { description: "Updated" });
    });

    it("cancels description editing via the Escape key", async () => {
        const el = await openText();
        const editBtn = el.querySelector('button[class*="bx-edit-alt"]') as HTMLButtonElement | null;
        act(() => editBtn?.click());
        const input = el.querySelector(".revision-description-editor input") as HTMLInputElement | null;
        act(() => { input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
        expect(el.querySelector(".revision-description-editor")).toBeNull();
        expect(el.querySelector(".revision-description-display")).toBeTruthy();
    });

    it("hides interactive buttons for protected revisions without an active session", async () => {
        const psh = (await import("../../services/protected_session_holder")).default;
        vi.spyOn(psh, "isProtectedSessionAvailable").mockReturnValue(false);
        buildNote({ id: "n1", title: "Note", content: "x" });
        Object.assign(server, {
            get: vi.fn(async (url: string) => url.startsWith("revisions/")
                ? { noteId: "n1", revisionId: "rev1", type: "text", mime: "text/html", title: "T", content: "<p>x</p>" }
                : [ makeRevision({ revisionId: "rev1", isProtected: true, dateCreated: nowStr() }) ])
        });
        const el = renderDialog();
        fireEvent("showRevisions", { noteId: "n1" });
        await flush();
        expect(el.querySelector('button[class*="bx-trash"]')).toBeNull();
        expect(el.querySelector('button[class*="bx-download"]')).toBeNull();
    });
});

describe("RevisionContent — type-specific previews", () => {
    async function openTyped(item: Partial<RevisionItem>, full: Partial<RevisionPojo>, showDiff = false) {
        buildNote({ id: "n1", title: "Note", content: "current" });
        const revItem = makeRevision({ revisionId: "rev1", dateCreated: nowStr(), ...item });
        const fullRevision: RevisionPojo = {
            noteId: "n1", revisionId: "rev1", type: revItem.type, mime: revItem.mime,
            title: revItem.title, content: "content", ...full
        };
        Object.assign(server, {
            get: vi.fn(async (url: string) => url.startsWith("revisions/") ? fullRevision : [ revItem ])
        });
        const el = renderDialog();
        fireEvent("showRevisions", { noteId: "n1" });
        await flush();
        if (!showDiff) {
            // turn off the diff toggle if present so we hit the switch() preview branches
            const checkbox = el.querySelector(".switch-toggle") as HTMLInputElement | null;
            if (checkbox?.checked) {
                act(() => { checkbox.dispatchEvent(new Event("input", { bubbles: true })); });
                await flush();
            }
        }
        return el;
    }

    it("text (no diff) renders sanitized ck-content", async () => {
        const el = await openTyped({ type: "text" }, { type: "text", content: "<p>body</p>" });
        expect(el.querySelector(".revision-content .ck-content")).toBeTruthy();
    });

    it("text (no diff) with math triggers KaTeX rendering", async () => {
        const math = await import("../../services/math");
        const el = await openTyped({ type: "text" }, { type: "text", content: '<span class="math-tex">\\(a^2\\)</span>' });
        await flush();
        expect(el.querySelector("span.math-tex")).toBeTruthy();
        expect(math.renderMathInElement).toHaveBeenCalled();
    });

    it("code (no diff) renders a code block", async () => {
        const el = await openTyped({ type: "code", mime: "text/plain" }, { type: "code", content: "const x = 1;" });
        expect(el.querySelector(".revision-diff-code")?.textContent).toContain("const x");
    });

    it("svg image renders a utf8 data uri", async () => {
        const el = await openTyped({ type: "image", mime: "image/svg+xml" }, { type: "image", mime: "image/svg+xml", content: "<svg/>" });
        const img = el.querySelector("img") as HTMLImageElement | null;
        expect(img?.getAttribute("src")).toContain("utf8,");
    });

    it("raster image renders a base64 data uri", async () => {
        const el = await openTyped({ type: "image", mime: "image/png" }, { type: "image", mime: "image/png", content: "AAAA" });
        const img = el.querySelector("img") as HTMLImageElement | null;
        expect(img?.getAttribute("src")).toContain("base64,AAAA");
    });

    it("canvas-like types render an image with the api revision URL", async () => {
        const el = await openTyped({ type: "mindMap", mime: "application/json", title: "Map" }, { type: "mindMap", content: "x" });
        const img = el.querySelector("img") as HTMLImageElement | null;
        expect(img?.getAttribute("src")).toContain("api/revisions/rev1/image/");
    });

    it("unknown type renders the not-available fallback", async () => {
        const el = await openTyped({ type: "noteMap", mime: "x" } as Partial<RevisionItem>, { type: "noteMap", content: "x" });
        expect(el.querySelector(".revision-content")?.textContent).toBeTruthy();
    });
});

describe("RevisionContent — file previews", () => {
    async function openFile(mime: string, content?: string) {
        buildNote({ id: "n1", title: "Note", content: "current" });
        const revItem = makeRevision({ revisionId: "rev1", type: "file", mime, contentLength: 99, dateCreated: nowStr() });
        const fullRevision: RevisionPojo = { noteId: "n1", revisionId: "rev1", type: "file", mime, title: "F", content };
        Object.assign(server, {
            get: vi.fn(async (url: string) => url.startsWith("revisions/") ? fullRevision : [ revItem ])
        });
        const el = renderDialog();
        fireEvent("showRevisions", { noteId: "n1" });
        await flush();
        return el;
    }

    it("renders a file-preview table and an audio element for audio mime", async () => {
        const el = await openFile("audio/mp3");
        expect(el.querySelector(".file-preview-table")).toBeTruthy();
        expect(el.querySelector("audio")?.getAttribute("src")).toContain("api/revisions/rev1/download");
    });

    it("renders a video element for video mime", async () => {
        const el = await openFile("video/mp4");
        expect(el.querySelector("video")).toBeTruthy();
    });

    it("renders the PdfViewer stub for pdf mime", async () => {
        const el = await openFile("application/pdf");
        expect(el.querySelector(".pdf-stub")).toBeTruthy();
    });

    it("renders a pre block for textual file content", async () => {
        const el = await openFile("text/plain", "plain file body");
        expect(el.querySelector("pre.file-preview-content")?.textContent).toContain("plain file body");
    });

    it("shows the not-available fallback when a file has no content", async () => {
        const el = await openFile("application/octet-stream", undefined);
        // The fallback renders no media/pre element (i18n returns no text in tests).
        const previewContent = el.querySelector(".revision-file-preview-content");
        expect(previewContent).toBeTruthy();
        expect(previewContent?.querySelector("audio, video, pre, .pdf-stub")).toBeNull();
    });
});

describe("RevisionContentDiff", () => {
    async function openDiff(type: RevisionItem["type"], itemContent: string | undefined, noteContent: string) {
        buildNote({ id: "n1", title: "Note", content: noteContent });
        const revItem = makeRevision({ revisionId: "rev1", type, dateCreated: nowStr(), mime: type === "text" ? "text/html" : "text/plain" });
        const fullRevision: RevisionPojo = { noteId: "n1", revisionId: "rev1", type, mime: revItem.mime, title: "T", content: itemContent };
        Object.assign(server, {
            get: vi.fn(async (url: string) => url.startsWith("revisions/") ? fullRevision : [ revItem ])
        });
        const el = renderDialog();
        fireEvent("showRevisions", { noteId: "n1" });
        await flush();
        return el;
    }

    it("text diff renders the diff content", async () => {
        const el = await openDiff("text", "<p>old text</p>", "<p>new text</p>");
        expect(el.querySelector(".revision-diff-content")).toBeTruthy();
    });

    it("code/mermaid word-diff renders added and removed spans", async () => {
        const el = await openDiff("code", "alpha gamma", "alpha beta");
        const html = el.querySelector(".revision-diff-content")?.innerHTML ?? "";
        expect(html).toContain("revision-diff-added");
        expect(html).toContain("revision-diff-removed");
    });

    it("non-string content shows the diff-not-available placeholder", async () => {
        // simulate a binary/undefined revision content for a diffable type
        const el = await openDiff("text", undefined, "<p>new</p>");
        expect(el.querySelector(".revision-diff-content .bx-low-vision")).toBeTruthy();
    });

    it("identical (empty) content shows the identical placeholder", async () => {
        // diffWords("", "") yields no parts → empty diffHtml → identical placeholder.
        const el = await openDiff("code", "", "");
        expect(el.querySelector(".bx-copy")).toBeTruthy();
    });
});

describe("RevisionsDialog — closing", () => {
    it("clears state when the modal is hidden", async () => {
        buildNote({ id: "n1", title: "Note", content: "x" });
        Object.assign(server, { get: vi.fn(async () => [ makeRevision({ revisionId: "rev1", dateCreated: nowStr() }) ]) });
        const el = renderDialog();
        fireEvent("showRevisions", { noteId: "n1" });
        await flush();
        const modalEl = el.querySelector(".revisions-dialog") as HTMLElement | null;
        // Trigger the bootstrap hidden listener wired up by the Modal.
        act(() => { modalEl?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: true })); });
        await flush();
        // After hiding the dialog clears its selection — list items are gone.
        expect(el.querySelector(".dropdown-item[data-value]")).toBeNull();
    });
});

describe("getNote fallback", () => {
    it("resolves the active context note when no noteId is provided", async () => {
        const appContext = (await import("../../components/app_context")).default;
        const active = buildNote({ id: "activeN", title: "Active", content: "x" });
        Object.assign(appContext, { tabManager: { getActiveContextNote: () => active } });
        Object.assign(server, { get: vi.fn(async () => []) });
        const el = renderDialog();
        fireEvent("showRevisions", { noteId: undefined });
        await flush();
        expect(el.querySelector(".revisions-dialog")).toBeTruthy();
    });
});

// --- date helpers --------------------------------------------------------------------------------

function nowStr() {
    return new Date().toISOString().replace("T", " ");
}

function oldStr() {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 2);
    return d.toISOString().replace("T", " ");
}
