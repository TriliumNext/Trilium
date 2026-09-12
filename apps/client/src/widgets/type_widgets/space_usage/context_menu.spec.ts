import { afterEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import type {
    ContextMenuEvent,
    MenuCommandItem,
    MenuItem
} from "../../../menus/context_menu";

const mocks = vi.hoisted(() => ({
    shown: undefined as { items: MenuItem<never>[] } | undefined,
    notes: new Map<string, unknown>(),
    branchIds: new Map<string, string>(),
    triggerCommand: vi.fn(),
    openContextWithNote: vi.fn(),
    // Answers like the real one: true when the deletion went through, false when the user backed
    // out of its confirmation dialog.
    deleteNotes: vi.fn(async (..._args: unknown[]) => true),
    downloadFileNote: vi.fn(),
    showDetails: vi.fn(),
    // Answers like the real one: the run's report, or null when the user backed out or it failed.
    showCompressionDialog: vi.fn<(...args: unknown[]) => Promise<{ compressedCount: number } | null>>(async () => null),
    contentChanged: vi.fn(),
    post: vi.fn(async (..._args: unknown[]) => undefined),
    showMessage: vi.fn(),
    revisionLimit: 0 as number | null,
    // Answers like the real one: true when the user accepts the box, false when they dismiss it.
    confirm: vi.fn(async (..._args: unknown[]) => true)
}));

vi.mock("../../../menus/context_menu", () => ({
    default: {
        show: async (options: { items: MenuItem<never>[] }) => {
            mocks.shown = options;
        }
    }
}));

vi.mock("../../../services/froca", () => ({
    default: {
        getNote: async (noteId: string) => mocks.notes.get(noteId) ?? null,
        getBranchId: async (parentNoteId: string, noteId: string) =>
            mocks.branchIds.get(`${parentNoteId}/${noteId}`) ?? null
    }
}));

vi.mock("../../../services/branches", () => ({
    default: { deleteNotes: (...args: unknown[]) => mocks.deleteNotes(...args) }
}));

vi.mock("../../../services/open", () => ({
    downloadFileNote: (...args: unknown[]) => mocks.downloadFileNote(...args)
}));

vi.mock("../../../services/server", () => ({
    default: { post: (...args: unknown[]) => mocks.post(...args) }
}));

// Stubbed rather than rendered: what belongs here is that the menu opens it, and the dialog's own
// spec covers what it then does.
vi.mock("../../dialogs/image_compression/image_compression_dialog", () => ({
    showImageCompressionDialog: (...args: unknown[]) => mocks.showCompressionDialog(...args)
}));

vi.mock("../../../services/toast", () => ({
    default: { showMessage: (...args: unknown[]) => mocks.showMessage(...args) }
}));

vi.mock("../../../services/options", () => ({
    default: { getInt: () => mocks.revisionLimit }
}));

vi.mock("../../../services/dialog", () => ({
    default: { confirm: (...args: unknown[]) => mocks.confirm(...args) }
}));

vi.mock("../../../components/app_context", () => ({
    default: {
        triggerCommand: mocks.triggerCommand,
        tabManager: {
            openContextWithNote: mocks.openContextWithNote,
            getActiveContext: () => null
        }
    }
}));

import {
    openDeletedNotesContextMenu,
    openRevisionsContextMenu,
    openSpaceUsageContextMenu
} from "./context_menu";

// The translations are uninitialized under the test i18n, so titles come back empty; items are
// identified by their icon, which is what distinguishes them anyway.
const QUICK_EDIT = "bx bx-edit";
const NEW_TAB = "bx bx-link-external";
const SHOW_DETAILS = "bx bx-detail";
const COMPRESS_IMAGES = "bx bx-image";
const DOWNLOAD = "bx bx-download";
const EXPORT = "bx bx-export";
const DELETE = "bx bx-trash destructive-action-icon";
// The deleted bucket's erase item wears the same destructive trash icon, in a menu of its own.
const ERASE = DELETE;

function givenNote(noteId: string, type = "text", isContentAvailable = true) {
    mocks.notes.set(noteId, {
        noteId, type, isContentAvailable: () => isContentAvailable
    } as FNote);
}

function contextMenuEvent() {
    return {
        pageX: 10,
        pageY: 20,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
    } as unknown as ContextMenuEvent;
}

function itemByIcon(icon: string) {
    return mocks.shown?.items.find(
        (item): item is MenuCommandItem<never> => "uiIcon" in item && item.uiIcon === icon
    );
}

function icons() {
    return mocks.shown?.items.flatMap((item) =>
        "uiIcon" in item && item.uiIcon ? [ item.uiIcon ] : []);
}

/** Every item carries a nullary handler; the menu dispatches no commands by name. */
function invoke(icon: string) {
    (itemByIcon(icon) as { handler?: () => void } | undefined)?.handler?.();
}

function openFor(notePath: string[]) {
    return openSpaceUsageContextMenu(contextMenuEvent(), notePath, mocks.showDetails, mocks.contentChanged);
}

afterEach(() => {
    mocks.shown = undefined;
    mocks.notes.clear();
    mocks.branchIds.clear();
    vi.clearAllMocks();
});

describe("openSpaceUsageContextMenu", () => {
    it("offers the whole set for a placed note, each action targeting that placement", async () => {
        givenNote("n1");
        mocks.branchIds.set("p/n1", "b1");
        const event = contextMenuEvent();

        await openSpaceUsageContextMenu(event, [ "root", "p", "n1" ], mocks.showDetails, mocks.contentChanged);

        // The chart keeps the pointer, and the browser's own menu stays out of the way.
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
        // No Download: a text note has no file to save.
        expect(icons()).toEqual([ QUICK_EDIT, NEW_TAB, SHOW_DETAILS, COMPRESS_IMAGES, EXPORT, DELETE ]);

        invoke(QUICK_EDIT);
        expect(mocks.triggerCommand)
            .toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "root/p/n1" });

        invoke(NEW_TAB);
        expect(mocks.openContextWithNote)
            .toHaveBeenCalledWith("n1", { activate: true, hoistedNoteId: null });

        invoke(SHOW_DETAILS);
        expect(mocks.showDetails).toHaveBeenCalledWith([ "root", "p", "n1" ]);

        invoke(COMPRESS_IMAGES);
        expect(mocks.showCompressionDialog).toHaveBeenCalledWith({ type: "note", noteId: "n1" });

        invoke(EXPORT);
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("showExportDialog", {
            notePath: "root/p/n1",
            defaultType: "subtree"
        });

        // The canonical placement's branch, so a clone loses only the placement the sizes were
        // attributed to.
        invoke(DELETE);
        expect(mocks.deleteNotes).toHaveBeenCalledWith([ "b1" ], false, false);
    });

    it("asks for a fresh reading once a delete goes through, and not when it is called off", async () => {
        givenNote("n1");
        mocks.branchIds.set("p/n1", "b1");
        await openFor([ "root", "p", "n1" ]);

        // The views measure on demand, so the one thing that can outdate them from inside has to
        // say so — otherwise the deleted note keeps its cell and stays counted in the totals.
        invoke(DELETE);
        await vi.waitFor(() => expect(mocks.contentChanged).toHaveBeenCalledTimes(1));

        // Backing out of the confirmation changes nothing, so nothing is re-measured either.
        mocks.deleteNotes.mockResolvedValueOnce(false);
        invoke(DELETE);
        await vi.waitFor(() => expect(mocks.deleteNotes).toHaveBeenCalledTimes(2));
        expect(mocks.contentChanged).toHaveBeenCalledTimes(1);
    });

    it("asks for a fresh reading once images were actually replaced, and not otherwise", async () => {
        givenNote("n1");
        await openFor([ "root", "p", "n1" ]);

        // Compressing changes the size of the notes holding the images, which is what the views are
        // drawn from — so a run that replaced any of them has to say so.
        mocks.showCompressionDialog.mockResolvedValueOnce({ compressedCount: 2 });
        invoke(COMPRESS_IMAGES);
        await vi.waitFor(() => expect(mocks.contentChanged).toHaveBeenCalledTimes(1));

        // A run that compressed nothing, and a dialog backed out of or failed, all leave the
        // figures exactly as they were — so none of them is worth re-measuring the database for.
        mocks.showCompressionDialog.mockResolvedValueOnce({ compressedCount: 0 });
        invoke(COMPRESS_IMAGES);
        mocks.showCompressionDialog.mockResolvedValueOnce(null);
        invoke(COMPRESS_IMAGES);
        await vi.waitFor(() => expect(mocks.showCompressionDialog).toHaveBeenCalledTimes(3));
        expect(mocks.contentChanged).toHaveBeenCalledTimes(1);
    });

    it("adds Download for file-bearing types, disabled when the content is away", async () => {
        givenNote("f1", "file");
        mocks.branchIds.set("p/f1", "b1");
        await openFor([ "root", "p", "f1" ]);
        expect(itemByIcon(DOWNLOAD)?.enabled).toBe(true);

        invoke(DOWNLOAD);
        expect(mocks.downloadFileNote).toHaveBeenCalledWith(mocks.notes.get("f1"), null, null);

        // A protected image whose content is locked away: offered, but not actionable.
        givenNote("i1", "image", false);
        await openFor([ "root", "p", "i1" ]);
        expect(itemByIcon(DOWNLOAD)?.enabled).toBe(false);
    });

    it("drops Delete on the root and disables Export, however it was reached", async () => {
        givenNote("root");

        await openFor([ "root" ]);

        // Not merely struck through: the root can never be deleted, so it is not offered.
        expect(icons()).toEqual([ QUICK_EDIT, NEW_TAB, SHOW_DETAILS, COMPRESS_IMAGES, EXPORT ]);
        expect(itemByIcon(EXPORT)?.enabled).toBe(false);
        // Opening it is still fine.
        expect(itemByIcon(QUICK_EDIT)?.enabled).toBeUndefined();

        // The overview builds the root's path as "root/root", making it look parented; the root
        // is recognised by its ID, so that path fares no differently.
        mocks.branchIds.set("root/root", "none_root");
        await openFor([ "root", "root" ]);
        expect(itemByIcon(DELETE)).toBeUndefined();
    });

    it("shows no menu at all for a note deleted since the usage was measured, or for no note", async () => {
        await openFor([ "root", "gone" ]);
        expect(mocks.shown).toBeUndefined();

        // A cell that names no note at all: nothing to look up, so nothing to offer.
        await openFor([]);
        expect(mocks.shown).toBeUndefined();
    });

    it("deletes nothing when the branch it would remove is gone by the time the item is invoked", async () => {
        givenNote("n1");
        // No branch id registered: the item is offered struck through, and refuses to act even if
        // something invokes it anyway.
        await openFor([ "root", "p", "n1" ]);

        expect(itemByIcon(DELETE)?.enabled).toBe(false);
        invoke(DELETE);
        expect(mocks.deleteNotes).not.toHaveBeenCalled();
        expect(mocks.contentChanged).not.toHaveBeenCalled();
    });
});

