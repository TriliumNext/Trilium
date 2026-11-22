import VanillaCodeMirror from "@triliumnext/codemirror";
import { getChangeRecord } from "@triliumnext/codemirror/src/extensions/block_markers";
import { generateBlockId } from "@triliumnext/commons/src/lib/block_reference.js";
import { indexMarkdownBlocks } from "@triliumnext/commons/src/lib/markdown_block_index.js";
import {
    insertHtmlBlock, placeMarkerOnBlock
} from "@triliumnext/commons/src/lib/markdown_references.js";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext, { type CommandNames } from "../../../components/app_context";
import type FNote from "../../../entities/fnote";
import contextMenu, { type MenuItem } from "../../../menus/context_menu";
import { copyHtmlWithToast } from "../../../services/clipboard_ext";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import type { ChangeRecordHooks } from "../../../services/note_save";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { buildNote } from "../../../test/easy-froca";
import type { EditLinkOpts } from "../../dialogs/edit_link";
import { noteSavedDataStore } from "../../react/NoteStore";
import {
    copyMarkdownReference, getMarkdownHeadingTarget, getMarkdownReferenceSource,
    getSavedMarkdownHeadingTarget, getSelectedBlocks, isMarkdownHeadingId,
    type MarkdownReferenceSource, PREVIEW_BLOCK_HOST, revealInSource, useBlockMarkers
} from "./editor_block_references";
import { buildMarkdownReferenceMenuItems } from "./block_reference_menu";
import {
    getOwnLinkTargets, insertWithMarker, showEditLinkDialog, takePendingMarker
} from "./editor_utils";

// happy-dom's DOM makes DOMPurify drop headings, which a browser keeps.
vi.mock("dompurify", () => ({ default: { sanitize: (html: string) => html, addHook: () => {} } }));
vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/i18n")>(),
    t: vi.fn((key: string) => key)
}));
vi.mock("../../../services/clipboard_ext", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../../services/clipboard_ext")>();
    return { toReferenceLinkHtml: original.toReferenceLinkHtml, copyHtmlWithToast: vi.fn() };
});
vi.mock("@triliumnext/commons/src/lib/block_reference.js", async (importOriginal) => {
    const original =
        await importOriginal<typeof import("@triliumnext/commons/src/lib/block_reference.js")>();
    return { ...original, generateBlockId: vi.fn(original.generateBlockId) };
});
vi.mock("@triliumnext/commons/src/lib/markdown_references.js", async (importOriginal) => {
    const original = await importOriginal<
        typeof import("@triliumnext/commons/src/lib/markdown_references.js")
    >();
    return {
        ...original,
        insertHtmlBlock: vi.fn(original.insertHtmlBlock),
        placeMarkerOnBlock: vi.fn(original.placeMarkerOnBlock)
    };
});

const marker = (id: string) => `<a data-trilium-block-id="${id}"></a>`;
const ID = /[A-Za-z0-9]{12}/;

let editor: VanillaCodeMirror | undefined;
const unmounts: (() => void)[] = [];

beforeEach(() => {
    vi.spyOn(toast, "showError").mockImplementation(() => {});
    vi.spyOn(toast, "showMessage").mockImplementation(() => {});
});

afterEach(() => {
    for (const unmount of unmounts.splice(0)) unmount();
    editor?.destroy();
    editor = undefined;
    vi.restoreAllMocks();
    vi.mocked(copyHtmlWithToast).mockClear();
    vi.mocked(t).mockClear();
    vi.mocked(generateBlockId).mockReset();
    vi.mocked(insertHtmlBlock).mockReset();
    vi.mocked(placeMarkerOnBlock).mockReset();
});

describe("useBlockMarkers", () => {
    it("draws the markers and lists the targets of the document, until unmounted", async () => {
        const view = await createEditor(`# Title\n\n## Owned ${marker("o")}\n\n`
            + `Copy ${marker("o")} <a id="z"></a> <a id="a"></a>`);
        const { unmount } = mount(view, createSource());

        expect(view.dom.querySelectorAll(".cm-block-marker")).toHaveLength(2);
        // Once read, the marker whose id an earlier block owns is dimmed.
        await vi.waitFor(() => expect(view.dom.querySelector(".cm-block-marker.inert")
            ?.getAttribute("title")).toBe("block_reference.inert_marker"));
        expect(view.dom.querySelector(".cm-block-marker")?.getAttribute("title")).toBe("o");
        expect(getOwnLinkTargets(view, "root/n")?.map(({ kind, title, level, params }) =>
            [ kind, title, level, params ])).toEqual([
            [ "heading", "Title", 1, undefined ],
            [ "heading", "Owned", 2, { block: "o" } ],
            [ "anchor", "a", undefined, { bookmark: "a" } ],
            [ "anchor", "z", undefined, { bookmark: "z" } ]
        ]);
        expect(getMarkdownReferenceSource(view)).toBeDefined();

        unmount();
        expect(getOwnLinkTargets(view, "root/n")).toBeUndefined();
        expect(getMarkdownReferenceSource(view)).toBeUndefined();
        expect(view.dom.querySelectorAll(".cm-block-marker")).toHaveLength(0);
    });

    it("shows no id in the title of a marker whose id is not valid", async () => {
        const view = await createEditor(`Text ${marker("a:b")}`);
        mount(view);

        // Until the markers are read, every marker counts as effective.
        expect(view.dom.querySelector(".cm-block-marker")?.getAttribute("title")).toBe("");
        await vi.waitFor(() =>
            expect(view.dom.querySelector(".cm-block-marker.inert")).not.toBeNull());
        expect(t).toHaveBeenCalledWith("block_reference.inert_marker", { id: "" });
    });

    it("gives a heading picked from the list an id for its link, wherever it is", async () => {
        const view = await createEditor(`Intro\n\n## Setup\n\n## Kept ${marker("k")}`);
        mount(view);
        const [ setup, kept ] = getOwnLinkTargets(view, "root/n") ?? [];

        // The query typed after the list opened moves the heading down.
        view.dispatch({ changes: { from: 0, insert: "New " } });
        const path = setup.createLinkPath();
        const id = /block=(\w+)$/.exec(path)?.[1] ?? "";
        expect(path).toMatch(new RegExp(`^root/n\\?block=${ID.source}$`));
        const pending = takePendingMarker(view);
        expect(pending).toEqual({ from: 19, to: 19, insert: ` ${marker(id)}` });
        expect(takePendingMarker(view)).toBeUndefined();

        // A heading with an id links at once.
        expect(kept.createLinkPath()).toBe("root/n?block=k");
        expect(takePendingMarker(view)).toBeUndefined();

        // The marker goes in first, outside the history, then the link.
        insertWithMarker(view, pending ?? undefined, { from: 4, to: 4, insert: "[[n]]" });
        expect(view.state.doc.toString()).toBe(`New [[n]]Intro\n\n## Setup ${marker(id)}\n\n`
            + `## Kept ${marker("k")}`);
        expect(view.state.selection.main.head).toBe(9);
    });

    it("declines a heading that is gone or retitled, or a link over its marker", async () => {
        const view = await createEditor("## Setup\n\n## Other");
        mount(view);
        const [ setup, other ] = getOwnLinkTargets(view, "root/n") ?? [];

        view.dispatch({ changes: { from: 3, to: 8, insert: "Renamed" } });
        expect(setup.createLinkPath()).toBe("root/n");
        expect(toast.showError).toHaveBeenCalledWith("add_link.listing_changed");
        expect(takePendingMarker(view)).toBeNull();

        const path = other.createLinkPath();
        const pending = takePendingMarker(view);
        expect(path).toContain("?block=");
        const doc = view.state.doc.toString();
        insertWithMarker(view, pending ?? undefined, { from: 20, to: 20, insert: "[[n]]" });
        expect(toast.showError).toHaveBeenLastCalledWith("add_link.heading_reference_failed");
        expect(view.state.doc.toString()).toBe(doc);

        // A list read later tracks its own places; a heading given an id meanwhile links to it.
        const [ renamed ] = getOwnLinkTargets(view, "root/n") ?? [];
        const [ again ] = getOwnLinkTargets(view, "root/n") ?? [];
        expect(renamed.createLinkPath()).toBe("root/n");
        view.dispatch({ changes: { from: 10, insert: ` ${marker("r")}` } });
        expect(again.createLinkPath()).toBe("root/n?block=r");
        expect(takePendingMarker(view)).toBeUndefined();
    });

    it("declines a heading whose section was replaced by one of the same title", async () => {
        const view = await createEditor("## Status\n\nBudget\n\n## Other");
        mount(view);
        const [ status ] = getOwnLinkTargets(view, "root/n") ?? [];

        view.dispatch({ changes: { from: 0, to: 17, insert: "## Status\n\nHiring" } });
        expect(status.createLinkPath()).toBe("root/n");
        expect(toast.showError).toHaveBeenCalledWith("add_link.listing_changed");
        expect(takePendingMarker(view)).toBeNull();
    });

    it("declines a heading that is no longer one, or for which no id can be drawn", async () => {
        const view = await createEditor("## Setup\n\n## Other");
        mount(view);
        const [ setup, other ] = getOwnLinkTargets(view, "root/n") ?? [];

        // Text typed before `##` keeps the listed text, and makes the line a paragraph.
        view.dispatch({ changes: { from: 0, insert: "x" } });
        expect(setup.createLinkPath()).toBe("root/n");
        expect(toast.showError).toHaveBeenLastCalledWith("add_link.listing_changed");
        expect(takePendingMarker(view)).toBeNull();

        // Every id drawn is already in the note.
        vi.mocked(generateBlockId).mockReturnValue("Other");
        expect(other.createLinkPath()).toBe("root/n");
        expect(toast.showError).toHaveBeenLastCalledWith("add_link.heading_reference_failed");
        expect(takePendingMarker(view)).toBeNull();
    });

    it("lists the headings of the note in the link dialog, links one with its marker", async () => {
        const view = await createEditor("## Setup\n\nSee <a id=\"top\"></a>");
        mount(view);
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        view.dispatch({ selection: { anchor: 14 } });
        showEditLinkDialog(view, { noteId: "n", notePath: "root/n" });
        const opts = triggerCommand.mock.lastCall?.[1] as EditLinkOpts;
        expect(opts).toMatchObject({ noteId: "n", anchors: [ "top" ] });
        expect(opts.headings?.map(({ title }) => title)).toEqual([ "Setup" ]);

        // The text typed before the link moves the place of the link.
        view.dispatch({ changes: { from: 10, insert: "Now " } });
        const path = opts.headings?.[0].createLinkPath() ?? "";
        await opts.addLink(path, null);
        const id = /block=(\w+)$/.exec(path)?.[1] ?? "";
        expect(view.state.doc.toString())
            .toBe(`## Setup ${marker(id)}\n\nNow See [[n?block=${id}]]<a id="top"></a>`);

        // Without a place for the link, nothing is inserted.
        showEditLinkDialog(view, { noteId: "n", notePath: "root/n" });
        const later = triggerCommand.mock.lastCall?.[1] as EditLinkOpts;
        getOwnLinkTargets(view, "root/n");
        view.dispatch({ changes: { from: 0, insert: "x" } });
        const doc = view.state.doc.toString();
        await later.addLink("root/other", null);
        expect(view.state.doc.toString()).toBe(doc);
        expect(toast.showError).toHaveBeenLastCalledWith("add_link.listing_changed");
    });

    it("keeps text typed at either end of the selected text outside the link", async () => {
        const view = await createEditor("## Setup\n\nSee here");
        mount(view);
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        view.dispatch({ selection: { anchor: 10, head: 13 } });
        showEditLinkDialog(view, { noteId: "n", notePath: "root/n" });
        const opts = triggerCommand.mock.lastCall?.[1] as EditLinkOpts;

        view.dispatch({ changes: [ { from: 10, insert: "Now " }, { from: 13, insert: "!" } ] });
        await opts.addLink("root/other", null);
        expect(view.state.doc.toString()).toBe("## Setup\n\nNow [[other]]! here");
    });

    it("takes over an id that another writer gave a block that continues here", async () => {
        const view = await createEditor("## Alpha\n\nOmega");
        const { hooks } = mount(view, createSource());
        // A paragraph inserted right after the heading, then a save that is refused.
        view.dispatch({ changes: { from: 8, insert: "\n\nInserted" } });
        hooks.onDataTaken();
        view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });

        const current = `## Alpha ${marker("x")}\n\nOmega`;
        expect(hooks.resolveConflict({ blobId: "b", content: current })).toBe(true);
        expect(view.state.doc.toString()).toBe(`## Alpha ${marker("x")}\n\nInserted\n\nOmega!`);
        const record = getChangeRecord(view.state);
        expect(record.base.toString()).toBe(current);
        expect(record.changes.apply(record.base).toString()).toBe(view.state.doc.toString());

        // A save that went through starts the record from the content it took.
        hooks.onDataTaken();
        hooks.dataSaved();
        expect(getChangeRecord(view.state).base.toString()).toBe(view.state.doc.toString());
    });

    it("takes nothing over after more changes elsewhere, or a block that ended", async () => {
        const cases: [ string, (view: VanillaCodeMirror) => void, string ][] = [
            // The other writer also changed the text.
            [ "## Alpha\n\nOmega", () => {}, `## Alpha ${marker("x")}\n\nOmega and more` ],
            // The editor split, deleted, and joined the block.
            [ "## Alpha\n\nOmega",
                (view) => view.dispatch({ changes: { from: 5, insert: "\n\n" } }),
                `## Alpha ${marker("x")}\n\nOmega` ],
            [ "Alpha\n\nOmega", (view) => view.dispatch({ changes: { from: 0, to: 7 } }),
                `Alpha ${marker("x")}\n\nOmega` ],
            [ "Alpha\n\nOmega", (view) => view.dispatch({ changes: { from: 5, to: 7 } }),
                `Alpha ${marker("x")}\n\nOmega` ]
        ];

        for (const [ base, edit, current ] of cases) {
            const view = await createEditor(base);
            const { hooks } = mount(view, createSource());
            edit(view);
            const doc = view.state.doc.toString();
            expect(hooks.resolveConflict({ blobId: "b", content: current }), current).toBe(false);
            expect(view.state.doc.toString()).toBe(doc);
        }
    });

    it("takes over a version that gives the blocks the ids they already have", async () => {
        const view = await createEditor("## Alpha\n\nOmega");
        const { hooks } = mount(view, createSource());
        view.dispatch({ changes: { from: 8, insert: ` ${marker("x")}` } });
        hooks.onDataTaken();
        view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });

        const current = `## Alpha ${marker("x")}\n\nOmega`;
        expect(hooks.resolveConflict({ blobId: "b", content: current })).toBe(true);
        expect(view.state.doc.toString()).toBe(`## Alpha ${marker("x")}\n\nOmega!`);
        expect(getChangeRecord(view.state).base.toString()).toBe(current);
    });

    it("takes nothing over when a placed marker leaves its id without a block", async () => {
        const view = await createEditor("## Alpha\n\nOmega");
        const { hooks } = mount(view, createSource());
        view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
        // A placement whose edit gives the id to no block.
        vi.mocked(placeMarkerOnBlock)
            .mockReturnValueOnce({ id: "x", change: { from: 0, to: 0, insert: "" } });

        const current = `## Alpha ${marker("x")}\n\nOmega`;
        expect(hooks.resolveConflict({ blobId: "b", content: current })).toBe(false);
        expect(view.state.doc.toString()).toBe("## Alpha\n\nOmega!");
    });

    it("records nothing for a save taken while there is no editor", () => {
        const { hooks } = mount(null, createSource());

        hooks.onDataTaken();
        expect(hooks.resolveConflict({ blobId: "b", content: "Text" })).toBe(false);
    });
});