describe("openDeletedNotesContextMenu", () => {
    it("erases the deleted notes and asks for a fresh reading once the server is done", async () => {
        const event = contextMenuEvent();

        await openDeletedNotesContextMenu(event, mocks.contentChanged);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
        // The bucket stands for a crowd of notes, not one of them, so erasing is all it offers.
        expect(icons()).toEqual([ ERASE ]);

        invoke(ERASE);
        expect(mocks.post).toHaveBeenCalledWith("notes/erase-deleted-notes-now");
        // Not before the server answers: the bucket keeps its area until the space is really gone.
        expect(mocks.contentChanged).not.toHaveBeenCalled();

        await vi.waitFor(() => expect(mocks.contentChanged).toHaveBeenCalledTimes(1));
        expect(mocks.showMessage).toHaveBeenCalled();
    });
});

describe("openRevisionsContextMenu", () => {
    async function openRevisionsFor(revisionLimit: number | null) {
        mocks.revisionLimit = revisionLimit;
        await openRevisionsContextMenu(contextMenuEvent(), mocks.contentChanged);
    }

    it("trims the excess snapshots and asks for a fresh reading, once a limit is set", async () => {
        await openRevisionsFor(10);

        expect(icons()).toEqual([ ERASE ]);

        invoke(ERASE);
        expect(mocks.post).toHaveBeenCalledWith("revisions/erase-all-excess-revisions");
        expect(mocks.triggerCommand).not.toHaveBeenCalled();

        await vi.waitFor(() => expect(mocks.contentChanged).toHaveBeenCalledTimes(1));
        expect(mocks.showMessage).toHaveBeenCalled();

        // A limit of zero keeps no snapshot at all, so every one of them is excess — a limit like
        // any other, not an unset one.
        await openRevisionsFor(0);
        invoke(ERASE);
        expect(mocks.post).toHaveBeenCalledTimes(2);
        expect(mocks.triggerCommand).not.toHaveBeenCalled();
    });

    it("lands on the limit field itself, cursor in it, once the settings page has rendered", async () => {
        // Rendered late on purpose: the page comes up after the command asking for it, which is
        // what the reveal has to wait out.
        const field = document.createElement("input");
        field.name = "revision-snapshot-number-limit";
        field.scrollIntoView = vi.fn();
        setTimeout(() => document.body.appendChild(field), 60);

        await openRevisionsFor(-1);
        invoke(ERASE);

        await vi.waitFor(() => expect(document.activeElement).toBe(field));
        expect(field.scrollIntoView).toHaveBeenCalled();

        field.remove();
    });

    it("offers the limit setting instead of an erasure that would drop nothing, when there is none", async () => {
        // Present from the start, unlike the test above: accepting the offer sends the reveal off
        // polling for this field, and with none to find it would keep going for a second after the
        // test has ended — into a torn-down environment where `document` no longer exists.
        const field = document.createElement("input");
        field.name = "revision-snapshot-number-limit";
        field.scrollIntoView = vi.fn();
        document.body.appendChild(field);

        // A negative limit keeps everything, so there is no ceiling to trim down to and the erasure
        // would report success having changed nothing. An unreadable option counts as no limit
        // rather than as the harshest one, which would erase every snapshot in the database.
        for (const noLimit of [ -1, null ]) {
            await openRevisionsFor(noLimit);
            invoke(ERASE);
            await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
        }

        await vi.waitFor(() => expect(field.scrollIntoView).toHaveBeenCalled());
        field.remove();

        expect(mocks.post).not.toHaveBeenCalled();
        expect(mocks.contentChanged).not.toHaveBeenCalled();
        // Accepted: lands on the card holding the limit, in the settings dialog already open.
        expect(mocks.triggerCommand)
            .toHaveBeenCalledWith("showOptions", { section: "_optionsOther" });
    });

    it("leaves the map where it is when the box is dismissed", async () => {
        mocks.confirm.mockResolvedValueOnce(false);
        await openRevisionsFor(-1);

        invoke(ERASE);
        await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));

        // Nothing erased and nowhere else to be: someone who backs out of the box stays on the map.
        expect(mocks.triggerCommand).not.toHaveBeenCalled();
        expect(mocks.post).not.toHaveBeenCalled();
    });
});