describe("getSelectedBlocks", () => {
    it("takes the leaf blocks that the selection covers, or the one at the caret", async () => {
        const view = await createEditor("First\n\nSecond\n\n> Quoted\n\nLast");
        const index = indexMarkdownBlocks(view.state.doc.toString(), PREVIEW_BLOCK_HOST);
        const select = (anchor: number, head = anchor) => {
            view.dispatch({ selection: { anchor, head } });
            const selected = getSelectedBlocks(view, index);
            return selected && [ selected.start.key.text, selected.end.key.text, selected.count ];
        };

        expect(select(2, 10)).toEqual([ "First", "Second", 2 ]);
        // A selection that ends at the start of a line leaves that line out.
        expect(select(0, 7)).toEqual([ "First", "First", 1 ]);
        expect(select(0, view.state.doc.length)).toEqual([ "First", "Last", 4 ]);
        // A caret on a blank line takes the block after it, else the one before.
        expect(select(6)).toEqual([ "Second", "Second", 1 ]);
        const end = await createEditor("Only\n\n");
        const endIndex = indexMarkdownBlocks(end.state.doc.toString(), PREVIEW_BLOCK_HOST);
        end.dispatch({ selection: { anchor: 6 } });
        expect(getSelectedBlocks(end, endIndex)?.start.key.text).toBe("Only");
        expect(getSelectedBlocks(end, indexMarkdownBlocks("", PREVIEW_BLOCK_HOST))).toBeNull();
    });
});

describe("copyMarkdownReference", () => {
    it("gives both ends ids in one undo step, saves, and copies a reference link", async () => {
        const view = await createEditor("First\n\nSecond\n\n## Third");
        const preview = document.createElement("div");
        Object.defineProperty(preview, "clientHeight", { value: 100 });
        mount(view, createSource(preview));
        saveOnRequest(view, preview);

        const index = indexMarkdownBlocks(view.state.doc.toString(), PREVIEW_BLOCK_HOST);
        const [ first, , third ] = index.blocks;
        await copyMarkdownReference(view, first, third);

        const doc = view.state.doc.toString();
        const [ startId, endId ] = [ ...doc.matchAll(/data-trilium-block-id="(\w+)"/g) ]
            .map((match) => match[1]);
        expect(doc).toBe(`First ${marker(startId)}\n\nSecond\n\n## Third ${marker(endId)}`);
        expect(view.dom.querySelectorAll(".cm-block-flash")).toHaveLength(5);
        expect(preview.querySelectorAll(".block-reference-flash")).toHaveLength(3);
        const [ html, href ] = vi.mocked(copyHtmlWithToast).mock.lastCall ?? [];
        expect(href).toBe(`#root/n?block=${startId}:${endId}`);
        expect(html).toBe(`<a class="reference-link" href="${href}">Doc - First … Third</a>`);

        // A block that has an id resolving to it keeps it.
        await copyMarkdownReference(view, first, first);
        expect(vi.mocked(copyHtmlWithToast).mock.lastCall?.[1]).toBe(`#root/n?block=${startId}`);
        expect(view.state.doc.toString()).toBe(doc);
    });

    it("copies nothing when the note is not saved or the blocks cannot take ids", async () => {
        const view = await createEditor("First\n\nSecond");
        mount(view, createSource());
        noteSavedDataStore.set("n", "");
        vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);
        const [ first ] = indexMarkdownBlocks(view.state.doc.toString(), PREVIEW_BLOCK_HOST).blocks;

        await copyMarkdownReference(view, first, first);
        expect(toast.showError).toHaveBeenCalledWith("block_reference.copy_failed");
        expect(copyHtmlWithToast).not.toHaveBeenCalled();

        // Raw HTML whose id an earlier block owns takes no marker.
        const raw = await createEditor(
            `Text ${marker("x")}\n\n<div data-trilium-block-id="x">\n\n</div>`
        );
        mount(raw, createSource());
        const blocks = indexMarkdownBlocks(raw.state.doc.toString(), PREVIEW_BLOCK_HOST).blocks;
        await copyMarkdownReference(raw, blocks[1], blocks[1]);
        expect(copyHtmlWithToast).not.toHaveBeenCalled();

        // An editor without a note copies nothing either.
        const bare = await createEditor("Text");
        mount(bare);
        await copyMarkdownReference(bare, blocks[0], blocks[0]);
        expect(bare.state.doc.toString()).toBe("Text");
    });

    it("copies nothing for a range whose end comes before its start", async () => {
        const view = await createEditor("First\n\nSecond");
        mount(view, createSource());
        saveOnRequest(view);
        const [ first, second ] = indexMarkdownBlocks(view.state.doc.toString(), PREVIEW_BLOCK_HOST)
            .blocks;

        await copyMarkdownReference(view, second, first);
        expect(toast.showError).toHaveBeenCalledWith("block_reference.copy_failed");
        expect(view.state.doc.toString()).toBe("First\n\nSecond");
        expect(copyHtmlWithToast).not.toHaveBeenCalled();
    });

    it("draws another id for the end of a range when a draw repeats the start's", async () => {
        const view = await createEditor("First\n\nSecond");
        mount(view, createSource());
        saveOnRequest(view);
        vi.mocked(generateBlockId).mockReturnValueOnce("same")
            .mockReturnValueOnce("same")
            .mockReturnValueOnce("other");
        const [ first, second ] = indexMarkdownBlocks(view.state.doc.toString(), PREVIEW_BLOCK_HOST)
            .blocks;

        await copyMarkdownReference(view, first, second);
        expect(view.state.doc.toString())
            .toBe(`First ${marker("same")}\n\nSecond ${marker("other")}`);
        expect(vi.mocked(copyHtmlWithToast).mock.lastCall?.[1]).toBe("#root/n?block=same:other");
    });

    it("saves through the source of an embedded editor, and links to its note", async () => {
        const view = await createEditor("First\n\nSecond");
        const note = { noteId: "embedded", title: "Embedded" } as FNote;
        let isSaved = true;
        const save = vi.fn(async () => (isSaved ? view.state.doc.toString() : undefined));
        mount(view, {
            getNote: () => note, getNotePath: () => "root/embedded", getPreview: () => null, save
        });
        const triggerEvent = vi.spyOn(appContext, "triggerEvent");
        const [ first ] = indexMarkdownBlocks(view.state.doc.toString(), PREVIEW_BLOCK_HOST).blocks;

        await copyMarkdownReference(view, first, first);
        const id = /data-trilium-block-id="(\w+)"/.exec(view.state.doc.toString())?.[1];
        expect(save).toHaveBeenCalledOnce();
        expect(triggerEvent).not.toHaveBeenCalled();
        expect(vi.mocked(copyHtmlWithToast).mock.lastCall?.[1]).toBe(`#root/embedded?block=${id}`);

        // A save that leaves the changes waiting copies nothing.
        isSaved = false;
        const [ , second ] = indexMarkdownBlocks(view.state.doc.toString(), PREVIEW_BLOCK_HOST)
            .blocks;
        await copyMarkdownReference(view, second, second);
        expect(save).toHaveBeenCalledTimes(2);
        expect(toast.showError).toHaveBeenCalledWith("block_reference.copy_failed");
        expect(copyHtmlWithToast).toHaveBeenCalledOnce();
    });
});

describe("getMarkdownHeadingTarget", () => {
    /** Mocks the read of the live note: `content`, or a function of the document of `view`. */
    function answerLiveNote(content: string | ((doc: string) => string), view: VanillaCodeMirror) {
        vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);
        return vi.spyOn(server, "getWithSilentErrors").mockImplementation(async () => ({
            blobId: "b",
            content: typeof content === "string" ? content : content(view.state.doc.toString())
        }));
    }

    it("gives a heading a marker outside the history, once the saved note holds it", async () => {
        const view = await createEditor("# Title\n\n## Setup");
        view.clearHistory();
        const read = answerLiveNote((doc) => doc, view);

        const target = getMarkdownHeadingTarget(view, 3, "root/n", "n");
        expect(target).toMatchObject({ kind: "heading", title: "Setup", level: 2 });
        expect(view.state.doc.toString()).toBe("# Title\n\n## Setup");
        await target?.createReference?.();
        const id = target?.params?.block ?? "";
        expect(id).toMatch(ID);
        expect(view.state.doc.toString()).toBe(`# Title\n\n## Setup ${marker(id)}`);
        view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
            key: "z", ctrlKey: true, bubbles: true, cancelable: true
        }));
        expect(view.state.doc.toString()).toBe(`# Title\n\n## Setup ${marker(id)}`);
        expect(read).toHaveBeenCalledExactlyOnceWith("notes/n/blob");
        expect(target?.createLinkPath()).toBe(`root/n?block=${id}`);

        // An owned id goes through the same check.
        const owned = getMarkdownHeadingTarget(view, 3, "root/n", "n");
        await owned?.createReference?.();
        expect(owned?.params).toStrictEqual({ block: id });
        expect(read).toHaveBeenCalledTimes(2);
    });

    it("copies nothing for an id the live note lacks, or a document that changed", async () => {
        const view = await createEditor(`## Owned ${marker("o")}\n\n## Setup`);
        answerLiveNote("## Owned\n\n## Setup", view);

        const owned = getMarkdownHeadingTarget(view, 1, "root/n", "n");
        await expect(owned?.createReference?.()).rejects.toThrow();
        expect(owned?.params).toBeUndefined();

        const setup = getMarkdownHeadingTarget(view, 3, "root/n", "n");
        view.dispatch({ changes: { from: 0, insert: "Intro\n\n" } });
        const changed = view.state.doc.toString();
        await expect(setup?.createReference?.()).rejects.toThrow();
        expect(view.state.doc.toString()).toBe(changed);
    });

    it("has no target for a line without a heading, or a heading that takes no id", async () => {
        const view = await createEditor("Text\n\n<h2>Raw</h2>\n\n## Setup");

        expect(getMarkdownHeadingTarget(view, 1, "root/n", "n")).toBeNull();
        expect(getMarkdownHeadingTarget(view, 3, "root/n", "n")).toBeNull();
        expect(getMarkdownHeadingTarget(view, 4, "root/n", "n")).toBeNull();
        expect(isMarkdownHeadingId(`## A ${marker("a")}\n\nB ${marker("b")}`, "a")).toBe(true);
        expect(isMarkdownHeadingId(`## A ${marker("a")}\n\nB ${marker("b")}`, "b")).toBe(false);
    });
});

describe("getSavedMarkdownHeadingTarget", () => {
    it("posts the line and the title of the heading picked, in the blob shown", async () => {
        const content = "## Install\n\nText\n\n## Install";
        vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);
        const post = vi.spyOn(server, "postWithSilentErrors")
            .mockResolvedValue({ params: { block: "second" } });

        const target = getSavedMarkdownHeadingTarget("n", "root/n", content, 5, "shown");
        expect(target).toMatchObject({ kind: "heading", title: "Install" });
        await target?.createReference?.();
        expect(post).toHaveBeenCalledExactlyOnceWith("notes/n/references", {
            kind: "heading", line: 5, title: "Install", blobId: "shown"
        });
        expect(target?.createLinkPath()).toBe("root/n?block=second");

        expect(getSavedMarkdownHeadingTarget("n", "root/n", content, 3, "shown")).toBeNull();
        expect(getSavedMarkdownHeadingTarget("n", "root/n", content, 4, "shown")).toBeNull();
    });
});

describe("revealInSource", () => {
    it("highlights the lines of the blocks or the anchor of a link, and clears it", async () => {
        const view = await createEditor(
            `A <a id="top"></a>\n\nB ${marker("b")}\n\nC ${marker("c")}`
        );
        mount(view);
        const flashed = () => [ ...view.dom.querySelectorAll(".cm-block-flash") ]
            .map((line) => line.textContent?.charAt(0));

        const range = { block: "c:b" };
        revealInSource(view, range, { isFlashed: true, isConsumed: true });
        expect(flashed()).toEqual([ "B", "", "C" ]);
        expect(range.block).toBeUndefined();

        const kept = { block: "b" };
        revealInSource(view, kept, { isFlashed: false, isConsumed: false });
        expect(kept.block).toBe("b");

        const bookmark = { bookmark: "top" };
        revealInSource(view, bookmark, { isFlashed: true, isConsumed: true });
        expect(flashed()).toEqual([ "A" ]);
        expect(bookmark.bookmark).toBeUndefined();

        revealInSource(view, { block: "b:gone" }, { isFlashed: true, isConsumed: true });
        expect(flashed()).toEqual([ "B" ]);
        expect(toast.showError).toHaveBeenCalledWith("block_reference.not_found");
        revealInSource(view, { block: "a:b:c" }, { isFlashed: true, isConsumed: true });
        revealInSource(view, { bookmark: "gone" }, { isFlashed: true, isConsumed: true });
        expect(toast.showError).toHaveBeenCalledTimes(2);

        // A link with neither parameter moves to nothing.
        revealInSource(view, {}, { isFlashed: true, isConsumed: true });
        expect(flashed()).toEqual([ "B" ]);
        expect(toast.showError).toHaveBeenCalledTimes(2);
    });
});

describe("the menu of a marker", () => {
    it("copies a reference to the block of a marker, or removes the marker", async () => {
        const view = await createEditor(`${marker("a")}\n\n## Heading\n\nText ${marker("b")}`);
        mount(view, createSource());
        saveOnRequest(view);
        const show = vi.spyOn(contextMenu, "show").mockResolvedValue(undefined);
        const openMenu = (index: number) => {
            const chip = view.dom.querySelectorAll(".cm-block-marker")[index];
            chip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            const items = show.mock.lastCall?.[0].items ?? [];
            return items as { enabled?: boolean; handler?: () => void }[];
        };

        const [ copy ] = openMenu(1);
        expect(copy.enabled).toBe(true);
        copy.handler?.();
        await vi.waitFor(() => expect(copyHtmlWithToast).toHaveBeenCalled());
        expect(vi.mocked(copyHtmlWithToast).mock.lastCall?.[1]).toBe("#root/n?block=b");

        openMenu(1)[1].handler?.();
        expect(view.state.doc.toString()).toBe(`${marker("a")}\n\n## Heading\n\nText`);
        openMenu(0)[1].handler?.();
        expect(view.state.doc.toString()).toBe("## Heading\n\nText");

        // A marker line at the end goes with the line break before it.
        view.dispatch({ changes: { from: view.state.doc.length, insert: `\n${marker("c")}` } });
        openMenu(0)[1].handler?.();
        expect(view.state.doc.toString()).toBe("## Heading\n\nText");
    });

    it("copies nothing for a marker that moved after its menu opened", async () => {
        const view = await createEditor(`Text ${marker("b")}`);
        mount(view, createSource());
        saveOnRequest(view);
        const show = vi.spyOn(contextMenu, "show").mockResolvedValue(undefined);
        const chip = view.dom.querySelector(".cm-block-marker");
        expect(chip).not.toBeNull();
        chip?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        const [ copy ] = (show.mock.lastCall?.[0].items ?? []) as { handler?: () => void }[];
        expect(copy.handler).toBeDefined();

        view.dispatch({ changes: { from: 0, insert: "New " } });
        copy.handler?.();
        expect(appContext.triggerEvent).not.toHaveBeenCalled();
        expect(view.state.doc.toString()).toBe(`New Text ${marker("b")}`);
    });
});

describe("buildMarkdownReferenceMenuItems", () => {
    it("copies the selected blocks, and pastes a reference as a link or an excerpt", async () => {
        buildNote({ id: "abcd", title: "Source" });
        vi.spyOn(froca, "getNote")
            .mockImplementation(async (noteId) => froca.notes[noteId] ?? null);
        const view = await createEditor("Para\n\n## Next");
        mount(view, createSource());
        let clipboardText = "#root/abcd?block=x";
        const clipboard = { enabled: true, read: async () => ({ html: "", text: clipboardText }) };

        const items = await buildMarkdownReferenceMenuItems(view.contentDOM, clipboard);
        expect(asCommand(items?.copy)?.title).toBe("block_reference.copy");
        expect(items?.paste.map((item) => asCommand(item)?.title)).toEqual([
            "block_reference.paste_as_link", "block_reference.paste_as_excerpt"
        ]);

        view.dispatch({ selection: { anchor: 2 } });
        const [ asLink, asExcerpt ] = (items?.paste ?? []).map(asCommand);
        asLink?.handler?.();
        await vi.waitFor(() => expect(view.state.doc.toString()).toContain("[[abcd?block=x]]"));
        asExcerpt?.handler?.();
        const figure = "<figure class=\"include-note\" data-note-id=\"abcd\" data-block=\"x\" "
            + "data-box-size=\"full\"></figure>";
        await vi.waitFor(() => expect(view.state.doc.toString()).toContain(figure));
        expect(view.state.doc.toString()).toBe(`Pa[[abcd?block=x]]ra\n\n${figure}\n\n## Next`);

        // In code, the user writes an example: the excerpt goes at the caret.
        const fenced = await createEditor("```\ncode\n```");
        mount(fenced, createSource());
        fenced.dispatch({ selection: { anchor: 6 } });
        const inCode = await buildMarkdownReferenceMenuItems(fenced.contentDOM, clipboard);
        asCommand(inCode?.paste[1])?.handler?.();
        await vi.waitFor(() => expect(fenced.state.doc.toString())
            .toBe(`\`\`\`\nco${figure}de\n\`\`\``));

        clipboardText = "not a reference";
        asLink?.handler?.();
        await vi.waitFor(() => expect(toast.showMessage).toHaveBeenCalled());
        clipboardText = "#root/gone?block=x";
        asLink?.handler?.();
        await vi.waitFor(() => expect(toast.showError)
            .toHaveBeenCalledWith("block_reference.not_found"));

        // Without a note, such as a Markdown file, the editor pastes but copies nothing.
        const file = await createEditor("Text");
        mount(file);
        const fileItems = await buildMarkdownReferenceMenuItems(file.contentDOM, clipboard);
        expect(fileItems?.copy).toBeNull();
        expect(fileItems?.paste).toHaveLength(2);

        // Another editor has no rows.
        const other = new VanillaCodeMirror({ parent: document.body });
        expect(await buildMarkdownReferenceMenuItems(other.contentDOM)).toBeNull();
        other.destroy();
        expect(await buildMarkdownReferenceMenuItems(document.body)).toBeNull();
    });

    it("copies the selected blocks, and has no paste rows without a clipboard", async () => {
        const view = await createEditor("First\n\nSecond");
        mount(view, createSource());
        saveOnRequest(view);
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });

        const items = await buildMarkdownReferenceMenuItems(view.contentDOM);
        expect(items?.paste).toEqual([]);
        const copy = asCommand(items?.copy);
        expect(copy?.handler).toBeDefined();
        copy?.handler?.();
        await vi.waitFor(() => expect(copyHtmlWithToast).toHaveBeenCalled());
        const ids = [ ...view.state.doc.toString().matchAll(/data-trilium-block-id="(\w+)"/g) ]
            .map((match) => match[1]);
        expect(ids).toHaveLength(2);
        expect(vi.mocked(copyHtmlWithToast).mock.lastCall?.[1])
            .toBe(`#root/n?block=${ids.join(":")}`);
    });

    it("pastes no excerpt that cannot be a block of its own, and says so", async () => {
        buildNote({ id: "abcd", title: "Source" });
        vi.spyOn(froca, "getNote")
            .mockImplementation(async (noteId) => froca.notes[noteId] ?? null);
        const view = await createEditor("Para");
        mount(view, createSource());
        vi.mocked(insertHtmlBlock).mockReturnValueOnce(null);
        const clipboard = {
            enabled: true, read: async () => ({ html: "", text: "#root/abcd?block=x" })
        };

        const items = await buildMarkdownReferenceMenuItems(view.contentDOM, clipboard);
        const asExcerpt = asCommand(items?.paste[1]);
        expect(asExcerpt?.handler).toBeDefined();
        asExcerpt?.handler?.();
        await vi.waitFor(() => expect(toast.showError)
            .toHaveBeenCalledWith("block_reference.paste_failed"));
        expect(insertHtmlBlock).toHaveBeenCalledOnce();
        expect(view.state.doc.toString()).toBe("Para");
    });
});

async function createEditor(doc: string) {
    const parent = document.body.appendChild(document.createElement("div"));
    editor = new VanillaCodeMirror({ parent });
    await editor.setMimeType("text/x-markdown");
    editor.setText(doc);
    return editor;
}

/** `item` as a row with a title and a handler, which every row of these menus is. */
function asCommand(item: MenuItem<CommandNames> | null | undefined) {
    return item as { title?: string; handler?: () => void } | null | undefined;
}

function createSource(preview: HTMLElement | null = null): MarkdownReferenceSource {
    const note = { noteId: "n", title: "Doc" } as FNote;
    return { getNote: () => note, getNotePath: () => "root/n", getPreview: () => preview };
}

/**
 * Saves the document of `view` as the content of note `n` when the note is asked to save, and
 * renders it into `preview`.
 */
function saveOnRequest(view: VanillaCodeMirror, preview?: HTMLElement) {
    vi.spyOn(appContext, "triggerEvent").mockImplementation(async () => {
        const doc = view.state.doc.toString();
        noteSavedDataStore.set("n", doc);
        preview?.replaceChildren(indexMarkdownBlocks(doc, PREVIEW_BLOCK_HOST).root as Node);
    });
}

function Probe({ view, source, hooksRef }: {
    view: VanillaCodeMirror | null;
    source?: MarkdownReferenceSource;
    hooksRef: { current?: ChangeRecordHooks };
}) {
    hooksRef.current = useBlockMarkers(view, source);
    return null;
}

function mount(view: VanillaCodeMirror | null, source?: MarkdownReferenceSource) {
    const container = document.createElement("div");
    const hooksRef: { current?: ChangeRecordHooks } = {};
    act(() => render(<Probe view={view} source={source} hooksRef={hooksRef} />, container));
    const unmount = () => act(() => render(null, container));
    unmounts.push(unmount);
    return { hooks: hooksRef.current as ChangeRecordHooks, unmount };
}
